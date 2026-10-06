const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 10000;

// Maximum users in one call room
const MAX_USERS_PER_ROOM = 6;

// Room structure:
// roomId -> Set(socketId)
const rooms = new Map();

// socketId -> roomId
const socketRooms = new Map();

// socketId -> user information
const socketUsers = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* =========================
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "Cyber Map Viewer",
    users: io.engine.clientsCount,
    rooms: rooms.size,
    time: new Date().toISOString()
  });
});

/* =========================
   MAIN PAGE
========================= */

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================
   HELPERS
========================= */

function normalizeRoom(room) {
  return String(room || "")
    .trim()
    .toUpperCase();
}

function getRoomUsers(roomId) {
  const room = rooms.get(roomId);

  if (!room) return [];

  return [...room]
    .map(socketId => {
      const user = socketUsers.get(socketId);

      return {
        socketId,
        roomId,
        displayName: user?.displayName || "USER"
      };
    })
    .filter(Boolean);
}

function removeSocketFromRoom(socketId) {
  const roomId = socketRooms.get(socketId);

  if (!roomId) return null;

  const room = rooms.get(roomId);

  if (room) {
    room.delete(socketId);

    if (room.size === 0) {
      rooms.delete(roomId);
    }
  }

  socketRooms.delete(socketId);

  return roomId;
}

function leaveCurrentRoom(socket) {
  const roomId = socketRooms.get(socket.id);

  if (!roomId) return;

  const room = rooms.get(roomId);

  if (room) {
    room.delete(socket.id);

    socket.to(roomId).emit("peer-left", {
      socketId: socket.id,
      roomId
    });

    if (room.size === 0) {
      rooms.delete(roomId);
    } else {
      io.to(roomId).emit("room-users", {
        roomId,
        users: getRoomUsers(roomId)
      });
    }
  }

  socket.leave(roomId);
  socketRooms.delete(socket.id);
}

/* =========================
   SOCKET.IO
========================= */

io.on("connection", socket => {
  console.log("CONNECTED:", socket.id);

  socketUsers.set(socket.id, {
    displayName: "USER"
  });

  /* =========================
     USER INFORMATION
  ========================= */

  socket.on("set-user-info", data => {
    const current = socketUsers.get(socket.id) || {};

    socketUsers.set(socket.id, {
      ...current,
      displayName: String(data?.displayName || "USER").slice(0, 100),
      roomId: normalizeRoom(data?.roomId)
    });
  });

  /* =========================
     JOIN ROOM
  ========================= */

  socket.on("join-room", data => {
    const roomId = normalizeRoom(
      typeof data === "string" ? data : data?.roomId
    );

    if (!roomId) {
      socket.emit("room-error", {
        message: "Room ID required"
      });
      return;
    }

    // Already in same room
    if (socketRooms.get(socket.id) === roomId) {
      socket.emit("room-joined", {
        roomId,
        users: getRoomUsers(roomId)
      });

      return;
    }

    // Leave previous room
    leaveCurrentRoom(socket);

    // Create room if required
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }

    const room = rooms.get(roomId);

    // Maximum room size
    if (room.size >= MAX_USERS_PER_ROOM) {
      socket.emit("room-full", {
        roomId,
        maxUsers: MAX_USERS_PER_ROOM
      });

      return;
    }

    // Join Socket.IO room
    socket.join(roomId);

    room.add(socket.id);
    socketRooms.set(socket.id, roomId);

    console.log(
      `JOIN ROOM: ${socket.id} -> ${roomId} (${room.size}/${MAX_USERS_PER_ROOM})`
    );

    // Send joined confirmation
    socket.emit("room-joined", {
      roomId,
      users: getRoomUsers(roomId)
    });

    // Tell existing users about new peer
    socket.to(roomId).emit("peer-joined", {
      socketId: socket.id,
      roomId,
      user: socketUsers.get(socket.id)
    });

    // Update everybody
    io.to(roomId).emit("room-users", {
      roomId,
      users: getRoomUsers(roomId)
    });
  });

  /* =========================
     CALL USER
  ========================= */

  socket.on("call-user", data => {
    const targetRoom = normalizeRoom(
      data?.roomId || data?.targetRoom || data?.target
    );

    if (!targetRoom) {
      socket.emit("call-unavailable", {
        roomId: targetRoom,
        reason: "INVALID_ROOM"
      });

      return;
    }

    const targetSockets = rooms.get(targetRoom);

    if (!targetSockets || targetSockets.size === 0) {
      socket.emit("call-unavailable", {
        roomId: targetRoom,
        reason: "OFFLINE"
      });

      return;
    }

    const callerRoom = socketRooms.get(socket.id) || "";

    const callerUser = socketUsers.get(socket.id) || {};

    console.log(
      `CALL: ${socket.id} -> room ${targetRoom}`
    );

    // Ring every online user in target room
    for (const targetSocketId of targetSockets) {
      if (targetSocketId === socket.id) continue;

      io.to(targetSocketId).emit("incoming-call", {
        callerId: socket.id,
        callerSocketId: socket.id,
        callerRoom,
        targetRoom,
        displayName: callerUser.displayName || "USER"
      });
    }

    socket.emit("call-ringing", {
      roomId: targetRoom
    });
  });

  /* =========================
     ACCEPT CALL
  ========================= */

  socket.on("accept-call", data => {
    const callerId =
      data?.callerId ||
      data?.callerSocketId;

    if (!callerId) return;

    const callerSocket = io.sockets.sockets.get(callerId);

    if (!callerSocket) {
      socket.emit("call-unavailable", {
        reason: "CALLER_OFFLINE"
      });

      return;
    }

    const receiverRoom = socketRooms.get(socket.id) || "";
    const callerRoom = socketRooms.get(callerId) || "";

    console.log(
      `CALL ACCEPTED: ${socket.id} <- ${callerId}`
    );

    io.to(callerId).emit("call-accepted", {
      socketId: socket.id,
      roomId: receiverRoom
    });

    socket.emit("call-accepted", {
      socketId: callerId,
      roomId: callerRoom
    });
  });

  /* =========================
     REJECT CALL
  ========================= */

  socket.on("reject-call", data => {
    const callerId =
      data?.callerId ||
      data?.callerSocketId;

    if (!callerId) return;

    console.log(
      `CALL REJECTED: ${socket.id} <- ${callerId}`
    );

    io.to(callerId).emit("call-rejected", {
      socketId: socket.id,
      roomId: socketRooms.get(socket.id) || ""
    });
  });

  /* =========================
     WEBRTC SIGNAL
  ========================= */

  socket.on("webrtc-signal", data => {
    const targetId =
      data?.to ||
      data?.target ||
      data?.targetSocketId;

    if (!targetId) return;

    const targetSocket = io.sockets.sockets.get(targetId);

    if (!targetSocket) return;

    targetSocket.emit("webrtc-signal", {
      ...data,
      from: socket.id,
      senderId: socket.id
    });
  });

  /* =========================
     END ONE-TO-ONE CALL
  ========================= */

  socket.on("end-call", data => {
    const targetId =
      data?.targetId ||
      data?.targetSocketId ||
      data?.to;

    if (!targetId) return;

    io.to(targetId).emit("call-ended", {
      socketId: socket.id
    });

    console.log(
      `CALL ENDED: ${socket.id} -> ${targetId}`
    );
  });

  /* =========================
     END GROUP CALL
  ========================= */

  socket.on("end-group-call", data => {
    const roomId =
      normalizeRoom(data?.roomId) ||
      socketRooms.get(socket.id);

    if (!roomId) return;

    socket.to(roomId).emit("group-call-ended", {
      roomId,
      endedBy: socket.id
    });

    console.log(
      `GROUP CALL ENDED: ${socket.id} -> ${roomId}`
    );
  });

  /* =========================
     CALL ROOM CHAT
  ========================= */

  socket.on("call-room-message", data => {
    const roomId =
      normalizeRoom(data?.roomId) ||
      socketRooms.get(socket.id);

    const message = String(data?.message || "").trim();

    if (!roomId || !message) return;

    const payload = {
      roomId,
      senderId: socket.id,
      senderName:
        socketUsers.get(socket.id)?.displayName || "USER",
      message: message.slice(0, 2000),
      timestamp: Date.now()
    };

    io.to(roomId).emit("call-room-message", payload);
  });

  /* =========================
     NORMAL ROOM CHAT
  ========================= */

  socket.on("room-chat", data => {
    const targetRoom = normalizeRoom(
      data?.roomId ||
      data?.targetRoom ||
      data?.target
    );

    const message = String(
      data?.message || ""
    ).trim();

    if (!targetRoom || !message) return;

    const sender =
      socketUsers.get(socket.id) || {};

    const payload = {
      roomId: targetRoom,
      senderId: socket.id,
      senderName: sender.displayName || "USER",
      message: message.slice(0, 4000),
      mediaUrl: data?.mediaUrl || null,
      mediaType: data?.mediaType || null,
      timestamp: Date.now()
    };

    const targetSockets = rooms.get(targetRoom);

    if (!targetSockets || targetSockets.size === 0) {
      socket.emit("room-chat-error", {
        roomId: targetRoom,
        message: "User is offline"
      });

      return;
    }

    for (const targetSocketId of targetSockets) {
      io.to(targetSocketId).emit(
        "room-chat",
        payload
      );
    }

    // Sender also gets the message
    socket.emit("room-chat", payload);
  });

  /* =========================
     LEAVE ROOM
  ========================= */

  socket.on("leave-room", () => {
    const roomId = socketRooms.get(socket.id);

    if (!roomId) return;

    console.log(
      `LEAVE ROOM: ${socket.id} -> ${roomId}`
    );

    leaveCurrentRoom(socket);
  });

  /* =========================
     DISCONNECT
  ========================= */

  socket.on("disconnect", reason => {
    const roomId = socketRooms.get(socket.id);

    console.log(
      "DISCONNECTED:",
      socket.id,
      reason
    );

    if (roomId) {
      const room = rooms.get(roomId);

      if (room) {
        room.delete(socket.id);

        socket.to(roomId).emit("peer-left", {
          socketId: socket.id,
          roomId
        });

        if (room.size === 0) {
          rooms.delete(roomId);
        } else {
          io.to(roomId).emit("room-users", {
            roomId,
            users: getRoomUsers(roomId)
          });
        }
      }

      socketRooms.delete(socket.id);
    }

    socketUsers.delete(socket.id);
  });
});

/* =========================
   SERVER START
========================= */

server.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log(" CYBER MAP VIEWER SERVER");
  console.log("======================================");
  console.log(`PORT: ${PORT}`);
  console.log(`MAX USERS / ROOM: ${MAX_USERS_PER_ROOM}`);
  console.log("Socket.IO: ONLINE");
  console.log("WebRTC signaling: ONLINE");
  console.log("Room chat: ONLINE");
  console.log("Group calling: ONLINE");
  console.log("======================================");
});
