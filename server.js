const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Public folder
const publicFolder = path.join(__dirname, "public");

// Static files
app.use(express.static(publicFolder));

// Main website
app.get("/", (req, res) => {
  res.sendFile(path.join(publicFolder, "index.html"));
});

// Fallback
app.use((req, res) => {
  res.sendFile(path.join(publicFolder, "index.html"));
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`CCTV website running on port ${PORT}`);
});
