const prisma = require("../../db");
const logger = require("../../logger");

module.exports = async function getBalanceByPhone(
  phone,
  modems,
  _parseBalance,
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

    if (sim.busy) {
      logger.warn(`SIM ${phone} занята`);
      return;
    }

    const device = await prisma.modemDevice.findFirst({
      where: { currentSimId: sim.id },
    });

    if (!device) {
      logger.warn(`SIM ${phone} не привязана`);
      return;
    }

    const entry = modems.get(device.serialNumber);
    if (!entry) {
      logger.warn("Modem не запущен");
      return;
    }

    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: true },
    });

    const modem = entry.modem;

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

    await _deleteMessages(modem);

    const current_balance = _parseBalance(resp.data.text);

    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: false, current_balance },
    });

    return current_balance;
  } catch (err) {
    logger.error({ err }, "getBalanceByPhone: необработанная ошибка");
  }
};
