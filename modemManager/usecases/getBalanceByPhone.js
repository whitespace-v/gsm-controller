// usecases/getBalanceByPhone.js
const prisma = require("../../utils/db");
const logger = require("../../utils/logger");

module.exports = async function getBalanceByPhone(entry) {
  const { port, imei, phone, modem } = entry;             
  const operation = "getBalanceByPhone";                   
  let sim, resp;

  try {

    sim = await prisma.simCard.findUnique({
      where: { phoneNumber: phone, status: "active" }
    });
    if (!sim) {
      logger.warn({ port, imei, phone, operation }, `SIM ${phone} не найдена`);
      return;
    }

    if (sim.busy) {
      logger.warn({ port, imei, phone, operation }, `SIM ${phone} занята`);
      return "busy";
    }

    await prisma.simCard.update({
      where: { id: sim.id },
      data:  { busy: true }
    });

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
      logger.warn({ port, imei, phone, operation },
                  "USSD прерван сетью, повторный запрос");
      resp = await requestBalance();
    }

    const current_balance = resp.data.text.trim()
                    .replace("Минус:", "-")
                    .replace("Баланс:", "")
                    .replace("р", "")
                    .replace(/,/, ".");                          

    logger.info({ port, imei, phone, operation }, `Баланс SIM ${phone}: ${current_balance}`);

    await prisma.simCard.update({
      where: { id: sim.id },
      data:  { busy: false, current_balance }
    });

    return current_balance;                                
  } catch (error) {

    if (sim) {
      await prisma.simCard.update({ where: { id: sim.id }, data: { busy: false } });
    }


    if (resp?.data?.follow === "terminated by network") {
      logger.error({ port, imei, phone, operation },
                   "USSD прерывается сетью повторно");
    } else {
      logger.error({ port, imei, phone, operation, error },
                   "Неожиданная ошибка Get balance by phone");
    }
  }
};
