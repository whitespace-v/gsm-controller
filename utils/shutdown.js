// shutdown.js
const prisma = require("./db"); // ваш prisma-клиент
const logger = require("./logger");

async function gracefulShutdown(signal) {
  try {
    console.log(`Получен сигнал ${signal}, ставим все SIM-карты неактивными…`);
    await prisma.simCard.updateMany({
      data: { status: "inactive" },
    });
    console.log("Все SIM-карты помечены как inactive.");
  } catch (err) {
    console.error("Ошибка при выключении:", err);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

// Подписываемся на сигналы
process.once("SIGINT", () => gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("uncaughtException", (err) => {
  console.error("Необработанное исключение:", err);
  gracefulShutdown("uncaughtException");
});

module.exports = gracefulShutdown;
