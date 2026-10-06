const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

/* =========================================================
   SOCKET.IO
========================================================= */

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});


/* =========================================================
   CONFIG
========================================================= */

const PORT =
  process.env.PORT || 3000;

const MAX_USERS_PER_ROOM = 2;


/* =========================================================
   EXPRESS
========================================================= */

app.use(
  express.json({
    limit: "10mb"
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb"
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", (req, res) => {

  res.json({
    status: "ok",
    app: "PastSnap",
    socket: true,
    time: new Date().toISOString()
  });

});


/* =========================================================
   MAIN PAGE
========================================================= */

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );

});


/* =========================================================
   SOCKET USER DATA
========================================================= */

const users = new Map();


/*
  users:

  socket.id -> {
    roomId,
    callRoom
  }
*/


/* =========================================================
   HELPERS
========================================================= */

function normalizeRoom(roomId) {

  if (!roomId)
    return "";

  return String(roomId)
    .trim()
    .toUpperCase();

}


function getRoomUsers(roomId) {

  const room =
    io.sockets.adapter.rooms.get(
      roomId
    );

  if (!room)
    return [];

  return [...room];

}


function getOtherUser(
  roomId,
  socketId
) {

  const roomUsers =
    getRoomUsers(roomId);

  return roomUsers.find(
    id => id !== socketId
  ) || null;

}


/* =========================================================
   SOCKET CONNECTION
========================================================= */

io.on(
  "connection",
  socket => {

    console.log(
      "USER CONNECTED:",
      socket.id
    );


    /* =====================================================
       JOIN ROOM
    ====================================================== */

    socket.on(
      "join-room",
      roomId => {

        roomId =
          normalizeRoom(roomId);

        if (!roomId) {
          return;
        }


        /*
          Leave old rooms first.
        */

        for (
          const oldRoom
          of socket.rooms
        ) {

          if (
            oldRoom !== socket.id
          ) {

            socket.leave(
              oldRoom
            );

          }

        }


        /*
          Check room capacity.
        */

        const existingUsers =
          io.sockets.adapter.rooms.get(
            roomId
          );

        if (
          existingUsers &&
          existingUsers.size >=
            MAX_USERS_PER_ROOM
        ) {

          socket.emit(
            "room-full",
            {
              roomId
            }
          );

          console.log(
            "ROOM FULL:",
            roomId
          );

          return;
        }


        /*
          Join.
        */

        socket.join(
          roomId
        );


        users.set(
          socket.id,
          {
            roomId,
            callRoom: roomId
          }
        );


        socket.emit(
          "room-joined",
          {
            roomId,
            socketId:
              socket.id
          }
        );


        console.log(
          "ROOM JOINED:",
          socket.id,
          "->",
          roomId
        );

      }
    );


    /* =====================================================
       CALL USER
    ====================================================== */

    socket.on(
      "call-user",
      payload => {

        if (!payload)
          return;

        let targetRoom =
          normalizeRoom(
            payload.targetRoom
          );

        const callerRoom =
          normalizeRoom(
            payload.callerRoom
          );


        if (!targetRoom)
          return;


        /*
          Find target room.
        */

        const targetUsers =
          getRoomUsers(
            targetRoom
          );


        /*
          Nobody online.
        */

        if (
          targetUsers.length === 0
        ) {

          socket.emit(
            "call-unavailable",
            {
              roomId:
                targetRoom
            }
          );

          console.log(
            "CALL UNAVAILABLE:",
            targetRoom
          );

          return;
        }


        /*
          Find target socket.
        */

        let targetSocketId =
          null;

        for (
          const socketId
          of targetUsers
        ) {

          if (
            socketId !==
            socket.id
          ) {

            targetSocketId =
              socketId;

            break;
          }

        }


        /*
          Cannot call self.
        */

        if (!targetSocketId) {

          socket.emit(
            "call-unavailable",
            {
              roomId:
                targetRoom
            }
          );

          return;
        }


        /*
          Send incoming call.
        */

        io.to(
          targetSocketId
        ).emit(
          "incoming-call",
          {
            callerId:
              socket.id,

            callerRoom:
              callerRoom,

            targetRoom:
              targetRoom
          }
        );


        /*
          Tell caller that
          ringing has started.
        */

        socket.emit(
          "call-ringing",
          {
            roomId:
              targetRoom
          }
        );


        console.log(
          "CALL:",
          callerRoom ||
            socket.id,
          "->",
          targetRoom
        );

      }
    );


    /* =====================================================
       ACCEPT CALL
    ====================================================== */

    socket.on(
      "accept-call",
      payload => {

        if (
          !payload ||
          !payload.callerId
        ) {
          return;
        }

        const callerId =
          payload.callerId;


        io.to(
          callerId
        ).emit(
          "call-accepted",
          {
            accepterId:
              socket.id
          }
        );


        console.log(
          "CALL ACCEPTED:",
          callerId,
          "<-",
          socket.id
        );

      }
    );


    /* =====================================================
       REJECT CALL
    ====================================================== */

    socket.on(
      "reject-call",
      payload => {

        if (
          !payload ||
          !payload.callerId
        ) {
          return;
        }

        const callerId =
          payload.callerId;


        io.to(
          callerId
        ).emit(
          "call-rejected",
          {
            rejectedBy:
              socket.id
          }
        );


        console.log(
          "CALL REJECTED:",
          socket.id
        );

      }
    );


    /* =====================================================
       WEBRTC SIGNALING
    ====================================================== */

    socket.on(
      "webrtc-signal",
      payload => {

        if (
          !payload ||
          !payload.targetId ||
          !payload.signal
        ) {
          return;
        }


        io.to(
          payload.targetId
        ).emit(
          "webrtc-signal",
          {
            senderId:
              socket.id,

            signal:
              payload.signal
          }
        );

      }
    );


    /* =====================================================
       END CALL
    ====================================================== */

    socket.on(
      "end-call",
      payload => {

        if (
          !payload ||
          !payload.targetId
        ) {
          return;
        }


        io.to(
          payload.targetId
        ).emit(
          "call-ended",
          {
            endedBy:
              socket.id
          }
        );


        console.log(
          "CALL ENDED:",
          socket.id,
          "->",
          payload.targetId
        );

      }
    );


    /* =====================================================
       REAL-TIME CHAT
    ====================================================== */

    socket.on(
      "chat-message",
      payload => {

        if (!payload)
          return;

        const message =
          String(
            payload.message || ""
          ).trim();

        const targetRoom =
          normalizeRoom(
            payload.targetRoom
          );


        if (
          !message ||
          !targetRoom
        ) {
          return;
        }


        /*
          Limit message size.
        */

        const safeMessage =
          message.slice(
            0,
            500
          );


        const targetUsers =
          getRoomUsers(
            targetRoom
          );


        /*
          Send message only
          to the other person.

          Caller already displays
          their own message locally.
        */

        for (
          const targetSocketId
          of targetUsers
        ) {

          if (
            targetSocketId !==
            socket.id
          ) {

            io.to(
              targetSocketId
            ).emit(
              "chat-message",
              {
                senderId:
                  socket.id,

                message:
                  safeMessage,

                roomId:
                  targetRoom,

                createdAt:
                  new Date().toISOString()
              }
            );

          }

        }


        console.log(
          "CHAT:",
          socket.id,
          "->",
          targetRoom
        );

      }
    );


    /* =====================================================
       DISCONNECT
    ====================================================== */

    socket.on(
      "disconnect",
      reason => {

        const user =
          users.get(
            socket.id
          );


        console.log(
          "USER DISCONNECTED:",
          socket.id,
          reason
        );


        /*
          Notify the other user
          if they were in the same
          call room.
        */

        if (user?.roomId) {

          const otherUser =
            getOtherUser(
              user.roomId,
              socket.id
            );

          if (otherUser) {

            io.to(
              otherUser
            ).emit(
              "call-ended",
              {
                endedBy:
                  socket.id
              }
            );

          }

        }


        users.delete(
          socket.id
        );

      }
    );

  }
);


/* =========================================================
   404 FALLBACK
========================================================= */

app.use(
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );

  }
);


/* =========================================================
   START SERVER
========================================================= */

server.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "===================================="
    );

    console.log(
      "       PASTSNAP SERVER ONLINE"
    );

    console.log(
      "===================================="
    );

    console.log(
      "PORT:",
      PORT
    );

    console.log(
      "MAX USERS / ROOM:",
      MAX_USERS_PER_ROOM
    );

    console.log(
      "SOCKET.IO: ENABLED"
    );

    console.log(
      "WEBRTC SIGNALING: ENABLED"
    );

    console.log(
      "REAL-TIME CHAT: ENABLED"
    );

    console.log(
      "===================================="
    );

  }
);
