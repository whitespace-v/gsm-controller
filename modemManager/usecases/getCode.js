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
  const operation = "Get authentification code"

  try {
    sim = await prisma.simCard.findFirst({
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

    let codeText;

    try {
      codeText = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          modem.removeListener("onNewMessage", handler);
          logger.error({ port, imei, phone }, `Timeout: SMS не пришло за 60 секунд`);
          reject();
        }, 60_000);

        const handler = async (messages) => {
          clearTimeout(timer);
          modem.removeListener("onNewMessage", handler);

          const msg = messages[0];
          const { sender, message, dateTimeSent } = msg;

          if (sender) {

            let code;

            if (sender == "T-Bank" || sender == "Alfa-Bank") {
              const regex = /\b\d{4}\b/;
              const codeMatch = message.match(regex);
              code = codeMatch[0];

              logger.info({ port, imei, phone, operation }, `Код для входа в ЛК ${sender}: ${code}`);
            } else {
              logger.error({ port, imei, phone }, `Сообщение не от банка`);
              reject();
            }

            try {
              let text = `Код аутентификации: ${code}`
              await _saveIncoming(entry, { sender, dateTimeSent, text });
            } catch (e) {
              logger.error({ port, imei, phone, error: e}, "Ошибка сохранения SMS из getCode");
            }

            resolve(code);
          } else {
            modem.removeListener("onNewMessage", handler);
            logger.error({ port, imei, phone, error: e}, "Нет отправителя");
            reject();
          }
        };

        modem.once("onNewMessage", handler);
      });
    } catch (e) {
      logger.warn({ port, imei, phone, error: e}, `Ошибка при ожидании кода от SIM ${phone}`);
    }

    return codeText;
  } catch (e) {
    logger.error({ port, imei, phone, error: e }, `Необработанная ошибка при получении кода`);
  } finally {
    await prisma.simCard
    .update({
      where: { id: sim.id },
      data: { busy: false },
    })
    .catch((e) =>
      logger.error({ port, imei, phone, error: e }, `Ошибка при снятии busy-флага для SIM ${phone}`),
    );
  }
};
