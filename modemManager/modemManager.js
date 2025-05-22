// modemManager.js
const getConnectionHistoryByPhone = require("./usecases/getConnectionHistoryByPhone.js");
const getBalanceByPhone = require("./usecases/getBalanceByPhone.js");
const sendSMSByPhone = require("./usecases/sendSMSByPhone.js");
const sendSMS = require("./usecases/sendSMS.js");
const getCode = require("./usecases/getCode.js");
const ussd = require("../node_modules/serialport-gsm/lib/functions/ussd.js");
const prisma = require("../utils/db");
const logger = require("../utils/logger");

const serialportgsm = require("serialport-gsm");
const { exec } = require("child_process");
const { Modem } = serialportgsm;

const DEFAULT_RECONNECT_DELAY = 2500; // начальная задержка переподключения
const MAX_RECONNECT_DELAY = 40 * 1000; // максимальная задержка переподключения (40 секунд)
const MAX_RETRIES = 3; // максимум попыток переподключения

class ModemManager {
  constructor() {
    this.modems = new Map(); // карта портов и их модемов
  }

  loggerFields(entry, error=null) {
    console.log("LOGGER PORT: ", entry?.port)
    return error ?  { port: entry.port, imei: entry.imei, phone: entry.phone, error} :  { port: entry.port, imei: entry.imei, phone: entry.phone };
  }

  _getModemSerial(entry, timeout = 1000) {
    return new Promise((resolve, reject) => {
      entry.modem.getModemSerial((data) => {
        if (data?.data?.modemSerial) resolve(data.data.modemSerial);
        else {
          logger.error(this.loggerFields(entry), "Нет IMEI в ответе");
          reject();
        }
      }, timeout);
    });
  }

  _getSubscriberNumber(entry, timeout = 20000, retry = 1) {
    let modem = entry.modem
    return new Promise((resolve, reject) => {
      const onNewMessage = (messages) => {
        clearTimeout(timer);
        modem.removeListener("onNewMessage", onNewMessage);
        const text = messages[0]?.message || "";
        const m = text.match(/\+?\d{7,15}/);
        if (m) return resolve(m[0]);
        if (retry === 2) modem.close();
        logger.error(this.loggerFields(entry), "Не нашли номер в тексте USSD-ответа");
        reject();
      };

      const onTimeout = () => {
        modem.removeListener("onNewMessage", onNewMessage);
        if (retry === 2) modem.close();
        logger.warn(this.loggerFields(entry), "Timeout при получении номера SIM");
        reject();
      };

      const timer = setTimeout(onTimeout, timeout);
      modem.once("onNewMessage", onNewMessage);

      modem.sendUSSD("*111*0887#", (data) => {
        if (data?.status === "fail") {
          clearTimeout(timer);
          modem.removeListener("onNewMessage", onNewMessage);
          if (retry = 2) modem.close();
          logger.error(this.loggerFields(entry), "USSD-запрос не прошёл: fail");
          reject();
        }
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

  async _saveIncoming(entry, { sender, dateTimeSent, message }) {
    const device = await prisma.modemDevice.findUnique({ where: { imei: entry.imei } });
    const simId = device.currentSimId;
    await prisma.smsIncomingHistory.create({
      data: { modemDeviceId: device.id, simCardId: simId, sender, receivedAt: dateTimeSent, text: message },
    });
    logger.info(this.loggerFields(entry), "Сообщение сохранено")
  }

  async _deleteMessages(entry) {
    console.log("DELETE: ", entry)
    try {
      await new Promise((resolve, reject) => {
        entry.modem.deleteAllSimMessages((data) => (data ? resolve(data) : reject()));
        logger.info({ port: entry.port, imei: entry.imei, phone: entry.phone }, "Сообщения успешно удалены");
      });
    } catch (e) {
      logger.warn({ port: entry.port, imei: entry.imei, phone: entry.phone, error: e}, "Ошибка при удалении сообщений");
    }
  }

  async _getEntry(phone) {
    let entry

    try {
      const sim = await prisma.simCard.findUnique({
        where: { phoneNumber: phone },
      });
      
      if (!sim) {
        logger.error(this.loggerFields(entry), `SIM ${phone} не найдена`);
        return
      }
      
      const device = await prisma.modemDevice.findFirst({
        where: { currentSimId: sim.id },
      });
      
      if (!device) {
        logger.error(this.loggerFields(entry), `SIM ${phone} не привязана ни к одному модему`);
        return
      }
      
      entry = this.modems.get(device.serialNumber);
      
      if (!entry) {
        logger.error(this.loggerFields(entry), `Modem не запущен`);
        return
      }

    } catch (e) {
      logger.error(this.loggerFields(entry, e), `Необработанная ошибка при получении баланса с SIM ${phone}`)
    }

    return entry
  }
  

  async _replugUSB(port, entry) {
    port = port.replace("/dev/", ""); // удаляем префикс пути
    try {
      await new Promise((resolve, reject) => {
        exec(`sudo /home/arch/Documents/Projects/gms-controller/bash_scripts/replug.sh ${port}`, (error, stdout, stderr) => {
          if (error) {
            logger.error(this.loggerFields(entry, error), "Ошибка программного переподключения порта");
            return reject();
          }
          if (stderr) {
            logger.warn(this.loggerFields(entry, error), "Предупреждение при переподключении");
          }
          logger.info(this.loggerFields(entry), "Порт успешно перезагружен");
          resolve();
        });
      });
    } catch (e) {
      logger.error(this.loggerFields(entry, e), "Ошибка при попытке переподключения USB");
    }
  }

  async _createAndOpen(entry) {
    const { port, options } = entry;
    const modem = Modem();
    modem.removeAllListeners(); // очистка всех старых слушателей
    ussd(modem);
    entry.modem = modem;
    entry.initialized ??= false;

    const tryOpen = async () => {
      try {
        await new Promise((res, rej) => modem.open(port, options, (err) => (err ? rej(err) : res())));
      } catch (e) {
        logger.warn(this.loggerFields(entry, e), "Ошибка открытия, пробуем снова");
        entry.reconnectDelay = Math.min(entry.reconnectDelay * 2, MAX_RECONNECT_DELAY);
        return setTimeout(tryOpen, entry.reconnectDelay);
      }
    };
    tryOpen();

    modem.on("open", async () => {
      await new Promise((resolve, reject) => {
        modem.initializeModem((data) => {
          console.log("MODEM INIT: ", data)
          logger.info(this.loggerFields(entry), "Модем инициализирован");
          resolve()
        });
      })

      modem.setModemMode(() => logger.info(this.loggerFields(entry), "Включен PDU режим"), "PDU");
      
      modem.getSimInbox(async (data) => {
        if (Array.isArray(data) && data.length > 0) {
          await this._deleteMessages(entry);
        }
      });

      if (!entry.initialized) {
        entry.initialized = true;
        entry.retryCount = 0;
        entry.reconnectDelay = DEFAULT_RECONNECT_DELAY;
        logger.info(this.loggerFields(entry), "Модем открыт впервые, сброшены счётчики");
      } else {
        logger.info(this.loggerFields(entry), "Модем переподключён");
      }

      try {
        entry.imei = await this._getModemSerial(entry);
        logger.info(this.loggerFields(entry), "Прочитан IMEI");
      } catch (e) {
        logger.error(this.loggerFields(entry, e), "Не удалось получить IMEI");
        return modem.close();
      }

      try {
        console.log("ENTRY: ", entry)
        entry.phone = await this._getSubscriberNumber(entry);
        entry.phone = "+" + entry.phone;
        logger.info(this.loggerFields(entry), "Прочитан номер SIM");
      } catch (e) {
        logger.error(this.loggerFields(entry, e), "Не удалось получить номер SIM");
        // return
      }

      if (!entry.phone) {
        console.log("ENTRY: ", entry)
        try {
          entry.phone = await this._getSubscriberNumber(entry, retry=2);
          entry.phone = "+" + entry.phone;
          logger.info(this.loggerFields(entry), "Прочитан номер SIM");
        } catch (e) {
          logger.error(this.loggerFields(entry, e), "Не удалось получить номер SIM во второй раз");
          return modem.close();
        }
      }

      const device = await prisma.modemDevice.upsert({
        where: { imei: entry.imei },
        update: { status: "connected", serialNumber: port },
        create: { imei: entry.imei, serialNumber: port, status: "connected" },
      });

      let sim = null;
      if (entry.phone) {
        sim = await prisma.simCard.upsert({
          where: { phoneNumber: entry.phone },
          update: { status: "active", busy: false },
          create: { phoneNumber: entry.phone, provider: "unknown", status: "active" },
        });
        await prisma.modemDevice.update({
          where: { id: device.id },
          data: { currentSimId: sim.id },
        });
      }

      if (sim) {
        await prisma.modemSimHistory.create({ data: { modemId: device.id, simId: sim.id } });
      }

      await this.getBalanceByPhone(entry.phone);
    });

    modem.on("close", async () => {
      if (++entry.retryCount > MAX_RETRIES) {
        logger.error(this.loggerFields(entry), `Достигнуто максимальное число попыток (${MAX_RETRIES}), прекращаем`);
        modem.removeAllListeners();
        return;
      }

      modem.removeAllListeners();
      if (entry.retryCount === 3) {
        logger.warn(this.loggerFields(entry), "Попытка программного переподключения USB");
        await this._replugUSB(port);
      } else {
        logger.warn(this.loggerFields(entry), "Попытка переподключения модема");
      }

      if (entry.imei) {
        try {
          const device = await prisma.modemDevice.findUnique({ where: { imei: entry.imei } });
          await prisma.modemSimHistory.updateMany({
            where: { modemId: device.id, disconnectedAt: null },
            data: { disconnectedAt: new Date() },
          });
          await prisma.modemDevice.update({
            where: { id: device.id },
            data: { status: "disconnected" },
          });
        } catch (e) {
          logger.error(this.loggerFields(entry, e), "Ошибка при маркировке отключения");
        }
      }

      entry.reconnectDelay = Math.min(entry.reconnectDelay * 2, MAX_RECONNECT_DELAY);
      logger.info({ port, retry: entry.retryCount, delay: entry.reconnectDelay }, "Переподключение");
      setTimeout(() => this._createAndOpen(entry), entry.reconnectDelay);
    });

    modem.on("error", (e) => {
      modem.close();
      logger.error(this.loggerFields(entry, e), "Ошибка модема");
    });
  }

  async getCode(phone) {
    let current_entry = await this._getEntry(phone)
    return getCode(current_entry, this._saveIncoming, this._deleteMessages);
  }

  async sendSMSByPhone(fromPhone, to, text) {
    let current_entry = await this._getEntry(fromPhone)
    console.log("CURRENT ENTRY: ", current_entry)
    return sendSMSByPhone(current_entry, to, text, this._deleteMessages);
  }

  async sendSMS(to, text) {
    return sendSMS(to, text, this.modems, this._deleteMessages);
  }

  async getBalanceByPhone(fromPhone) {
    let current_entry = await this._getEntry(fromPhone)
    console.log("CURRENT ENTRY: ", current_entry)
    return getBalanceByPhone(current_entry, this._deleteMessages);
  }

  async getConnectionHistoryByPhone(phone) {
    return getConnectionHistoryByPhone(phone);
  }
  
}

module.exports = ModemManager;
