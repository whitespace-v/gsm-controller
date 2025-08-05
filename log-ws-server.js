const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const LOG_FILE_PATH = path.join(__dirname, "logs", "app.log");
const PORT = 7710;

const wss = new WebSocket.Server({ port: PORT, host: "0.0.0.0" }, () => {
  console.log(`WebSocket log server running on ws://localhost:${PORT}`);
});

let clients = [];

wss.on("connection", (ws) => {
  console.log("Client connected to log stream");
  clients.push(ws);

  ws.on("close", () => {
    clients = clients.filter((client) => client !== ws);
    console.log("Client disconnected");
  });
});

// 3️⃣ Стримим новые строки
const tail = spawn("tail", ["-n", "0", "-F", LOG_FILE_PATH]);

tail.stdout.on("data", (data) => {
  const logLine = data.toString();
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(logLine);
    }
  });
});

tail.stderr.on("data", (err) => {
  console.error("Tail error:", err.toString());
});
