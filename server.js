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
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 10000;
const MAX_USERS_PER_ROOM = 2;

/* =========================
   EXPRESS
========================= */

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const publicPath = path.join(__dirname, "public");

app.use(express.static(publicPath));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "Cyber Map Viewer",
    time: new Date().toISOString()
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

/* =========================
   SOCKET STATE
========================= */

// socket.id -> user information
const users = new Map();

// roomId -> Set(socket.id)
const rooms = new Map();

/* =========================
   ROOM HELPERS
========================= */

function normalizeRoom(room) {
  return String(room || "").trim().toUpperCase();
}

function addToRoom(room, socketId) {
  room = normalizeRoom(room);

  if (!room) {
    return {
      ok: false,
      reason: "invalid-room"
    };
  }

  if (!rooms.has(room)) {
    rooms.set(room, new Set());
  }

  const members = rooms.get(room);

  if (!members.has(socketId) && members.size >= MAX_USERS_PER_ROOM) {
    return {
      ok: false,
      reason: "room-full"
    };
  }

  members.add(socketId);

  return {
    ok: true,
    room
  };
}

function removeFromRoom(room, socketId) {
  room = normalizeRoom(room);

  if (!room || !rooms.has(room)) {
    return;
  }

  const members = rooms.get(room);

  members.delete(socketId);

  if (members.size === 0) {
    rooms.delete(room);
  }
}

function findSocketByRoom(room) {
  room = normalizeRoom(room);

  const members = rooms.get(room);

  if (!members || members.size === 0) {
    return null;
  }

  for (const socketId of members) {
    const socket = io.sockets.sockets.get(socketId);

    if (socket) {
      return socket;
    }
  }

  return null;
}

function getRoomMembers(room) {
  room = normalizeRoom(room);

  const members = rooms.get(room);

  if (!members) {
    return [];
  }

  return [...members];
}

/* =========================
   SOCKET CONNECTION
========================= */

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  users.set(socket.id, {
    socketId: socket.id,
    room: null,
    callPeer: null
  });

  /* =========================
     JOIN ROOM
  ========================= */

  socket.on("join-room", (room) => {
    room = normalizeRoom(room);

    if (!room) {
      socket.emit("room-error", {
        message: "Invalid room ID."
      });
      return;
    }

    const user = users.get(socket.id);

    // Already inside same room
    if (user && user.room === room) {
      socket.emit("room-joined", {
        room,
        users: getRoomMembers(room).length
      });
      return;
    }

    // Leave previous room
    if (user && user.room) {
      removeFromRoom(user.room, socket.id);
    }

    const result = addToRoom(room, socket.id);

    if (!result.ok) {
      if (result.reason === "room-full") {
        socket.emit("room-full", {
          room,
          maxUsers: MAX_USERS_PER_ROOM
        });
      } else {
        socket.emit("room-error", {
          message: "Unable to join room."
        });
      }

      return;
    }

    if (user) {
      user.room = room;
    }

    socket.join(room);

    const members = getRoomMembers(room);

    socket.emit("room-joined", {
      room,
      users: members.length
    });

    socket.to(room).emit("user-joined", {
      socketId: socket.id,
      room
    });

    console.log(
      `Socket ${socket.id} joined room ${room}. Users: ${members.length}`
    );
  });

  /* =========================
     CALL USER
  ========================= */

  socket.on("call-user", ({ targetRoom }) => {
    targetRoom = normalizeRoom(targetRoom);

    if (!targetRoom) {
      socket.emit("call-unavailable", {
        reason: "invalid-room"
      });
      return;
    }

    const caller = users.get(socket.id);

    if (!caller) {
      socket.emit("call-unavailable", {
        reason: "caller-not-found"
      });
      return;
    }

    const targetSocket = findSocketByRoom(targetRoom);

    if (!targetSocket) {
      socket.emit("call-unavailable", {
        room: targetRoom,
        reason: "offline"
      });

      return;
    }

    if (targetSocket.id === socket.id) {
      socket.emit("call-unavailable", {
        room: targetRoom,
        reason: "self-call"
      });

      return;
    }

    const targetUser = users.get(targetSocket.id);

    caller.callPeer = targetSocket.id;

    if (targetUser) {
      targetUser.callPeer = socket.id;
    }

    socket.emit("call-ringing", {
      targetRoom,
      targetId: targetSocket.id
    });

    targetSocket.emit("incoming-call", {
      callerId: socket.id,
      callerRoom: caller.room || "",
      callerName: "Cyber Map User"
    });

    console.log(
      `Call: ${socket.id} -> ${targetSocket.id} (${targetRoom})`
    );
  });

  /* =========================
     ACCEPT CALL
  ========================= */

  socket.on("accept-call", ({ callerId }) => {
    if (!callerId) {
      return;
    }

    const callerSocket = io.sockets.sockets.get(callerId);

    if (!callerSocket) {
      socket.emit("call-unavailable", {
        reason: "caller-offline"
      });

      return;
    }

    const user = users.get(socket.id);
    const caller = users.get(callerId);

    if (user) {
      user.callPeer = callerId;
    }

    if (caller) {
      caller.callPeer = socket.id;
    }

    callerSocket.emit("call-accepted", {
      acceptedBy: socket.id,
      acceptedRoom: user?.room || ""
    });

    console.log(
      `Call accepted: ${socket.id} <- ${callerId}`
    );
  });

  /* =========================
     REJECT CALL
  ========================= */

  socket.on("reject-call", ({ callerId }) => {
    if (!callerId) {
      return;
    }

    const callerSocket = io.sockets.sockets.get(callerId);

    if (callerSocket) {
      callerSocket.emit("call-rejected", {
        rejectedBy: socket.id
      });
    }

    const user = users.get(socket.id);

    if (user) {
      user.callPeer = null;
    }

    console.log(
      `Call rejected: ${socket.id} <- ${callerId}`
    );
  });

  /* =========================
     WEBRTC SIGNAL
  ========================= */

  socket.on("webrtc-signal", ({ targetId, signal }) => {
    if (!targetId || !signal) {
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetId);

    if (!targetSocket) {
      socket.emit("call-unavailable", {
        reason: "peer-disconnected"
      });

      return;
    }

    targetSocket.emit("webrtc-signal", {
      senderId: socket.id,
      signal
    });
  });

  /* =========================
     END CALL
  ========================= */

  socket.on("end-call", ({ targetId }) => {
    if (targetId) {
      const targetSocket = io.sockets.sockets.get(targetId);

      if (targetSocket) {
        targetSocket.emit("call-ended", {
          endedBy: socket.id
        });
      }
    }

    const user = users.get(socket.id);

    if (user) {
      user.callPeer = null;
    }

    if (targetId) {
      const targetUser = users.get(targetId);

      if (targetUser) {
        targetUser.callPeer = null;
      }
    }

    console.log("Call ended:", socket.id, targetId || "");
  });

  /* =========================
     CHAT DURING CALL
  ========================= */

  socket.on("chat-message", ({ targetId, message }) => {
    if (!targetId || !message) {
      return;
    }

    const cleanMessage = String(message).trim();

    if (!cleanMessage) {
      return;
    }

    if (cleanMessage.length > 2000) {
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetId);

    if (!targetSocket) {
      return;
    }

    targetSocket.emit("chat-message", {
      senderId: socket.id,
      message: cleanMessage,
      createdAt: Date.now()
    });
  });

  /* =========================
     LEAVE ROOM
  ========================= */

  socket.on("leave-room", () => {
    const user = users.get(socket.id);

    if (!user) {
      return;
    }

    if (user.room) {
      const oldRoom = user.room;

      removeFromRoom(oldRoom, socket.id);
      socket.leave(oldRoom);

      socket.to(oldRoom).emit("user-left", {
        socketId: socket.id,
        room: oldRoom
      });

      user.room = null;
    }
  });

  /* =========================
     DISCONNECT
  ========================= */

  socket.on("disconnect", (reason) => {
    console.log(
      "Socket disconnected:",
      socket.id,
      reason
    );

    const user = users.get(socket.id);

    if (!user) {
      return;
    }

    // End active call
    if (user.callPeer) {
      const peerSocket = io.sockets.sockets.get(user.callPeer);

      if (peerSocket) {
        peerSocket.emit("call-ended", {
          endedBy: socket.id
        });

        const peerUser = users.get(user.callPeer);

        if (peerUser) {
          peerUser.callPeer = null;
        }
      }
    }

    // Remove from room
    if (user.room) {
      const oldRoom = user.room;

      removeFromRoom(oldRoom, socket.id);

      socket.to(oldRoom).emit("user-left", {
        socketId: socket.id,
        room: oldRoom
      });
    }

    users.delete(socket.id);
  });
});

/* =========================
   404 FALLBACK
========================= */

app.use((req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

/* =========================
   ERROR HANDLER
========================= */

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  res.status(500).json({
    error: "Internal server error"
  });
});

/* =========================
   START SERVER
========================= */

server.listen(PORT, "0.0.0.0", () => {
  console.log("====================================");
  console.log(" Cyber Map Viewer");
  console.log(" Server running");
  console.log(" Port:", PORT);
  console.log(" Max users per room:", MAX_USERS_PER_ROOM);
  console.log("====================================");
});

/* =========================
   SAFE SHUTDOWN
========================= */

function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);

  io.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
