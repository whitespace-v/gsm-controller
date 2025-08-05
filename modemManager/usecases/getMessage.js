const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

module.exports = async function getCode(
  entry,
  _saveIncoming,
  _deleteMessages,
) {
  let sim;       // Объект SIM-карты
  const phone = entry.phone
  const modem = entry.modem
  const port = entry.port
  const imei = entry.imei

  try {
    sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone, status: "active" },
    });

    if (!sim) {
      logger.error({ port, imei, phone }, `SIM ${phone} не зарегистрирована`);
      return;
    }

    if (sim.busy === true) {
      logger.warn({ port, imei, phone }, `SIM ${phone} в данный момент занята`);
      return;
    }

    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: true },
    });

    try {
      messageText = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          modem.removeListener("onNewMessage", handler);
          logger.error({ port, imei, phone }, `Timeout: SMS не пришло за 60 секунд`);
          reject();
        }, 60_000);

        const handler = async (messages) => {

          clearTimeout(timer);
          modem.removeListener("onNewMessage", handler);

          const msg = messages[0];
          const { sender, text, dateTimeSent } = msg;

          try {
            await _saveIncoming(entry, { sender, dateTimeSent, text });
          } catch (error) {
            logger.error({ port, imei, phone, error: {error}}, "Ошибка сохранения SMS из getCode");
          }

          resolve(msg);
        };

        modem.once("onNewMessage", handler);
      });
    } catch (error) {
      logger.warn({ port, imei, phone, error: {error}}, `Ошибка при ожидании сообщения от SIM ${phone}`);
    }
    // await _deleteMessages(modem, entry).catch((e) =>
    //   logger.warn({ port, imei, phone, error: e }, `Ошибка при удалении сообщений на SIM ${phone}`),
    // );

    return messageText;
  } catch (error) {
    logger.error({ port, imei, phone, error: {error} }, `Необработанная ошибка при получении сообщения`);
  } finally {
    await prisma.simCard
    .update({
      where: { id: sim.id },
      data: { busy: false },
    })
    .catch((error) =>
      logger.error({ port, imei, phone, error: {error} }, `Ошибка при снятии busy-флага для SIM ${phone}`),
    );
  }
};
