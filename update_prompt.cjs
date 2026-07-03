const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

const regexSsid = /6\. wifi_ssid: Nome da rede Wi-Fi de 2\.4GHz ou rede única\. Se não achar, 'N\/A'\./;
const replacementSsid = `6. wifi_ssid: Nome da rede Wi-Fi de 2.4GHz ou rede única. CUIDADO EXTREMO com caracteres visualmente semelhantes: diferencie claramente 'B' e '8', 'O' (letra) e '0' (zero), 'I' e '1', 'Z' e '2', 'S' e '5', 'G' e '6', 'D' e '0'. Um erro nesses caracteres fará o sistema falhar. Se não achar, 'N/A'.`;

const regexSsid5g = /7\. wifi_ssid_5g: Nome da rede Wi-Fi de 5GHz\. Se não achar, 'N\/A'\./;
const replacementSsid5g = `7. wifi_ssid_5g: Nome da rede Wi-Fi de 5GHz. Aplique a mesma regra estrita do wifi_ssid para diferenciação de letras e números parecidos. Se não achar, 'N/A'.`;

code = code.replace(regexSsid, replacementSsid);
code = code.replace(regexSsid5g, replacementSsid5g);

fs.writeFileSync(filePath, code, 'utf8');
console.log('Update prompt complete.');
