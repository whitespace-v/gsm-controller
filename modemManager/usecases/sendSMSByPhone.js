const prisma = require("../../utils/db");
const logger = require("../../utils/logger");
const getBalanceByPhone = require("./getBalanceByPhone");

module.exports = async function sendSMSByPhone(
  fromPhone,
  to,
  text,
  modems,
  _deleteMessages,
) {
  try {
    let entry;
    let sim;

    if (fromPhone) {
      let current_balance = await getBalanceByPhone(
        fromPhone,
        modems,
        _deleteMessages,
      );

      if (current_balance < 3) {
        return "minus balance";
      }

      sim = await prisma.simCard.findUnique({
        where: { phoneNumber: fromPhone, status: "active" },
      });

      if (!sim) {
        logger.error(`SIM ${fromPhone} не зарегистрирована`);
        return;
      }
      if (sim.busy) {
        logger.warn(`SIM ${fromPhone} в данный момент используется`);
        return;
      }
    } else {
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
        logger.warn("Нет свободных SIM-карт для отправки");
        return;
      }
    }

    console.log("PHONE NUMBER SEND: ", sim.phoneNumber);

    fromPhone = sim.phoneNumber;

    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });

    if (!device) {
      logger.warn(`SIM ${fromPhone} не привязана ни к одному модему`);
      return;
    }

    entry = modems.get(device.serialNumber);
    if (!entry) {
      logger.warn(`Модем на порту ${device.serialNumber} не запущен`);
      return;
    }

    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: true },
    });

    try {
      const result = await new Promise((resolve, reject) => {
        entry.modem.sendSMS(to, text, false, (data) => {
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
    } catch (error) {
      logger.error(
        { err: error },
        `Ошибка при отправке SMS через SIM ${fromPhone}`,
      );

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
      await _deleteMessages(entry.modem);

      await prisma.simCard
        .update({
          where: { id: sim.id },
          data: { busy: false },
        })
        .catch((err) =>
          logger.warn(
            { err },
            `Ошибка при снятии busy-флага для SIM ${fromPhone}`,
          ),
        );
    }
  } catch (err) {
    logger.error({ err }, "sendSMSByPhone: необработанная ошибка");
  }
};
