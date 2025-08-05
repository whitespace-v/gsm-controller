const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

module.exports = async function getConnectionHistoryByPhone(phone) {
  try {
    const sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone },
    });

    if (!sim) {
      logger.warn(`SIM ${phone} не зарегистрирована`);
      return [];
    }

    const history = await prisma.modemSimHistory.findMany({
      where: { simId: sim.id },
      orderBy: { connectedAt: "desc" },
      include: {
        modemDevice: {
          select: {
            serialNumber: true,
            imei: true,
          },
        },
      },
    });

    return history.map((h) => ({
      modemSerial: h.modemDevice.serialNumber,
      modemImei: h.modemDevice.imei,
      connectedAt: h.connectedAt,
      disconnectedAt: h.disconnectedAt || null,
    }));
  } catch (error) {
    logger.error({ error: {error} }, `Ошибка при получении истории подключений`);
    return [];
  }
};
