const serialportgsm = require("serialport-gsm");

// serialportgsm.list((err, devices) => {
//   for (const device of devices) {
//     if (device.pnpId != undefined) {
//       console.log(device);
//     }
//   }
// });

let ussd = require("../node_modules/serialport-gsm/lib/functions/ussd.js");

let modem = serialportgsm.Modem();
ussd(modem);

let options = {
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  rtscts: false,
  xon: false,
  xoff: false,
  xany: false,
  autoDeleteOnReceive: true,
  enableConcatenation: true,
  incomingCallIndication: true,
  incomingSMSIndication: true,
  pin: "",
  customInitCommand: "",
  cnmiCommand: "AT+CNMI=2,1,0,2,1",
  logger: console,
};

modem.open("/dev/ttyUSB0", options, {});

async function sleep(ms = 4000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

modem.on("open", async(data) => {
  modem.executeCommand('AT+CFUN=1', (result, err) => {
    if (err) {
      console.log(`Error - ${err}`);
    } else {
      console.log(`Result ${JSON.stringify(result)}`);
    }
  });

  modem.executeCommand('AT+COPS?', (result, err) => {
    if (err) {
      console.log(`Error - ${err}`);
    } else {
      let resultStr = result.data.result;
      let match = resultStr.match(/"([^"]+)"/);
      let value = match ? match[1] : null;
      console.log("Вендор: ", value);
    }
  });

  modem.executeCommand('AT+CGREG?', (result, err) => {
    if (err) {
      console.log(`Error - ${err}`);
    } else {
      console.log(`Result ${JSON.stringify(result)}`);
    }
  });

  sleep()


  // modem.deleteAllSimMessages((data) => {
  //   console.log(data);
  // });
  // // initialize modem
  // await new Promise((resolve, reject) => {
  //   modem.initializeModem((data) => {
  //     console.log("MODEM INIT: ", data)
  //     resolve()
  //   });
  // })

  // modem.getNetworkSignal((callback) => {
  //   console.log("GET NETWORK SIGNAL: ", callback);
  // });

  // modem.getSimInbox((data) => {
  //   console.log(data);
  // });


  // modem.on("onNewIncomingUSSD", (data) => {
  //   console.log("New Incoming USSD: ", { data });
  // });

  // modem.on("onNewMessage", (data) => {
  //   const firstMsg = data[0].message;
  //   const phone = firstMsg.match(/\d+/)[0];
  //   console.log("New Message: ", data);
  //   console.log("New phone: ", phone);
  //   // modem.close();
  // });

  // sleep()

  // modem.sendUSSD("*111*0887#", (data) => {
  //   console.log("Send SMS Data: ", data.status);
  // });

  // modem.sendUSSD("*100#", (data) => {
  //   console.log("Send SMS Data: ", { data });
  // });

  // modem.getModemSerial((data) => {
  //   console.log(data.data.modemSerial);
  // }, 1000);

  // modem.getOwnNumber((data) => {
  //   console.log(data);
  // }, 1000);

  // modem.sendSMS("+79841894786", "Test 2", false, (data) => {
  //   console.log(data);
  // });
  //
  // modem.executeCommand(
  //   "AT+CIMI",
  //   (callback) => {
  //     console.log(callback);
  //   },
  //   false,
  //   20000,
  // );

  // modem.close();
});

modem.on("onSendingMessage", (result) => {
  console.log(result);
  // modem.close();
});
