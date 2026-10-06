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
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   MAIN PAGE
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================================================
   SPA FALLBACK
========================================================= */

app.use((req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

/* =========================================================
   USERS
========================================================= */

const users = new Map();

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  /* =======================================================
     JOIN PERMANENT CALL ROOM
  ======================================================= */

  socket.on("join-room", (roomId) => {

    if (!roomId) return;

    roomId = String(roomId)
      .trim()
      .toUpperCase();

    /* Remove socket from old rooms */

    for (const room of socket.rooms) {

      if (room !== socket.id) {
        socket.leave(room);
      }
    }

    /* Check room capacity */

    const existingUsers =
      io.sockets.adapter.rooms.get(roomId);

    if (
      existingUsers &&
      existingUsers.size >= 2
    ) {

      socket.emit("room-full");

      console.log(
        `Room full: ${roomId}`
      );

      return;
    }

    /* Join */

    socket.join(roomId);

    users.set(socket.id, {
      roomId: roomId
    });

    socket.emit("room-joined", {
      roomId: roomId,
      socketId: socket.id
    });

    console.log(
      `${socket.id} joined room ${roomId}`
    );
  });

  /* =======================================================
     CALL USER
  ======================================================= */

  socket.on(
    "call-user",
    ({ targetRoom, callerRoom }) => {

      if (!targetRoom) return;

      targetRoom = String(targetRoom)
        .trim()
        .toUpperCase();

      const targetUsers =
        io.sockets.adapter.rooms.get(targetRoom);

      /*
       * Target user must currently be online
       * and connected to the permanent call room.
       */

      if (
        !targetUsers ||
        targetUsers.size === 0
      ) {

        socket.emit("call-unavailable", {
          roomId: targetRoom
        });

        console.log(
          `Call unavailable: ${targetRoom}`
        );

        return;
      }

      /* Find another socket in target room */

      let targetSocketId = null;

      for (const id of targetUsers) {

        if (id !== socket.id) {

          targetSocketId = id;
          break;
        }
      }

      if (!targetSocketId) {

        socket.emit("call-unavailable", {
          roomId: targetRoom
        });

        return;
      }

      /* Send incoming call */

      io.to(targetSocketId).emit(
        "incoming-call",
        {
          callerId: socket.id,
          callerRoom: callerRoom || "",
          targetRoom: targetRoom
        }
      );

      /* Tell caller */

      socket.emit("call-ringing", {
        roomId: targetRoom
      });

      console.log(
        `Call: ${
          callerRoom || socket.id
        } -> ${targetRoom}`
      );
    }
  );

  /* =======================================================
     ACCEPT CALL
  ======================================================= */

  socket.on(
    "accept-call",
    ({ callerId }) => {

      if (!callerId) return;

      io.to(callerId).emit(
        "call-accepted",
        {
          accepterId: socket.id
        }
      );

      console.log(
        `Call accepted: ${callerId} -> ${socket.id}`
      );
    }
  );

  /* =======================================================
     REJECT CALL
  ======================================================= */

  socket.on(
    "reject-call",
    ({ callerId }) => {

      if (!callerId) return;

      io.to(callerId).emit(
        "call-rejected"
      );

      console.log(
        `Call rejected by ${socket.id}`
      );
    }
  );

  /* =======================================================
     WEBRTC SIGNAL
  ======================================================= */

  socket.on(
    "webrtc-signal",
    ({ targetId, signal }) => {

      if (!targetId || !signal) return;

      io.to(targetId).emit(
        "webrtc-signal",
        {
          senderId: socket.id,
          signal: signal
        }
      );
    }
  );

  /* =======================================================
     END CALL
  ======================================================= */

  socket.on(
    "end-call",
    ({ targetId }) => {

      if (!targetId) return;

      io.to(targetId).emit(
        "call-ended"
      );

      console.log(
        `Call ended: ${socket.id} -> ${targetId}`
      );
    }
  );

  /* =======================================================
     DISCONNECT
  ======================================================= */

  socket.on("disconnect", () => {

    console.log(
      "User disconnected:",
      socket.id
    );

    users.delete(socket.id);
  });

});

/* =========================================================
   SERVER START
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Past Snap running on port ${PORT}`
    );

  }
);
