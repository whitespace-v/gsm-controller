const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

const MAX_RETRIES = 1;

function _parseBalance(input) {
  let current_rentry = 0;
  // Убираем все пробелы и лишние символы
  input = input.trim();
  // Определяем знак
  let isNegative = input.includes("Минус:");
  // Убираем префикс ("Минус:" или "Баланс:")
  let cleaned = input
    .replace("Минус:", "")
    .replace("Баланс:", "")
    .replace("р", "")
    .replace(",", ".")
    .trim();
  // Добавляем минус, если нужно
  let value = isNegative ? `-${cleaned}` : cleaned;

  return value;
}

module.exports = async function getBalanceByPhone(
  phone,
  modems,
  _deleteMessages,
) {
  console.log("PHONE NUMBER FROM GETBALANCE: ", phone);
  let sim;
  let resp;

  try {
    sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone, status: "active" },
    });

    if (!sim) {
      logger.warn(`SIM ${phone} не зарегистрирована`);
      return;
    }

    if (sim.busy) {
      logger.warn(`SIM ${phone} занята`);
      return "busy";
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

    // Вложенная функция для выполнения одного запроса
    async function requestBalance() {
      return new Promise((resolve, reject) => {
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
    }

    resp = await requestBalance();

    // Если сеть завершила запрос — пробуем ещё раз
    if (resp?.data?.follow === "terminated by network") {
      logger.warn(
        { phone },
        "Первый запрос USSD завершён сетью, повторяем попытку",
      );
      resp = await requestBalance();
    }

    console.log("RESPONSE BALANSE: ", resp);
    const current_balance = _parseBalance(resp.data.text);

    logger.info(`Баланс для SIM ${phone}: ${current_balance}`);

    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: false, current_balance },
    });

    await _deleteMessages(modem);

    return current_balance;
  } catch (err) {
    if (sim) {
      await prisma.simCard.update({
        where: { id: sim.id },
        data: { busy: false },
      });
    }

    if (resp?.data?.follow === "terminated by network") {
      logger.error({ phone }, "Все запросы USSD завершены сетью");
    } else {
      if (resp?.data?.follow === "terminated by network") {
        logger.warn(
          { phone },
          "Первый запрос USSD завершён сетью, повторяем попытку",
        );
        resp = await requestBalance();
      }
    }
  }
};
