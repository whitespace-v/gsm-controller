// usecases/getBalanceByPhone.js
const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

module.exports = async function refreshModem(phones, _addModem, options, _getEntry) {
  const operation = "Refresh modems"; 

  await Promise.all(phones.map(async phone => {
    let entry = await _getEntry(phone);
    let { port, imei, modem } = entry;

    try {
      modem.close()
    } catch (error) {
      logger.warn({ port, imei, phone, operation, error: {error} }, `Неожиданная ошибка ${operation}`);
      return
    }

  }));

  return "Refresh in process"
};
