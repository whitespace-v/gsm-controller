const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

module.exports = async function sendSMSByPhone(
  fromPhone,
  to,
  text,
  modems,
  _deleteMessages,
) {
  try {
    let sim;

    if (fromPhone) {
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

      fromPhone = sim.phoneNumber;
    }

    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });

    if (!device) {
      logger.warn(`SIM ${fromPhone} не привязана ни к одному модему`);
      return;
    }

    const entry = modems.get(device.serialNumber);
    if (!entry) {
      logger.warn(`Modem на порту ${device.serialNumber} не запущен`);
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

      return result;
    } catch (error) {
      logger.error(
        { err: error },
        `Ошибка при отправке SMS через SIM ${fromPhone}`,
      );
    } finally {
      await _deleteMessages(entry.modem).catch((err) =>
        logger.warn({ err }, "Ошибка при очистке сообщений после отправки"),
      );

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
