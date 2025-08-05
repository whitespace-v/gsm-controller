// logger.js
const pino = require("pino");
const pretty = require('pino-pretty')
const multistream = require("pino-multi-stream").multistream;

const streams = [
  { stream: pretty({colorize: true, destination: process.stdout}) },
  { stream: pretty({colorize: false, destination: "./logs/app.log"}) },
];

const logger = pino({ level: "info" }, multistream(streams),);
module.exports = logger;
