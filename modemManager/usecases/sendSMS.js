// usecases/sendSMS.js
const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

/**
 * Отправляет SMS с использованием доступной SIM-карты.
 * @param {string} to - номер получателя
 * @param {string} text - текст сообщения
 * @param {Map<string, object>} modems - Map порт → entry модема
 * @param {Function} _deleteMessages - функция очистки входящих SMS на модеме
 */
module.exports = async function sendSMS(to, text, modems, _deleteMessages) {
  const operation = "Send 2FA code";                      // идентификатор операции
  let entry, sim, device;

  try {
    // 1) Выбор свободной сим-карты: сначала никогда не использованная, иначе по старейшему lastUsedAt
    sim = await prisma.simCard.findFirst({
      where: { status: "active", busy: false, lastUsedAt: null }
    });
    if (!sim) {
      sim = await prisma.simCard.findFirst({
        where: { status: "active", busy: false },
        orderBy: { lastUsedAt: "asc" }
      });
    }

    if (!sim) {
      logger.warn({ operation }, "Нет доступных SIM-карт");
      return;
    }
    logger.info({ operation, sim: sim.phoneNumber }, "Выбрана SIM-карта");

    // 2) Поиск привязанного модема
    device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id }
    });
    if (!device) {
      logger.warn({ operation, sim: sim.phoneNumber }, "SIM не привязана к модему");
      return;
    }

    // 3) Получаем entry модема по serialNumber
    entry = modems.get(device.serialNumber);
    if (!entry) {
      logger.warn({ operation, port: device.serialNumber }, "Модем не запущен");
      return;
    }

    const { port, imei, phone } = entry;
    // 4) Отметить SIM как занятую
    await prisma.simCard.update({ where: { id: sim.id }, data: { busy: true } });

    try {
      // 5) Выполнение отправки SMS
      const result = await new Promise((resolve, reject) => {
        entry.modem.sendSMS(to, text, false, (data) => {
          data.error ? reject(new Error(data.error)) : resolve(data);
        });
      });

      // 6) Обновить время последнего использования
      await prisma.simCard.update({ where: { id: sim.id }, data: { lastUsedAt: new Date() } });

      // 7) Логирование успешной отправки в историю
      await prisma.smsOutgoingHistory.create({
        data: {
          simCardId:     sim.id,
          modemDeviceId: device.id,
          recipient:     to,
          text,
          status:        "sent"
        }
      });

      logger.info({ port, imei, phone, operation }, `Отправлен 2FA код ${text}`);

      return result;
    } catch (error) {
      // 8) Логирование ошибки отправки и запись в историю
      logger.error({ port, imei, phone, operation, error: {error} }, "Ошибка отправки SMS");
      await prisma.smsOutgoingHistory.create({
        data: {
          simCardId:     sim.id,
          modemDeviceId: device.id,
          recipient:     to,
          text,
          status:        "error"
        }
      });
    } finally {
      // 9) Всегда: очистить входящие и снять флаг busy
      await _deleteMessages(entry).catch(error =>
        logger.warn({ port, imei, phone, error: {error}, operation }, "Ошибка очистки SMS")
      );
      await prisma.simCard.update({ where: { id: sim.id }, data: { busy: false } })
        .catch(err => logger.warn({ port, imei, phone, error: {error}, operation }, "Ошибка снятия busy"));
    }

  } catch (error) {
    // 10) Обработка непредвиденных ошибок
    logger.error({ operation, error: {error} }, "sendSMS: необработанная ошибка");
  }
};
