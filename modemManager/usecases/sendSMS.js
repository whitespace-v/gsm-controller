const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

module.exports = async function sendSMS(
  to,
  text,
  modems,
  _deleteMessages,
) {
  try {
    const operation = "sms send"
    let phone
    let modem
    let port
    let imei
    let sim

    sim = await prisma.simCard.findFirst({
        where: { status: "active", busy: false, lastUsedAt: null },
    });

    if (!sim) {
      sim = await prisma.simCard.findFirst({
        where: { status: "active", busy: false },
          orderBy: { lastUsedAt: "asc" },
      });
    }

    if (!sim) {
      logger.warn({operation}, "Нет свободных SIM-карт для отправки");
      return;
    }

    console.log("PHONE NUMBER SEND: ", sim.phoneNumber);


    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });

    if (!device) {
      logger.warn({operation}, `SIM ${phone} не привязана ни к одному модему`);
      return;
    }

    entry = modems.get(device.serialNumber);
    if (!entry) {
      logger.warn({operation}, `Модем на порту ${device.serialNumber} не запущен`);
      return;
    }

    console.log("NEW ENTRY: ", entry)


    port = entry.port
    phone = entry.phone
    imei = entry.imei
    modem = entry.modem

    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: true },
    });

    try {
      const result = await new Promise((resolve, reject) => {
        modem.sendSMS(to, text, false, (data) => {
          if (data.error) reject(new Error(data.error));
          else resolve(data);
        });
      });

      await prisma.simCard.update({
        where: { id: sim.id },
        data: { lastUsedAt: new Date() },
      });

      // ✅ Запись в таблицу SmsOutgoingHistory
      await prisma.smsOutgoingHistory.create({
        data: {
          simCardId: sim.id,
          modemDeviceId: device.id,
          recipient: to,
          text,
          status: "sent",
        },
      });

      return result;
    } catch (e) {
      console.log(e)
      // logger.error({ port, imei, phone, operation, error: {e} }, `Ошибка при отправке SMS через SIM ${phone}`,);

      // ❗ Запись ошибки в историю
      await prisma.smsOutgoingHistory.create({
        data: {
          simCardId: sim.id,
          modemDeviceId: device.id,
          recipient: to,
          text,
          status: "error",
        },
      });
    } finally {
      await _deleteMessages(entry);

      await prisma.simCard
        .update({
          where: { id: sim.id },
          data: { busy: false },
        })
        .catch((e) =>
          logger.warn(`Ошибка при снятии busy-флага для SIM ${phone}`),
        );
    }
  } catch (e) {
    logger.error("sendSMS: необработанная ошибка");
  }
};
