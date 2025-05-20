const { exec } = require("child_process");

const port = "ttyUSB0";
const scriptPath =
  "/home/arch/Documents/Projects/gms-controller/bash_scripts/replug.sh";

exec(`sudo ${scriptPath} ${port}`, (error, stdout, stderr) => {
  if (error) {
    console.error(`Ошибка: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`stderr: ${stderr}`);
    return;
  }
  console.log(`stdout: ${stdout}`);
});
