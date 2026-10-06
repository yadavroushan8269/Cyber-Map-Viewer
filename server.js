const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 50 * 1024 * 1024
});

const PORT = process.env.PORT || 10000;

/*
  Maximum users inside one permanent call room.
*/
const MAX_USERS_PER_ROOM = 6;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "10mb"
}));

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Cyber Map Viewer",
    maxUsersPerRoom: MAX_USERS_PER_ROOM,
    time: new Date().toISOString()
  });
});

app.get("/", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});


/* =========================================================
   ROOM HELPERS
========================================================= */

function normalRoom(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getRoomUsers(room) {
  const set = io.sockets.adapter.rooms.get(room);
  if (!set) return [];

  return [...set].map(id => {
    const s = io.sockets.sockets.get(id);

    return {
      socketId: id,
      room: s?.data?.room || "",
      displayName: s?.data?.displayName || "USER"
    };
  });
}

function leaveRoom(socket) {
  const room = socket.data.room;

  if (!room) return;

  socket.to(room).emit("peer-left", {
    peerId: socket.id,
    displayName: socket.data.displayName || "USER"
  });

  socket.leave(room);

  socket.data.room = null;
}


/* =========================================================
   SOCKET CONNECTION
========================================================= */

io.on("connection", socket => {

  console.log(
    `[CONNECT] ${socket.id}`
  );


  /* =======================================================
     JOIN PERMANENT ROOM
  ======================================================= */

  socket.on("join-room", payload => {

    const room = normalRoom(
      typeof payload === "string"
        ? payload
        : payload?.room
    );

    const displayName =
      String(
        typeof payload === "object"
          ? payload?.displayName || "USER"
          : "USER"
      ).trim().slice(0, 50);

    if (!room) return;


    /*
      Already inside this room.
    */

    if (socket.data.room === room) {

      socket.data.displayName = displayName;

      socket.emit("room-joined", {
        room,
        count:
          io.sockets.adapter.rooms.get(room)?.size || 1,
        max: MAX_USERS_PER_ROOM,
        users: getRoomUsers(room)
      });

      return;
    }


    /*
      Leave previous room.
    */

    if (socket.data.room) {
      leaveRoom(socket);
    }


    /*
      Check room capacity.
    */

    const existing =
      io.sockets.adapter.rooms.get(room);

    const count =
      existing ? existing.size : 0;

    if (count >= MAX_USERS_PER_ROOM) {

      socket.emit("room-full", {
        room,
        max: MAX_USERS_PER_ROOM
      });

      return;
    }


    /*
      Existing users BEFORE joining.
      These are important for multi-peer WebRTC.
    */

    const existingUsers =
      existing ? [...existing] : [];


    socket.join(room);

    socket.data.room = room;
    socket.data.displayName = displayName;


    /*
      Tell joining user about everyone already
      inside the room.
    */

    socket.emit("room-joined", {
      room,
      count: existingUsers.length + 1,
      max: MAX_USERS_PER_ROOM,
      users: getRoomUsers(room)
    });


    /*
      Tell existing users that a new peer arrived.
    */

    socket.to(room).emit("peer-joined", {
      peerId: socket.id,
      displayName
    });


    /*
      Send updated member list.
    */

    io.to(room).emit("room-users", {
      room,
      count: io.sockets.adapter.rooms.get(room)?.size || 0,
      max: MAX_USERS_PER_ROOM,
      users: getRoomUsers(room)
    });


    console.log(
      `[ROOM] ${socket.id} -> ${room} ` +
      `(${existingUsers.length + 1}/${MAX_USERS_PER_ROOM})`
    );
  });


  /* =======================================================
     CALL USER BY PERMANENT ROOM ID
  ======================================================= */

  socket.on("call-user", ({ targetRoom } = {}) => {

    const room = normalRoom(targetRoom);

    if (!room) return;


    const targetSet =
      io.sockets.adapter.rooms.get(room);

    if (!targetSet || targetSet.size === 0) {

      socket.emit("call-unavailable", {
        targetRoom: room,
        reason: "offline"
      });

      return;
    }


    /*
      Find an actual online user.
    */

    for (const targetId of targetSet) {

      if (targetId === socket.id) continue;

      io.to(targetId).emit("incoming-call", {

        callerId: socket.id,

        callerRoom:
          socket.data.room || "",

        callerName:
          socket.data.displayName || "USER",

        /*
          New call session ID.
        */

        callId:
          `${socket.id}-${Date.now()}`
      });

      socket.emit("call-ringing", {
        targetRoom: room,
        targetId
      });

      return;
    }


    socket.emit("call-unavailable", {
      targetRoom: room
    });
  });


  /* =======================================================
     ACCEPT CALL
  ======================================================= */

  socket.on("accept-call", ({ callerId } = {}) => {

    if (!callerId) return;

    io.to(callerId).emit("call-accepted", {

      acceptedBy: socket.id,

      accepterId: socket.id,

      accepterName:
        socket.data.displayName || "USER",

      accepterRoom:
        socket.data.room || ""
    });
  });


  /* =======================================================
     REJECT CALL
  ======================================================= */

  socket.on("reject-call", ({ callerId } = {}) => {

    if (!callerId) return;

    io.to(callerId).emit("call-rejected", {

      rejectedBy: socket.id,

      rejectedName:
        socket.data.displayName || "USER"
    });
  });


  /* =======================================================
     ADD FRIEND TO ACTIVE CALL
  ======================================================= */

  socket.on(
    "invite-to-call",
    ({ targetRoom, callParticipants = [] } = {}) => {

      const room = normalRoom(targetRoom);

      if (!room) return;


      const targetSet =
        io.sockets.adapter.rooms.get(room);

      if (!targetSet || targetSet.size === 0) {

        socket.emit("invite-unavailable", {
          targetRoom: room
        });

        return;
      }


      /*
        Prevent more than 6 participants.
      */

      const currentRoom =
        socket.data.callRoom ||
        socket.data.room;

      const currentCount =
        currentRoom
          ? (
              io.sockets.adapter.rooms.get(currentRoom)
                ?.size || 0
            )
          : 0;

      if (currentCount >= MAX_USERS_PER_ROOM) {

        socket.emit("call-room-full", {
          max: MAX_USERS_PER_ROOM
        });

        return;
      }


      for (const targetId of targetSet) {

        if (targetId === socket.id) continue;

        io.to(targetId).emit(
          "incoming-call",
          {
            callerId: socket.id,

            callerRoom:
              socket.data.room || "",

            callerName:
              socket.data.displayName || "USER",

            callId:
              `${socket.id}-${Date.now()}`,

            groupCall: true,

            participants:
              Array.isArray(callParticipants)
                ? callParticipants.slice(0, MAX_USERS_PER_ROOM)
                : []
          }
        );

        socket.emit("friend-invited", {
          targetRoom: room
        });

        return;
      }
    }
  );


  /* =======================================================
     WEBRTC SIGNALING
  ======================================================= */

  socket.on(
    "webrtc-signal",
    ({ targetId, signal } = {}) => {

      if (!targetId || !signal) return;

      io.to(targetId).emit(
        "webrtc-signal",
        {
          senderId: socket.id,
          senderName:
            socket.data.displayName || "USER",
          signal
        }
      );
    }
  );


  /* =======================================================
     CALL CHAT
  ======================================================= */

  socket.on(
    "chat-message",
    ({ targetId, message } = {}) => {

      const text =
        String(message || "").trim();

      if (!targetId || !text) return;

      io.to(targetId).emit(
        "chat-message",
        {
          fromId: socket.id,

          fromName:
            socket.data.displayName || "USER",

          message: text,

          time: Date.now()
        }
      );
    }
  );


  /* =======================================================
     GROUP CALL CHAT
  ======================================================= */

  socket.on(
    "call-room-message",
    ({ room, message, type = "text", mediaUrl = "" } = {}) => {

      const targetRoom = normalRoom(room);

      const text =
        String(message || "").trim();

      if (!targetRoom) return;

      const targetSet =
        io.sockets.adapter.rooms.get(targetRoom);

      if (!targetSet) return;


      socket.to(targetRoom).emit(
        "call-room-message",
        {
          fromId: socket.id,

          fromName:
            socket.data.displayName || "USER",

          message: text,

          type,

          mediaUrl,

          time: Date.now()
        }
      );
    }
  );


  /* =======================================================
     END CALL WITH ONE USER
  ======================================================= */

  socket.on(
    "end-call",
    ({ targetId } = {}) => {

      if (!targetId) return;

      io.to(targetId).emit(
        "call-ended",
        {
          endedBy: socket.id,

          endedByName:
            socket.data.displayName || "USER"
        }
      );
    }
  );


  /* =======================================================
     END GROUP CALL
  ======================================================= */

  socket.on(
    "end-group-call",
    ({ room } = {}) => {

      const targetRoom = normalRoom(room);

      if (!targetRoom) return;

      socket.to(targetRoom).emit(
        "group-call-ended",
        {
          endedBy: socket.id,

          endedByName:
            socket.data.displayName || "USER"
        }
      );
    }
  );


  /* =======================================================
     NORMAL ROOM CHAT
  ======================================================= */

  socket.on(
    "room-chat",
    ({ targetRoom, message, type = "text", mediaUrl = "" } = {}) => {

      const room = normalRoom(targetRoom);

      const text =
        String(message || "").trim();

      if (!room) return;

      const targetSet =
        io.sockets.adapter.rooms.get(room);

      if (!targetSet || targetSet.size === 0) {

        socket.emit("room-chat-unavailable", {
          targetRoom: room
        });

        return;
      }


      socket.to(room).emit(
        "room-chat",
        {
          fromId: socket.id,

          fromName:
            socket.data.displayName || "USER",

          message: text,

          type,

          mediaUrl,

          time: Date.now()
        }
      );


      socket.emit(
        "room-chat-sent",
        {
          targetRoom: room
        }
      );
    }
  );


  /* =======================================================
     LEAVE ROOM
  ======================================================= */

  socket.on("leave-room", () => {

    leaveRoom(socket);

    io.emit("room-users-updated");
  });


  /* =======================================================
     DISCONNECT
  ======================================================= */

  socket.on("disconnect", reason => {

    const room =
      socket.data.room;

    if (room) {

      socket.to(room).emit(
        "peer-left",
        {
          peerId: socket.id,

          displayName:
            socket.data.displayName || "USER"
        }
      );

      socket.to(room).emit(
        "room-users",
        {
          room,

          count:
            io.sockets.adapter.rooms.get(room)?.size || 0,

          max: MAX_USERS_PER_ROOM,

          users:
            getRoomUsers(room)
        }
      );
    }

    console.log(
      `[DISCONNECT] ${socket.id} ${reason}`
    );
  });
});


/* =========================================================
   404
========================================================= */

app.use((_req, res) => {
  res.status(404).send("Not found");
});


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, _req, res, _next) => {

  console.error(err);

  res.status(500).json({
    error: "Internal server error"
  });
});


/* =========================================================
   START
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log("=================================");
    console.log(" CYBER MAP VIEWER ONLINE");
    console.log(" PORT:", PORT);
    console.log(" MAX CALL USERS:", MAX_USERS_PER_ROOM);
    console.log("=================================");
    console.log("");
  }
);


/* =========================================================
   SAFE SHUTDOWN
========================================================= */

function shutdown(signal) {

  console.log(
    `[SHUTDOWN] ${signal}`
  );

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
