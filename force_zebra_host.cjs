const fs = require('fs');
const path = require('path');
const os = require('os');

function findAndEditConfig() {
  const localAppData = process.env.LOCALAPPDATA;
  const zebraPath = path.join(localAppData, 'Zebra Technologies', 'Browser Print');
  const configPath = path.join(zebraPath, 'config.json');

  if (fs.existsSync(configPath)) {
    console.log('Found config at: ' + configPath);
    let configData = fs.readFileSync(configPath, 'utf8');
    let config = JSON.parse(configData);
    
    let modified = false;
    if (config.accepted && Array.isArray(config.accepted)) {
      if (!config.accepted.includes('scanonu.ctdibrasil.com.br')) {
        config.accepted.push('scanonu.ctdibrasil.com.br');
        modified = true;
      }
      if (!config.accepted.includes('https://scanonu.ctdibrasil.com.br')) {
        config.accepted.push('https://scanonu.ctdibrasil.com.br');
        modified = true;
      }
    } else {
      config.accepted = ['scanonu.ctdibrasil.com.br', 'https://scanonu.ctdibrasil.com.br'];
      modified = true;
    }
    
    if (modified) {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      console.log('SUCCESS: Added scanonu domains to Accepted Hosts in Zebra config!');
    } else {
      console.log('SUCCESS: Domains were already in the config.');
    }
  } else {
    console.log('Config file not found at ' + configPath);
  }
}

findAndEditConfig();
