const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

module.exports = async function getCode(
  phone,
  modems,
  _saveIncoming,
  _deleteMessages,
) {
  try {
    const sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone, status: "active" },
    });

    if (!sim) {
      logger.warn(`SIM ${phone} не зарегистрирована`);
      return;
    }

    if (sim.busy === true) {
      logger.warn(`SIM ${phone} в данный момент занята`);
      return;
    }

    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });

    if (!device) {
      logger.warn(`SIM ${phone} не привязана к модему`);
      return;
    }

    const entry = modems.get(device.serialNumber);
    if (!entry) {
      logger.warn(`Modem ${device.serialNumber} не запущен`);
      return;
    }

    const modem = entry.modem;

    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: true },
    });

    let codeText;

    try {
      codeText = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          modem.removeListener("onNewMessage", handler);
          reject(new Error("Timeout: SMS не пришло за 60 секунд"));
        }, 60_000);

        const handler = async (messages) => {
          clearTimeout(timer);
          modem.removeListener("onNewMessage", handler);

          const msg = messages[0];
          const { sender, message, dateTimeSent } = msg;

          try {
            await _saveIncoming(entry, { sender, dateTimeSent, message });
          } catch (e) {
            logger.error({ err: e }, "Ошибка сохранения SMS из getCode");
          }

          resolve(message);
        };

        modem.once("onNewMessage", handler);
      });
    } catch (e) {
      logger.warn({ err: e }, `Ошибка при ожидании кода от SIM ${phone}`);
    }

    await prisma.simCard
      .update({
        where: { id: sim.id },
        data: { busy: false },
      })
      .catch((err) =>
        logger.warn({ err }, `Ошибка при снятии busy-флага для SIM ${phone}`),
      );

    await _deleteMessages(modem).catch((err) =>
      logger.warn({ err }, `Ошибка при удалении сообщений на SIM ${phone}`),
    );

    return codeText;
  } catch (err) {
    logger.error({ err }, `getCode(${phone}): необработанная ошибка`);
  }
};
