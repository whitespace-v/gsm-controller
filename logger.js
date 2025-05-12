// logger.js
const pino = require("pino");
const multistream = require("pino-multi-stream").multistream;

const streams = [
  { stream: process.stdout },
  { stream: pino.destination("./logs/app.log") },
];

const logger = pino({ level: "info" }, multistream(streams));
module.exports = logger;
