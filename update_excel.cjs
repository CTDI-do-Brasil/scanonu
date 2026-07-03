const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(filePath, 'utf8');

// The replacements we want to make (these arrays appear exactly twice in the file)
// 1. modelo
code = code.split("['Modelo', 'modelo', 'Model', 'model']").join("['Modelo', 'modelo', 'Model', 'model', 'HOST_PID']");

// 2. cpe_sn
code = code.split("['CPE Serial Number', 'CPE Serial', 'cpe_sn', 'Cpe Sn', 'CPE SN', 'CPE S/N', 'CPE']").join("['CPE Serial Number', 'CPE Serial', 'cpe_sn', 'Cpe Sn', 'CPE SN', 'CPE S/N', 'CPE', 'HOST_SERIAL_NO']");

// 3. mac
code = code.split("['Endereço MAC', 'MAC', 'mac', 'Mac', 'Endereço Mac', 'Endereco Mac', 'MAC Address', 'mac_address', 'mac_addr']").join("['Endereço MAC', 'MAC', 'mac', 'Mac', 'Endereço Mac', 'Endereco Mac', 'MAC Address', 'mac_address', 'mac_addr', 'MACADDR_ETHNET']");

// 4. wifi_ssid_5g
code = code.split("['SSID Wi-Fi 5G', 'SSID 5G', 'wifi_ssid_5g', 'SSID Wifi 5G', 'SSID 5']").join("['SSID Wi-Fi 5G', 'SSID 5G', 'wifi_ssid_5g', 'SSID Wifi 5G', 'SSID 5', 'SSID2']");

// 5. wifi_key
code = code.split("['Senha WIFI', 'Senha Wi-Fi', 'wifi_key', 'Senha Wifi', 'Wifi Key', 'WIFI Key', 'WlanKey', 'Wlan Key', 'Senha da rede', 'WPA', 'wpa_key']").join("['Senha WIFI', 'Senha Wi-Fi', 'wifi_key', 'Senha Wifi', 'Wifi Key', 'WIFI Key', 'WlanKey', 'Wlan Key', 'Senha da rede', 'WPA', 'wpa_key', 'WPA_PSK2']");

// 6. web_key
code = code.split("['Senha WEB', 'Senha', 'web_key', 'senha', 'Senha Web', 'Password', 'Pass', 'Web_Key', 'web_key', 'WebKey', 'Web Key', 'senha_web']").join("['Senha WEB', 'Senha', 'web_key', 'senha', 'Senha Web', 'Password', 'Pass', 'Web_Key', 'web_key', 'WebKey', 'Web Key', 'senha_web', 'ACCESS_KEY1', 'WPA_PSK2']");

// 7. gpon_sn
code = code.split("['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'Serial', 'S/N', 'serial']").join("['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'Serial', 'S/N', 'serial', 'CUSN']");

fs.writeFileSync(filePath, code, 'utf8');
console.log('Update Excel mapping complete.');
