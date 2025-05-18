// server.js
const Koa = require("koa");
const Router = require("@koa/router");
const bodyParser = require("koa-bodyparser");
const ModemManager = require("./modemManager/modemManager");
const logger = require("./logger");
require("./shutdown");

// const logger = pino({ level: "info" });
const manager = new ModemManager();

const options = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  rtscts: false,
  xon: false,
  xoff: false,
  xany: false,
  autoDeleteOnReceive: true,
  enableConcatenation: true,
  incomingCallIndication: true,
  incomingSMSIndication: true,
  pin: "",
  customInitCommand: "",
  cnmiCommand: "AT+CNMI=2,1,0,2,1",
  logger: console,
};

// автозапуск всех модемов
manager.addModems(options);

const app = new Koa();
const router = new Router();

// Healthcheck
router.get("/", (ctx) => {
  ctx.body = { status: "ok" };
});

// Получить код SMS: GET /sms?from=+7914...
router.get("/sms", async (ctx) => {
  const from = ctx.query.from;
  if (!from) {
    ctx.status = 400;
    ctx.body = { error: "Нужно указать from" };
    return;
  }
  try {
    ctx.body = await manager.getCode(from);
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

// Баланс: GET /balance?from=%2B...
router.get("/balance", async (ctx) => {
  const from = ctx.query.from;
  if (!from) {
    ctx.status = 400;
    ctx.body = { error: "Нужно указать from" };
    return;
  }
  try {
    const bal = await manager.getBalanceByPhone(from);
    ctx.body = { phone: from, balance: bal };
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

// Отправка SMS: POST /send
router.post("/send", async (ctx) => {
  const { from, to, text } = ctx.request.body;
  if (!to || !text) {
    ctx.status = 400;
    ctx.body = { error: "to и text обязательны" };
    return;
  }
  try {
    ctx.body = await manager.sendSMSByPhone(from, to, text);
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

// История подключений: GET /history?from=%2B...
router.get("/history", async (ctx) => {
  const from = ctx.query.from;
  if (!from) {
    ctx.status = 400;
    ctx.body = { error: "Нужно указать from" };
    return;
  }
  try {
    ctx.body = await manager.getConnectionHistoryByPhone(from);
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

// Принудительный релоад модемов
router.post("/refresh-modems", (ctx) => {
  manager.addModems(options);
  ctx.body = { status: "refreshing" };
});

app.use(bodyParser()).use(router.routes()).use(router.allowedMethods());

const PORT = 3000;
app.listen(PORT, () => logger.info(`Server listening on ${PORT}`));
