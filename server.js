const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ======================================================
// SOCKET.IO
// ======================================================

const users = new Map();

/*
users:
socket.id -> {
  userId,
  displayName
}
*/

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // ----------------------------------------------------
  // USER ONLINE
  // ----------------------------------------------------

  socket.on("register-user", (data = {}) => {
    const userId = String(data.userId || "").trim();
    const displayName = String(data.displayName || "User").trim();

    if (!userId) return;

    users.set(socket.id, {
      userId,
      displayName
    });

    socket.join(`user:${userId}`);

    console.log(
      `User registered: ${displayName} (${userId})`
    );

    socket.emit("user-registered", {
      success: true
    });
  });

  // ----------------------------------------------------
  // AUDIO / VIDEO CALL
  // ----------------------------------------------------

  socket.on("call-user", (data = {}) => {
    const caller = users.get(socket.id);

    if (!caller) {
      socket.emit("call-error", {
        message: "User session not registered."
      });
      return;
    }

    const targetUserId = String(data.targetUserId || "").trim();
    const callType =
      data.callType === "audio" ? "audio" : "video";

    if (!targetUserId) {
      socket.emit("call-error", {
        message: "Target user not found."
      });
      return;
    }

    if (targetUserId === caller.userId) {
      socket.emit("call-error", {
        message: "You cannot call yourself."
      });
      return;
    }

    io.to(`user:${targetUserId}`).emit("incoming-call", {
      callId: socket.id,
      callerId: caller.userId,
      callerName: caller.displayName,
      callType
    });

    socket.emit("call-ringing", {
      targetUserId,
      callType
    });
  });

  // ----------------------------------------------------
  // ACCEPT CALL
  // ----------------------------------------------------

  socket.on("accept-call", (data = {}) => {
    const receiver = users.get(socket.id);

    if (!receiver) return;

    const callerSocketId = String(
      data.callerSocketId || ""
    ).trim();

    if (!callerSocketId) return;

    io.to(callerSocketId).emit("call-accepted", {
      receiverId: receiver.userId,
      receiverName: receiver.displayName
    });
  });

  // ----------------------------------------------------
  // REJECT CALL
  // ----------------------------------------------------

  socket.on("reject-call", (data = {}) => {
    const receiver = users.get(socket.id);

    if (!receiver) return;

    const callerSocketId = String(
      data.callerSocketId || ""
    ).trim();

    if (!callerSocketId) return;

    io.to(callerSocketId).emit("call-rejected", {
      receiverId: receiver.userId,
      receiverName: receiver.displayName
    });
  });

  // ----------------------------------------------------
  // END CALL
  // ----------------------------------------------------

  socket.on("end-call", (data = {}) => {
    const otherSocketId = String(
      data.otherSocketId || ""
    ).trim();

    if (!otherSocketId) return;

    io.to(otherSocketId).emit("call-ended");
  });

  // ----------------------------------------------------
  // WEBRTC SIGNALING
  // ----------------------------------------------------

  socket.on("webrtc-signal", (data = {}) => {
    const targetSocketId = String(
      data.targetSocketId || ""
    ).trim();

    if (!targetSocketId) return;

    io.to(targetSocketId).emit("webrtc-signal", {
      senderSocketId: socket.id,
      signal: data.signal
    });
  });

  // ----------------------------------------------------
  // DISCONNECT
  // ----------------------------------------------------

  socket.on("disconnect", () => {
    const user = users.get(socket.id);

    if (user) {
      console.log(
        `Disconnected: ${user.displayName} (${user.userId})`
      );
    }

    users.delete(socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Past Snap running on port ${PORT}`);
});
