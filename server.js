// server.js
const Koa = require("koa");
const Router = require("@koa/router");
const bodyParser = require("koa-bodyparser");
const path = require("path");
const ModemManager = require("./modemManager/modemManager");
const logger = require("./utils/logger");
require("./utils/shutdown");

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
  customInitCommand: "AT^CURC=0",
  cnmiCommand: "AT+CNMI=2,1,0,2,1",
  // logger: console,
};

// автозапуск всех модемов
manager.addModems(options);

const app = new Koa();
const router = new Router();

router.get("/", (ctx) => {
  ctx.body = { status: "ok" };
});

// Получить код с конкретной симкарты (from=<номер телефона>)
router.get("/gsm/api/whale/code", async (ctx) => {
  const from = ctx.query.from;
  if (!from) {
    ctx.status = 400;
    ctx.body = { error: "Нужно указать from" };
    return;
  }
  try {
    const code = await manager.getCode(from);
    ctx.body = { phone: from, code: code };
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

// Получение смс с конкретной симкарты (from=<номер телефона>)
router.get("/gsm/api/debug/sms", async (ctx) => {
  const from = ctx.query.from;
  if (!from) {
    ctx.status = 400;
    ctx.body = { error: "Нужно указать from" };
    return;
  }
  try {
    const sms = await manager.getMessage(from);
    sender = sms.sender
    sender ? sender : sender=null
    ctx.body = { phone: from, sender: sender, message: sms.message};
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

// Получение баланса конкретной симкарты (from=<номер телефона>)
router.get("/gsm/api/debug/balance", async (ctx) => {
  const from = ctx.query.from;
  if (!from) {
    ctx.status = 400;
    ctx.body = { error: "Нужно указать from" };
    return;
  }
  try {
    const bal = await manager.getBalanceByPhone(from);
    if (bal == "busy") {
      ctx.body = { phone: from, error: "Симкарта занята" };
    } else {
      ctx.body = { phone: from, balance: bal };
    }
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

// Получение баланса со всех симкарт
router.get("/gsm/api/debug/allbalances", async (ctx) => {
  try {
    ctx.body = await manager.getBalanceByAllPhones();
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

// Удаление сообщений со всех симкарт
router.get("/gsm/api/debug/deletemessages", async (ctx) => {
  try {
    ctx.body = await manager.deleteMessagesFromAllPhones();
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

// Отправка SMS с симкарты (опционально можно указать с какой конкретно симкарты прислать смс серез from=<номер телефона>)
router.post("/gsm/api/2fa/send", async (ctx) => {
  const from = ctx.query.from;
  const { to, text } = ctx.request.body;
  if (!to || !text) {
    ctx.status = 400;
    ctx.body = { error: "to и text обязательны" };
    return;
  }
  try {
    let resp;
    from
      ? (resp = await manager.sendSMSByPhone(from, to, text))
      : (resp = await manager.sendSMS(to, text));
    ctx.body = { status: resp.data.response };
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

// История подключений конкретной симкарты (from=<номер телефона>)
router.get("/gsm/api/debug/history", async (ctx) => {
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

// Принудительная перезагрузка всех модемов
router.post("/gsm/api/debug/refreshallmodems", (ctx) => {
  manager.addModems(options);
  ctx.body = { status: "refreshing" };
});

// Принудительная перезагрузка конкретных симкарт (например: {+79841894786, +79147274837})
router.post("/gsm/api/debug/refreshmodems", async (ctx) => {
  const { phones } = ctx.request.body;
  if (!phones) {
    ctx.status = 400;
    ctx.body = { error: "Нужно указать массив номеров phones" };
    return;
  }
  try {
    ctx.body = await manager.refreshModem(phones, options);
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

router.get("/gsm/api/logs", async (ctx) => {
  const page = ctx.query.page;
  const numbers = ctx.query.numbers;

  try {
    if (!page && !numbers) {
      ctx.body = await manager._getLogs();
    } else if (!page && numbers) {
      ctx.body = await manager._getLogs(1, numbers);
    } else if (page && !numbers) {
      ctx.body = await manager._getLogs(page, 30);
    } else if (page && numbers) {
      ctx.body = await manager._getLogs(page, numbers);
    }
  } catch (e) {
    ctx.status = 500;
    ctx.body = { error: e.message };
  }
});

app.use(bodyParser()).use(router.routes()).use(router.allowedMethods());

const PORT = 7777;
app.listen(PORT, () => logger.info(`Server listening on ${PORT}`));
