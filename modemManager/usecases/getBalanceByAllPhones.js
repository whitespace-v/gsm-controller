// usecases/getBalanceByPhone.js
const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

module.exports = async function getBalanceByPhone(_getEntry) {
  let balances = {}
  const operation = "Get balance of all sim numbers"; 
  
  let sims = await prisma.simCard.findMany({
    where: { status: "active", busy: false }
  });

  await prisma.simCard.updateMany({
    where: { busy: false },
    data:  { busy: true }
  });

  await Promise.all(sims.map(async sim => {
    let entry = await _getEntry(sim.phoneNumber);
    let { port, imei, phone, modem } = entry;
    let resp;

    try {
      async function requestBalance() {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            modem.removeAllListeners("onNewIncomingUSSD");       
            logger.error({ port, imei, phone, operation }, "USSD timeout");
            reject(new Error("USSD timeout"));
          }, 15_000);
  
          modem.once("onNewIncomingUSSD", data => {
            clearTimeout(timer);
            resolve(data);
          });
  
          modem.sendUSSD("*100#", () => {});
        });
      }
  
      resp = await requestBalance();
  
      if (resp?.data?.follow === "terminated by network") {
        logger.warn({ port, imei, phone, operation }, "USSD прерван сетью, повторный запрос");
        resp = await requestBalance();
      }
  
      let current_balance = resp.data.text.trim()
                          .replace("Минус:", "-")
                          .replace("Баланс:", "")
                          .replace("р", "")
                          .replace(/,/, ".");
  
      logger.info({ port, imei, phone, operation }, `Баланс SIM ${phone}: ${current_balance}`);
  
      await prisma.simCard.update({
        where: { id: sim.id },
        data: { busy: false, current_balance }
      });
  
      balances[sim.phoneNumber] = current_balance;
  
    } catch (error) {
      await prisma.simCard.update({
        where: { id: sim.id },
        data: { busy: false }
      });
  
      balances[sim.phoneNumber] = error;
  
      if (resp?.data?.follow === "terminated by network") {
        logger.error({ port, imei, phone, operation }, "USSD прерывается сетью повторно");
      } else {
        logger.error({ port, imei, phone, operation, error: {error} }, "Неожиданная ошибка Get balance by all phones");
      }
    }
  }));

  return balances
};
