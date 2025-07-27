// sendSMSByPhone use case
const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

/**
 * Отправка SMS через конкретный модемный entry
 * @param {{port:string,imei:string,phone:string,modem:object}} entry — данные модема
 * @param {string} to — номер получателя
 * @param {string} text — текст SMS
 * @param {Function} _deleteMessages — функция очистки входящих сообщений
 */
module.exports = async function sendSMSByPhone(
  entry,
  to,
  text,
  _deleteMessages,
) {
  const { port, imei, phone, modem } = entry;                             // параметры модема
  const operation = "Send 2FA code from a specific sim";                                   // метка операции

  let sim;
  try {
    // 1) Проверка наличия и активности SIM
    sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone, status: "active" },                     
    });
    if (!sim) {
      logger.error({ port, imei, phone, operation }, `SIM ${phone} не зарегистрирована`);
      return;
    }
    if (sim.busy) {
      logger.warn({ port, imei, phone, operation }, `SIM ${phone} занята`);
      return;
    }

    // 2) Помечаем SIM как занятую
    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: true },                                                 
    });

    try {
      // 3) Отправка SMS
      const result = await new Promise((resolve, reject) => {
        modem.sendSMS(to, text, false, (data) => {
          if (data.error) reject(new Error(data.error));
          else resolve(data);
        });
      });

      // 4) Обновление времени последнего использования
      await prisma.simCard.update({
        where: { id: sim.id },
        data: { lastUsedAt: new Date() },                                     
      });

      // 5) Запись успешной отправки в историю
      const device = await prisma.modemDevice.findFirst({
        where: { currentSimId: sim.id },
      });
      await prisma.smsOutgoingHistory.create({
        data: {
          simCardId:     sim.id,
          modemDeviceId: device.id,
          recipient:     to,
          text,
          status:        "sent",                                           
        },
      });

      logger.info({ port, imei, phone, operation }, `Отправлен 2FA код ${text}`);

      return result;                                                        
    } catch (sendError) {
      // 6) В случае ошибки — пишем в историю с статусом error
      const device = await prisma.modemDevice.findFirst({
        where: { currentSimId: sim.id },
      });
      await prisma.smsOutgoingHistory.create({
        data: {
          simCardId:     sim.id,
          modemDeviceId: device.id,
          recipient:     to,
          text,
          status:        "error",                                          
        },
      });
    } finally {
      // 7) Всегда очищаем входящие и снимаем busy-флаг
      await _deleteMessages(entry);                                        
      await prisma.simCard.update({
        where: { id: sim.id },
        data: { busy: false },                                              
      }).catch((err) =>
        logger.warn({ port, imei, phone, operation, error: err },
                    `Ошибка снятия busy для SIM ${phone}`)
      );
    }
  } catch (err) {
    // 8) Лог непредвиденных ошибок
    logger.error({ port, imei, phone, operation, error: err },
                 "sendSMSByPhone: необработанная ошибка");
  }
};
