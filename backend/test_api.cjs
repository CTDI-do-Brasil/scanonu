const http = require('http');

const data = JSON.stringify({
  modelo: "F@ST 5670",
  fabricante: "SagemCOM",
  wifi_ssid: "TIM_ULTRAFIBRA_F7C0",
  wifi_key: "cadd67af66",
  usuario: "admin",
  web_key: "**7mT7Ea"
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/save-label',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    // simulate authentication by just hitting it, wait authenticateSession requires a token or cookie?
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => console.log('Response:', body));
});

req.on('error', (e) => console.error('Error:', e));
req.write(data);
req.end();
