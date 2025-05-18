// modemManager.js
const getConnectionHistoryByPhone = require("../modemManager/methods/getConnectionHistoryByPhone.js");
const getBalanceByPhone = require("../modemManager/methods/getBalanceByPhone.js");
const sendSMSByPhone = require("../modemManager/methods/sendSMSByPhone.js");
const getCode = require("../modemManager/methods/getCode.js");
const ussd = require("../node_modules/serialport-gsm/lib/functions/ussd.js");
const prisma = require("../utils/db");
const logger = require("../utils/logger");

const serialportgsm = require("serialport-gsm");
const { Modem } = serialportgsm;

const DEFAULT_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 1 * 60 * 1000;
const MAX_RETRIES = 3;

class ModemManager {
  constructor() {
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

  _getSubscriberNumber(modem, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const onNewMessage = (messages) => {
        clearTimeout(timer);
        console.log(messages);
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
      modem.on("onNewMessage", onNewMessage);

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
        this._addModem(port, options);
      });
    });
  }

  async _addModem(port, options) {
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

  _parseBalance(input) {
    // Убираем все пробелы и лишние символы
    input = input.trim();
    // Определяем знак
    let isNegative = input.includes("Минус:");
    // Убираем префикс ("Минус:" или "Баланс:")
    let cleaned = input
      .replace("Минус:", "")
      .replace("Баланс:", "")
      .replace("р", "")
      .replace(",", ".")
      .trim();
    // Добавляем минус, если нужно
    let value = isNegative ? `-${cleaned}` : cleaned;

    return value;
  }

  async _saveIncoming(entry, { sender, dateTimeSent, message }) {
    const device = await prisma.modemDevice.findUnique({
      where: { imei: entry.imei },
    });
    const simId = device.currentSimId;

    // сохранить новое
    await prisma.smsIncomingHistory.create({
      data: {
        modemDeviceId: device.id,
        simCardId: simId,
        sender,
        receivedAt: dateTimeSent,
        text: message,
      },
    });
  }

  async _deleteMessages(modem) {
    try {
      await new Promise((resolve, reject) => {
        modem.deleteAllSimMessages((data) =>
          data ? resolve(data) : console.log("Ошибка удаления"),
        );
        logger.info("Сообщения успешно удалены");
      });
    } catch (e) {
      logger.warn({ port, error: e }, "Ошибка при удалении сообщений");
    }
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
      modem.setModemMode((data) => {
        logger.info({ port }, "Включение PDU режима");
        console.log("PDU MODE: ", data);
      }, "PDU");

      // --- если это первый open, сбрасываем retryCount и reconnectDelay ---
      if (!entry.initialized) {
        entry.initialized = true;
        entry.retryCount = 0;
        entry.reconnectDelay = DEFAULT_RECONNECT_DELAY;
        logger.info({ port }, "Modem впервые открыт, сбрасываем счётчики");
      } else {
        logger.info({ port }, "Modem успешно переподключился");
      }

      await this._deleteMessages(modem);

      // получаем IMEI
      try {
        entry.imei = await this._getModemSerial(modem);
        logger.info({ port, imei: entry.imei }, "Прочитан IMEI");
      } catch (e) {
        logger.error({ port, err: e }, "Не удалось получить IMEI");
        return modem.close();
      }

      if (!entry.imei) {
        logger.error("IMEI пустой, отмена upsert");
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

      console.log("LOG IMEI: ", entry.imei);
      console.log("LOG PORT: ", port);

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
          update: { status: "active", busy: false },
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

      this.getBalanceByPhone(entry.phone);

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

  async getCode(phone) {
    return getCode(
      phone,
      this.modems,
      this._saveIncoming,
      this._deleteMessages,
    );
  }

  async sendSMSByPhone(fromPhone, to, text) {
    return sendSMSByPhone(
      fromPhone,
      to,
      text,
      this.modems,
      this._deleteMessages,
    );
  }

  async getBalanceByPhone(phone) {
    return getBalanceByPhone(
      phone,
      this.modems,
      this._parseBalance,
      this._deleteMessages,
    );
  }

  async getConnectionHistoryByPhone(phone) {
    return getConnectionHistoryByPhone(phone);
  }
}

module.exports = ModemManager;
