const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = process.env.PORT || 10000;
const MAX_USERS_PER_ROOM = 6;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "Cyber Map Viewer", maxUsersPerRoom: MAX_USERS_PER_ROOM }));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

function cleanRoom(room) { return String(room || "").trim().toUpperCase(); }

function leaveRoom(socket) {
  const room = socket.data.room;
  if (!room) return;
  socket.to(room).emit("peer-left", { peerId: socket.id, displayName: socket.data.displayName || "USER" });
  socket.leave(room);
  socket.data.room = null;
}

io.on("connection", socket => {
  console.log("CONNECTED:", socket.id);

  socket.on("join-room", (payload = {}) => {
    const room = cleanRoom(typeof payload === "string" ? payload : payload.room);
    const displayName = String(typeof payload === "object" ? payload.displayName || "USER" : "USER").trim() || "USER";
    if (!room) return;

    if (socket.data.room === room) {
      const members = io.sockets.adapter.rooms.get(room);
      const users = members ? [...members].filter(id => id !== socket.id).map(id => ({
        peerId: id,
        displayName: io.sockets.sockets.get(id)?.data?.displayName || "USER"
      })) : [];
      socket.emit("room-joined", { room, count: members?.size || 1, users });
      return;
    }

    if (socket.data.room) leaveRoom(socket);

    const existing = io.sockets.adapter.rooms.get(room);
    const count = existing ? existing.size : 0;
    if (count >= MAX_USERS_PER_ROOM) {
      socket.emit("room-full", { room, max: MAX_USERS_PER_ROOM });
      return;
    }

    const existingUsers = existing ? [...existing] : [];
    socket.join(room);
    socket.data.room = room;
    socket.data.displayName = displayName;

    const users = existingUsers.map(id => ({
      peerId: id,
      displayName: io.sockets.sockets.get(id)?.data?.displayName || "USER"
    }));

    socket.emit("room-joined", { room, count: existingUsers.length + 1, users });
    socket.to(room).emit("peer-joined", { peerId: socket.id, displayName });
    socket.to(room).emit("room-users", { room, users: [{ peerId: socket.id, displayName }] });
    console.log(`${socket.id} joined ${room} (${existingUsers.length + 1}/${MAX_USERS_PER_ROOM})`);
  });

  socket.on("call-user", ({ targetRoom } = {}) => {
    const room = cleanRoom(targetRoom);
    if (!room) return;
    const targetSet = io.sockets.adapter.rooms.get(room);
    if (!targetSet || targetSet.size === 0) {
      socket.emit("call-unavailable", { targetRoom: room });
      return;
    }

    const callRoom = `CALL-${socket.id}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`.toUpperCase();
    socket.data.pendingCallRoom = callRoom;
    socket.data.pendingTargetRoom = room;
    let sent = false;
    for (const targetId of targetSet) {
      if (targetId === socket.id) continue;
      const targetSocket = io.sockets.sockets.get(targetId);
      if (!targetSocket) continue;
      targetSocket.data.incomingCallerId = socket.id;
      targetSocket.data.incomingCallRoom = callRoom;
      io.to(targetId).emit("incoming-call", {
        callerId: socket.id,
        callerRoom: room,
        callerName: socket.data.displayName || "USER",
        callRoom
      });
      sent = true;
    }
    socket.emit(sent ? "call-ringing" : "call-unavailable", { targetRoom: room, callRoom });
  });

  socket.on("accept-call", ({ callerId, callRoom } = {}) => {
    if (!callerId) return;
    const caller = io.sockets.sockets.get(callerId);
    if (!caller) { socket.emit("call-unavailable", { targetRoom: "CALLER_OFFLINE" }); return; }
    const targetCallRoom = String(callRoom || caller.data.pendingCallRoom || "").trim();
    if (!targetCallRoom) return;
    socket.data.activeCallRoom = targetCallRoom;
    caller.data.activeCallRoom = targetCallRoom;
    io.to(callerId).emit("call-accepted", {
      acceptedBy: socket.id,
      accepterId: socket.id,
      accepterName: socket.data.displayName || "USER",
      callRoom: targetCallRoom
    });
  });

  socket.on("reject-call", ({ callerId } = {}) => {
    if (!callerId) return;
    io.to(callerId).emit("call-rejected", { rejectedBy: socket.id, rejectedName: socket.data.displayName || "USER" });
  });

  socket.on("webrtc-signal", ({ targetId, signal } = {}) => {
    if (!targetId || !signal) return;
    io.to(targetId).emit("webrtc-signal", {
      senderId: socket.id,
      senderName: socket.data.displayName || "USER",
      signal
    });
  });

  socket.on("end-call", ({ targetId } = {}) => {
    if (targetId) io.to(targetId).emit("call-ended", { endedBy: socket.id });
    else if (socket.data.activeCallRoom) io.to(socket.data.activeCallRoom).emit("call-ended", { endedBy: socket.id });
    socket.data.activeCallRoom = null;
  });

  socket.on("end-group-call", ({ room } = {}) => {
    const target = cleanRoom(room) || socket.data.room;
    if (target) io.to(target).emit("group-call-ended", { endedBy: socket.id });
  });

  socket.on("call-room-message", ({ room, message, mediaUrl, type } = {}) => {
    const target = cleanRoom(room) || socket.data.room;
    if (!target) return;
    const members = io.sockets.adapter.rooms.get(target);
    if (!members || !members.size) return;
    const payload = {
      fromId: socket.id,
      fromName: socket.data.displayName || "USER",
      message: String(message || "").trim(),
      mediaUrl: String(mediaUrl || ""),
      type: type || "text"
    };
    io.to(target).emit("call-room-message", payload);
  });

  socket.on("chat-message", ({ targetId, message, mediaUrl, type } = {}) => {
    const text = String(message || "").trim();
    if (!targetId && !socket.data.room) return;
    const payload = { fromId: socket.id, fromName: socket.data.displayName || "USER", message: text, mediaUrl: String(mediaUrl || ""), type: type || "text" };
    if (targetId) io.to(targetId).emit("chat-message", payload);
    else socket.to(socket.data.room).emit("chat-message", payload);
  });

  socket.on("room-chat", ({ targetRoom, message, mediaUrl, type } = {}) => {
    const room = cleanRoom(targetRoom);
    const text = String(message || "").trim();
    if (!room) return;
    const targetSet = io.sockets.adapter.rooms.get(room);
    if (!targetSet || targetSet.size === 0) {
      socket.emit("room-chat-unavailable", { targetRoom: room });
      return;
    }
    const payload = { fromId: socket.id, fromName: socket.data.displayName || "USER", message: text, mediaUrl: String(mediaUrl || ""), type: type || "text" };
    socket.to(room).emit("room-chat", payload);
    socket.emit("room-chat-sent", { targetRoom: room });
  });

  socket.on("leave-room", () => leaveRoom(socket));
  socket.on("disconnect", reason => { leaveRoom(socket); console.log("DISCONNECTED:", socket.id, reason); });
});

server.listen(PORT, "0.0.0.0", () => console.log(`Cyber Map Viewer running on port ${PORT}`));
