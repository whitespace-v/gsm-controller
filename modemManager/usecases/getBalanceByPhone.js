// usecases/getBalanceByPhone.js
const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

/**
 * Получение баланса по SIM и очистка сообщений после запроса
 * @param {{port:string,imei:string,phone:string,modem:object}} entry — данные модема
 * @param {Function} _deleteMessages — функция для удаления входящих SMS
 * @returns {string|undefined} баланс или 'busy' если SIM занята
 */
module.exports = async function getBalanceByPhone(entry, _deleteMessages) {
  const { port, imei, phone, modem } = entry;                  // данные модема
  const operation = "getBalanceByPhone";                      // метка операции
  let sim, resp;

  try {
    // 1) Найти активную SIM по номеру
    sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone, status: "active" }
    });
    if (!sim) {
      logger.warn({ port, imei, phone, operation }, `SIM ${phone} не найдена`);
      return;
    }
    // 2) Проверить, не занята ли SIM
    if (sim.busy) {
      logger.warn({ port, imei, phone, operation }, `SIM ${phone} занята`);
      return "busy";
    }

    // 3) Пометить SIM как занятую
    await prisma.simCard.update({
      where: { id: sim.id },
      data:  { busy: true }
    });

    // 4) Запрос баланса через USSD с таймаутом
    async function requestBalance() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          modem.removeAllListeners("onNewIncomingUSSD");         // снимаем слушатель
          logger.error({ port, imei, phone, operation }, "USSD timeout");
          reject(new Error("USSD timeout"));
        }, 15_000);

        modem.once("onNewIncomingUSSD", data => {                // одноразовый слушатель
          clearTimeout(timer);                                    // отменяем таймер
          resolve(data);
        });

        modem.sendUSSD("*100#", () => {});                      // отправляем USSD
      });
    }

    // Первая попытка
    resp = await requestBalance();

    // 5) Если сеть прервала запрос — повторяем
    if (resp?.data?.follow === "terminated by network") {
      logger.warn({ port, imei, phone, operation },
                  "USSD прерван сетью, повторный запрос");
      resp = await requestBalance();
    }

    // 6) Преобразование текста в число
    const raw = resp.data.text.trim()
                    .replace("Минус:", "-")
                    .replace("Баланс:", "")
                    .replace("р", "")
                    .replace(/,/, ".");
    const current_balance = raw;                                 // строка с балансом

    logger.info({ port, imei, phone, operation },
                `Баланс SIM ${phone}: ${current_balance}`);

    // 7) Сохранить баланс и снять флаг busy
    await prisma.simCard.update({
      where: { id: sim.id },
      data:  { busy: false, current_balance }
    });

    // // 8) Очистить входящие сообщения
    // await _deleteMessages(entry);

    return current_balance;                                      // вернуть баланс
  } catch (error) {
    // 9) В случае ошибки — сбросить флаг busy
    if (sim) {
      await prisma.simCard.update({ where: { id: sim.id }, data: { busy: false } });
    }

    // 10) Логирование разных причин ошибки
    if (resp?.data?.follow === "terminated by network") {
      logger.error({ port, imei, phone, operation },
                   "USSD прерывается сетью повторно");
    } else {
      logger.error({ port, imei, phone, operation, error },
                   "Неожиданная ошибка getBalanceByPhone");
    }
  }
};
