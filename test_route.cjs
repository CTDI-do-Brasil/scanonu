const fs = require('fs');

const mockReq = {
  body: {
    "fabricante": "",
    "modelo": "",
    "cpe_sn": "",
    "gpon_sn": "",
    "mac": "",
    "wifi_ssid": "LIVE TIM_69C0_2G",
    "wifi_ssid_5g": "LIVE TIM_69C0_5G",
    "wifi_key": "Sumaxc74bf",
    "usuario": "admin",
    "senha": "UH6XR@ea",
    "reimpressa": false
  }
};

let { fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, senha, web_key, operador, overwrite, targetDb, imagem_url } = mockReq.body;

function normalizeModel(modelo, fabricante) {
  return "MOCK";
}

const normalizedModelo = normalizeModel(modelo, fabricante);
const isFast5670 = false;

if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {
  const suffix = (mac && mac.toUpperCase() !== 'N/A') ? mac : Math.random().toString(36).substring(2, 10).toUpperCase();
  gpon_sn = 'N/A_' + suffix;
}

console.log("GPON_SN APOS IF:", gpon_sn);
