const fs = require('fs');

const configPath = 'C:\\\\Users\\\\apongeluppi\\\\AppData\\\\Local\\\\Zebra\\\\BrowserPrint\\\\settings.json';
let configData = fs.readFileSync(configPath, 'utf8');
let config = JSON.parse(configData);

let modified = false;
if (config.hosts && Array.isArray(config.hosts)) {
  if (!config.hosts.includes('scanonu.ctdibrasil.com.br')) {
    config.hosts.push('scanonu.ctdibrasil.com.br');
    modified = true;
  }
  if (!config.hosts.includes('https://scanonu.ctdibrasil.com.br')) {
    config.hosts.push('https://scanonu.ctdibrasil.com.br');
    modified = true;
  }
} else {
  config.hosts = ['localhost', 'scanonu.ctdibrasil.com.br', 'https://scanonu.ctdibrasil.com.br'];
  modified = true;
}

if (modified) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log('SUCCESS: Added scanonu domains to Accepted Hosts in Zebra settings.json');
} else {
  console.log('SUCCESS: Domains were already in the config.');
}
