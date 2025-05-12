// modemManager.js
const prisma = require("./db");

const serialportgsm = require("serialport-gsm");
const { Modem } = serialportgsm;
let ussd = require("./node_modules/serialport-gsm/lib/functions/ussd.js");

const logger = require("./logger");

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

  async _deleteMessages(modem) {
    await new Promise((resolve, reject) => {
      modem.deleteAllSimMessages((data) =>
        data
          ? resolve(data)
          : reject(new Error("Не удалось удалить сообщения")),
      );
      logger.info("Сообщения успешно удалены");
    });
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
        await this._deleteMessages(modem);
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

  /**
   * Ожидает прихода SMS на данном SIM в течение 20 секунд,
   * сохраняет сообщение в базу и возвращает его текст.
   */
  async getCode(phone) {
    // 1) Ищем SimCard и связанный ModemDevice
    const sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone, status: "active" },
    });
    if (!sim) throw new Error(`SIM ${phone} не зарегистрирована`);
    else if (sim.busy == true)
      throw new Error(`SIM ${phone} в данный момент занята`);

    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });
    if (!device) throw new Error(`SIM ${phone} не привязана к модему`);

    // 2) Достаём entry с самим modem-объектом
    const entry = this.modems.get(device.serialNumber);
    if (!entry) throw new Error("Modem не запущен");

    const modem = entry.modem;

    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: true },
    });

    // 3) Возвращаем promise, который ждёт onNewMessage
    const codeText = await new Promise((resolve, reject) => {
      // таймаут на 20 секунд
      const timer = setTimeout(() => {
        modem.removeListener("onNewMessage", handler);
        reject(new Error("Timeout: SMS не пришло за 60 секунд"));
      }, 60_000);

      // одноразовый обработчик
      const handler = async (messages) => {
        clearTimeout(timer);
        modem.removeListener("onNewMessage", handler);

        const msg = messages[0];
        const { sender, message, dateTimeSent } = msg;

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

    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: false },
    });

    await this._deleteMessages(modem);

    return codeText;
  }

  async sendSMSByPhone(fromPhone, to, text) {
    // 1) Выбрать SIM
    let sim;
    if (fromPhone) {
      sim = await prisma.simCard.findUnique({
        where: { phoneNumber: fromPhone, status: "active" }, // TODO: добавить фильтр по роли симкарты
      });
      if (!sim) throw new Error(`SIM ${fromPhone} не зарегистрирована`);
      else if (sim.busy == true)
        throw new Error(`SIM ${fromPhone} в данный момент используется`);
    } else {
      // сначала неприменённые
      sim = await prisma.simCard.findFirst({
        where: { status: "active", busy: false, lastUsedAt: null }, // TODO: добавить фильтр по роли симкарты
      });
      if (!sim) {
        // если все уже использованы — берём ту, что дольше всех простаивает
        sim = await prisma.simCard.findFirst({
          where: { status: "active", busy: false }, // TODO: добавить фильтр по роли симкарты
          orderBy: { lastUsedAt: "asc" },
        });
      }
      if (!sim) throw new Error("Нет свободных SIM-карт для отправки");
      fromPhone = sim.phoneNumber;
    }

    // 2) Найти привязанный модем
    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });
    if (!device)
      throw new Error(`SIM ${fromPhone} не привязана ни к одному модему`);

    const entry = this.modems.get(device.serialNumber);
    if (!entry)
      throw new Error(`Modem на порту ${device.serialNumber} не запущен`);

    // 3) Пометить SIM как занятую
    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: true },
    });

    try {
      // 4) Отправить SMS
      const result = await new Promise((res, rej) => {
        entry.modem.sendSMS(to, text, false, (data) => {
          if (data.error) rej(new Error(data.error));
          else res(data);
        });
      });

      // 5) Обновить время последнего использования
      await prisma.simCard.update({
        where: { id: sim.id },
        data: { lastUsedAt: new Date() },
      });

      return result;
    } finally {
      await this._deleteMessages(entry.modem);

      // 6) Снять busy-флаг в любом случае
      await prisma.simCard.update({
        where: { id: sim.id },
        data: { busy: false },
      });
    }
  }

  async getBalanceByPhone(phone) {
    const sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone, status: "active" },
    });
    if (!sim) throw new Error(`SIM ${phone} не зарегистрирована`);
    else if (sim.busy == true)
      throw new Error(`SIM ${phone} в данный момент используется`);

    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });
    if (!device) throw new Error(`SIM ${phone} не привязана`);

    const entry = this.modems.get(device.serialNumber);
    if (!entry) throw new Error("Modem не запущен");

    // Пометить SIM как занятую
    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: true },
    });

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

    await this._deleteMessages(modem);

    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: false },
    });

    return resp;
  }

  async getConnectionHistoryByPhone(phone) {
    const sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone },
    });
    if (!sim) throw new Error(`SIM ${phone} не зарегистрирована`);

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
