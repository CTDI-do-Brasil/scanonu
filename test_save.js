const http = require('http'); 
const req = http.request({
  hostname: 'localhost', 
  port: 3001, 
  path: '/api/save-label', 
  method: 'POST', 
  headers: {'Content-Type': 'application/json'}
}, res => { 
  let data = ''; 
  res.on('data', chunk => data += chunk); 
  res.on('end', () => console.log(data)); 
}); 
req.write(JSON.stringify({
  gpon_sn: 'N/A', 
  mac: 'N/A', 
  wifi_ssid: 'LIVE_TEST_' + Math.random(), 
  wifi_ssid_5g: 'N/A', 
  fabricante: 'N/A', 
  modelo: 'N/A', 
  cpe_sn: 'N/A', 
  wifi_key: 'N/A', 
  usuario: 'N/A', 
  web_key: 'N/A', 
  operador: 'test'
})); 
req.end();
