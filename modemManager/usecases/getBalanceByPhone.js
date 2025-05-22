const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

// Преобразование текста баланса в число
function _parseBalance(input) {
  input = input.trim();                                // Удаление пробелов
  let isNegative = input.includes("Минус:");           // Проверка на отрицательное значение
  let cleaned = input
    .replace("Минус:", "")                             // Удаление префикса
    .replace("Баланс:", "")
    .replace("р", "")
    .replace(",", ".")                                 // Замена запятой на точку
    .trim();

  return isNegative ? `-${cleaned}` : cleaned;         // Добавление знака, если нужно
}

module.exports = async function getBalanceByPhone(
  entry,
  _deleteMessages,
) {

  let sim;       // Объект SIM-карты
  let resp;      // Ответ от модема
  const phone = entry.phone
  const modem = entry.modem
  const port = entry.port
  const imei = entry.imei
  const operation = "get balance"

  try {
    // Получение SIM по номеру
    sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone, status: "active" },
    });

    if (!sim) {
      logger.warn({ port, imei, phone, operation }, `SIM ${phone} не зарегистрирована`);
      return;
    }

    if (sim.busy) {
      logger.warn({ port, imei, phone, operation }, `SIM ${phone} занята`);
      return "busy";
    }

    // Помечаем SIM как занятую
    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: true },
    });

    // Вложенная функция запроса баланса
    async function requestBalance() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          modem.removeAllListeners("onNewIncomingUSSD");       // Удаляем слушатель при таймауте
          logger.error({ port, imei, phone, operation }, "USSD timeout")
          reject();                   // Отказ по таймауту
        }, 15000); // 15 секунд

        modem.once("onNewIncomingUSSD", (data) => {            // Однократный обработчик события
          clearTimeout(timer);                                 // Очищаем таймер
          resolve(data);                                       // Возвращаем данные
        });

        modem.sendUSSD("*100#", () => {});                     // Отправляем USSD-запрос
      });
    }

    resp = await requestBalance();                             // Первая попытка запроса

    // Если запрос был прерван сетью — повторяем
    if (resp?.data?.follow === "terminated by network") {
      logger.warn({ port, imei, phone, operation }, "Первый запрос USSD завершён сетью, повторяем попытку");
      resp = await requestBalance();                           // Вторая попытка
    }

    console.log("RESPONSE BALANCE: ", resp);

    const current_balance = _parseBalance(resp.data.text);     // Парсим текст баланса

    logger.info({ port, imei, phone, operation }, `Баланс для SIM ${entry.phone}: ${current_balance}`);

    // Обновляем SIM-карту: снимаем busy и сохраняем баланс
    await prisma.simCard.update({
      where: { id: sim.id },
      data: { busy: false, current_balance },
    });

    await _deleteMessages(entry);                              // Удаляем сообщения с SIM

    return current_balance;                                    // Возвращаем результат
  } catch (e) {
    console.log("ОШИБКА БАЛАНСА", e)

    // Если SIM была найдена — сбрасываем флаг busy
    if (sim) {
      await prisma.simCard.update({
        where: { id: sim.id },
        data: { busy: false },
      });
    }

    // Отдельная обработка для случая прерывания сетью
    if (resp?.data?.follow === "terminated by network") {
      logger.error({ port, imei, phone, operation }, "Все запросы USSD завершены сетью");
    } else {
      logger.error({ port, imei, phone, operation, error: {e}}, `Необработанная ошибка при получении баланса с SIM ${phone}`);
    }
  }
};
