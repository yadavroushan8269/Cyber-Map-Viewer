const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// DATA SETUP
// ============================================

const dataDir = path.join(__dirname, "data");
const usersFile = path.join(dataDir, "users.json");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(usersFile)) {
  fs.writeFileSync(usersFile, "[]");
}

// ============================================
// MIDDLEWARE
// ============================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

// ============================================
// HELPERS
// ============================================

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(usersFile, "utf8"));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(
    usersFile,
    JSON.stringify(users, null, 2)
  );
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString("hex");

  return {
    salt,
    hash
  };
}

function checkPassword(password, user) {
  const hash = crypto
    .scryptSync(password, user.salt, 64)
    .toString("hex");

  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(user.passwordHash, "hex")
  );
}

// ============================================
// SIMPLE SESSION SYSTEM
// ============================================

const sessions = new Map();

function createSession(username) {
  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    username,
    createdAt: Date.now()
  });

  return token;
}

function getUserFromRequest(req) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Bearer ")) {
    return null;
  }

  const token = auth.substring(7);
  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  const users = readUsers();

  return users.find(
    user => user.username === session.username
  ) || null;
}

function requireLogin(req, res, next) {
  const user = getUserFromRequest(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Please login first."
    });
  }

  req.user = user;
  next();
}

// ============================================
// REGISTER
// ============================================

app.post("/api/register", (req, res) => {
  const username = String(req.body.username || "")
    .trim()
    .toLowerCase();

  const password = String(req.body.password || "");

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password required."
    });
  }

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({
      success: false,
      message:
        "Username must be 3-20 characters and use only letters, numbers or _."
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters."
    });
  }

  const users = readUsers();

  const exists = users.some(
    user => user.username === username
  );

  if (exists) {
    return res.status(409).json({
      success: false,
      message: "Username already exists."
    });
  }

  const passwordData = hashPassword(password);

  const newUser = {
    id: crypto.randomUUID(),
    username,
    passwordHash: passwordData.hash,
    salt: passwordData.salt,
    points: 10000,
    round: 1001,
    history: [],
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsers(users);

  const token = createSession(username);

  res.json({
    success: true,
    token,
    user: {
      username: newUser.username,
      points: newUser.points,
      round: newUser.round,
      history: newUser.history
    }
  });
});

// ============================================
// LOGIN
// ============================================

app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "")
    .trim()
    .toLowerCase();

  const password = String(req.body.password || "");

  const users = readUsers();

  const user = users.find(
    item => item.username === username
  );

  if (!user || !checkPassword(password, user)) {
    return res.status(401).json({
      success: false,
      message: "Invalid username or password."
    });
  }

  const token = createSession(username);

  res.json({
    success: true,
    token,
    user: {
      username: user.username,
      points: user.points,
      round: user.round,
      history: user.history
    }
  });
});

// ============================================
// LOGOUT
// ============================================

app.post("/api/logout", (req, res) => {
  const auth = req.headers.authorization;

  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.substring(7);
    sessions.delete(token);
  }

  res.json({
    success: true
  });
});

// ============================================
// CURRENT USER
// ============================================

app.get("/api/me", requireLogin, (req, res) => {
  res.json({
    success: true,
    user: {
      username: req.user.username,
      points: req.user.points,
      round: req.user.round,
      history: req.user.history
    }
  });
});

// ============================================
// PLAY ROUND
// ============================================

app.post("/api/play", requireLogin, (req, res) => {
  const selected = String(req.body.colour || "");

  const allowed = [
    "Red",
    "Green",
    "Purple"
  ];

  if (!allowed.includes(selected)) {
    return res.status(400).json({
      success: false,
      message: "Invalid colour."
    });
  }

  const users = readUsers();

  const user = users.find(
    item => item.username === req.user.username
  );

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found."
    });
  }

  const result =
    allowed[Math.floor(Math.random() * allowed.length)];

  const correct = result === selected;

  if (correct) {
    user.points += 100;
  }

  const historyItem = {
    round: user.round,
    selected,
    result,
    correct,
    time: new Date().toLocaleTimeString()
  };

  user.history.unshift(historyItem);

  if (user.history.length > 20) {
    user.history = user.history.slice(0, 20);
  }

  user.round++;

  saveUsers(users);

  res.json({
    success: true,
    result,
    correct,
    points: user.points,
    round: user.round,
    history: user.history
  });
});

// ============================================
// FRONTEND
// ============================================

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html")
  );
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
