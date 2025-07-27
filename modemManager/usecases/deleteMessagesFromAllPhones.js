// usecases/getBalanceByPhone.js
const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

module.exports = async function deleteMessagesFromAllPhones(_deleteMessages, _getEntry) {
  const operation = "Delete messages from all phones"; 
  
  let sims = await prisma.simCard.findMany({
    where: { status: "active" }
  });

  await Promise.all(sims.map(async sim => {
    let entry = await _getEntry(sim.phoneNumber);
    let { port, imei, phone } = entry;

    try {
     await _deleteMessages(entry)
    } catch (error) {
      logger.error({ port, imei, phone, operation, error }, `Неожиданная ошибка ${operation}`);
    }
  }));

  return "succesfully deleted"
};
