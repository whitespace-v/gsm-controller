// modemManager.js
const { PrismaClient } = require("@prisma/client");
const prisma = require("./db");

const serialportgsm = require("serialport-gsm");
const { Modem } = serialportgsm;
let ussd = require("./node_modules/serialport-gsm/lib/functions/ussd.js");

const pino = require("pino");
const multistream = require("pino-multi-stream").multistream;
const streams = [
  { stream: process.stdout },
  { stream: pino.destination("./logs/app.log") },
];

const logger = pino({ level: "info" }, multistream(streams));

const DEFAULT_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 1 * 60 * 1000;
const MAX_RETRIES = 3;

class ModemManager {
  constructor() {
    // map: port → { modem, options, reconnectDelay, imei, phone }
    this.modems = new Map();
  }

  _getModemSerial(modem, timeout = 1000) {
    return new Promise((resolve, reject) => {
      modem.getModemSerial(
        (data) =>
          data?.data?.modemSerial
            ? resolve(data.data.modemSerial)
            : reject(new Error("Нет IMEI в ответе")),
        timeout,
      );
    });
  }

  _getSubscriberNumber(modem, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const onNewMessage = (messages) => {
        clearTimeout(timer);
        modem.removeListener("onNewMessage", onNewMessage);
        const text = messages[0]?.message || "";
        const m = text.match(/\+?\d{7,15}/);

        if (m) {
          resolve(m[0]);
        } else {
          reject(new Error("Не нашли номер в тексте USSD-ответа"));
          modem.close(); // закроем только этот модем
        }
      };

      const onTimeout = () => {
        modem.removeListener("onNewMessage", onNewMessage);
        reject(new Error("Timeout при получении номера SIM"));
        modem.close();
      };

      const timer = setTimeout(onTimeout, timeout);

      // Одноразовый слушатель
      modem.once("onNewMessage", onNewMessage);

      // Отправляем USSD и сразу проверяем статус
      modem.sendUSSD("*111*0887#", (data) => {
        if (data.status === "fail") {
          clearTimeout(timer);
          modem.removeListener("onNewMessage", onNewMessage);
          reject(new Error("USSD-запрос не прошёл: fail"));
          modem.close();
        }
        // иначе ждём события onNewMessage
      });
    });
  }

  addModems(options) {
    serialportgsm.list((err, devices) => {
      if (err) {
        logger.error({ err }, "Не удалось получить список портов");
        return;
      }
      devices.forEach((dev) => {
        if (!dev.pnpId) return;
        const port = dev.path;
        logger.info({ port }, "Найден GSM-модем");
        this.addModem(port, options);
      });
    });
  }

  async addModem(port, options) {
    const entry = {
      port,
      options,
      reconnectDelay: DEFAULT_RECONNECT_DELAY,
      retryCount: 0,
      imei: null,
      phone: null,
    };
    this.modems.set(port, entry);
    await this._createAndOpen(entry);
  }

  async _createAndOpen(entry) {
    const { port, options } = entry;
    const modem = Modem();
    modem.removeAllListeners(); // снимаем все слушатели
    ussd(modem);
    entry.modem = modem;
    // Если ещё не инициализировали модем (первый open), сбросим счётчики.
    entry.initialized ??= false;

    const tryOpen = async () => {
      try {
        await new Promise((res, rej) =>
          modem.open(port, options, (err) => (err ? rej(err) : res())),
        );
      } catch (err) {
        logger.warn({ port, msg: err.message }, "Ошибка открытия, retry");
        entry.reconnectDelay = Math.min(
          entry.reconnectDelay * 2,
          MAX_RECONNECT_DELAY,
        );
        return setTimeout(tryOpen, entry.reconnectDelay);
      }
    };
    tryOpen();

    modem.on("open", async () => {
      // --- если это первый open, сбрасываем retryCount и reconnectDelay ---
      if (!entry.initialized) {
        entry.initialized = true;
        entry.retryCount = 0;
        entry.reconnectDelay = DEFAULT_RECONNECT_DELAY;
        logger.info({ port }, "Modem впервые открыт, сбрасываем счётчики");
      } else {
        logger.info({ port }, "Modem успешно переподключился");
      }

      // получаем IMEI
      try {
        entry.imei = await this._getModemSerial(modem);
        logger.info({ port, imei: entry.imei }, "Прочитан IMEI");
      } catch (e) {
        logger.error({ port, err: e }, "Не удалось получить IMEI");
        return modem.close();
      }

      // получаем номер SIM (если нужно)
      try {
        entry.phone = await this._getSubscriberNumber(modem);
        entry.phone = "+" + entry.phone;
        logger.info({ port, phone: entry.phone }, "Прочитан номер SIM");
      } catch (e) {
        logger.warn({ port, err: e }, "Номер SIM не прочитан, оставим null");
      }

      // upsert ModemDevice
      const device = await prisma.modemDevice.upsert({
        where: { imei: entry.imei },
        update: { status: "connected", serialNumber: port },
        create: { imei: entry.imei, serialNumber: port, status: "connected" },
      });

      // upsert SimCard если мы знаем номер
      let sim = null;
      if (entry.phone) {
        sim = await prisma.simCard.upsert({
          where: { phoneNumber: entry.phone },
          update: { status: "active" },
          create: {
            phoneNumber: entry.phone,
            provider: "unknown",
            status: "active",
          },
        });
        // связка
        await prisma.modemDevice.update({
          where: { id: device.id },
          data: { currentSimId: sim.id },
        });
      }

      // история подключения
      if (sim) {
        await prisma.modemSimHistory.create({
          data: { modemId: device.id, simId: sim?.id || undefined },
        });
      }

      // инициализация дополнительных команд
      modem.initializeModem(() => logger.info({ port }, "Modem initialized"));
    });

    modem.on("close", async () => {
      if (++entry.retryCount > MAX_RETRIES) {
        logger.error(
          { port, retry: entry.retryCount },
          `Превышено число попыток (${MAX_RETRIES}), отменяем переподключение`,
        );
        modem.removeAllListeners();
        return;
      }

      modem.removeAllListeners(); // снимаем все слушатели

      logger.warn({ port }, "Порт закрылся, переподключаемся");
      if (entry.imei) {
        try {
          const device = await prisma.modemDevice.findUnique({
            where: { imei: entry.imei },
          });
          await prisma.modemSimHistory.updateMany({
            where: { modemId: device.id, disconnectedAt: null },
            data: { disconnectedAt: new Date() },
          });
          await prisma.modemDevice.update({
            where: { id: device.id },
            data: { status: "disconnected" },
          });
        } catch (e) {
          logger.error({ err: e }, "Ошибка при маркировке отключения");
        }
      }

      // иначе экспоненциальный бэкофф и новая попытка
      entry.reconnectDelay = Math.min(
        entry.reconnectDelay * 2,
        MAX_RECONNECT_DELAY,
      );
      logger.info(
        { port, retry: entry.retryCount, delay: entry.reconnectDelay },
        "Попытка переподключения",
      );

      setTimeout(() => this._createAndOpen(entry), entry.reconnectDelay);
    });

    modem.on("error", (err) => {
      logger.error({ port, err }, "Ошибка модема");
      try {
        modem.close();
      } catch {}
    });
  }

  async saveIncoming(entry, { sender, dateTimeSent, message }) {
    const device = await prisma.modemDevice.findUnique({
      where: { imei: entry.imei },
    });
    const simId = device.currentSimId;

    // сбросить expire у старых
    await prisma.smsIncoming.updateMany({
      where: { modemDeviceId: device.id, expire: false },
      data: { expire: true },
    });

    // сохранить новое
    await prisma.smsIncoming.create({
      data: {
        modemDeviceId: device.id,
        simCardId: simId,
        sender,
        receivedAt: dateTimeSent,
        text: message,
        expire: false,
      },
    });
  }

  /**
   * Ожидает прихода SMS на данном SIM в течение 20 секунд,
   * сохраняет сообщение в базу и возвращает его текст.
   */
  async getCode(phone) {
    // 1) Ищем SimCard и связанный ModemDevice
    const sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone },
    });
    if (!sim) throw new Error("SIM не зарегистрирована");

    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });
    if (!device) throw new Error("SIM не привязана к модему");

    // 2) Достаём entry с самим modem-объектом
    const entry = this.modems.get(device.serialNumber);
    if (!entry) throw new Error("Modem не запущен");

    const modem = entry.modem;

    // 3) Возвращаем promise, который ждёт onNewMessage
    const codeText = await new Promise((resolve, reject) => {
      // таймаут на 20 секунд
      const timer = setTimeout(() => {
        modem.removeListener("onNewMessage", handler);
        reject(new Error("Timeout: SMS не пришло за 20 секунд"));
      }, 60_000);

      // одноразовый обработчик
      const handler = async (messages) => {
        clearTimeout(timer);
        modem.removeListener("onNewMessage", handler);

        const msg = messages[0];
        const { sender, message, dateTimeSent } = msg;

        // сохраняем входящее сообщение (expire=false)
        try {
          await this.saveIncoming(entry, {
            sender,
            dateTimeSent,
            message,
          });
        } catch (e) {
          // логируем, но не прерываем
          logger.error({ err: e }, "Ошибка сохранения SMS из getCode");
        }

        resolve(message);
      };

      modem.once("onNewMessage", handler);
    });

    return codeText;
  }

  async sendSMSByPhone(fromPhone, to, text) {
    const sim = await prisma.simCard.findUnique({
      where: { phoneNumber: fromPhone },
    });
    if (!sim) throw new Error("SIM не зарегистрирована");
    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });
    if (!device) throw new Error("SIM не привязана");

    const entry = this.modems.get(device.serialNumber);
    if (!entry) throw new Error("Modem не запущен");

    return new Promise((res, rej) => {
      entry.modem.sendSMS(to, text, false, (data) => {
        if (data.error) rej(data);
        else res(data);
      });
    });
  }

  async getBalanceByPhone(phone) {
    const sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone },
    });
    if (!sim) throw new Error("SIM не зарегистрирована");
    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });
    if (!device) throw new Error("SIM не привязана");

    const entry = this.modems.get(device.serialNumber);
    if (!entry) throw new Error("Modem не запущен");

    const modem = entry.modem;
    // ждём ответа на USSD
    const resp = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        modem.removeAllListeners("onNewIncomingUSSD");
        reject(new Error("USSD timeout"));
      }, 15000);

      modem.once("onNewIncomingUSSD", (data) => {
        clearTimeout(timer);
        resolve(data);
      });

      modem.sendUSSD("*100#", () => {});
    });

    return resp;
  }

  async getConnectionHistoryByPhone(phone) {
    const sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone },
    });
    if (!sim) throw new Error("SIM не зарегистрирована");

    const history = await prisma.modemSimHistory.findMany({
      where: { simId: sim.id },
      orderBy: { connectedAt: "desc" },
      include: { modemDevice: { select: { serialNumber: true, imei: true } } },
    });

    return history.map((h) => ({
      modemSerial: h.modemDevice.serialNumber,
      modemImei: h.modemDevice.imei,
      connectedAt: h.connectedAt,
      disconnectedAt: h.disconnectedAt || null,
    }));
  }
}

module.exports = ModemManager;
