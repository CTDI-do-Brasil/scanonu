const fs = require('fs');
const path = require('path');

function searchForZebraConfig(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          if (file === 'Zebra Technologies' || file === 'Zebra' || file === 'Browser Print' || fullPath.includes('Zebra')) {
            results = results.concat(searchForZebraConfig(fullPath));
          } else if (dir === process.env.APPDATA || dir === process.env.LOCALAPPDATA) {
             // Only go 1 level deep if not related to Zebra to avoid scanning whole disk
             if (file.toLowerCase().includes('zebra')) {
               results = results.concat(searchForZebraConfig(fullPath));
             }
          }
        } else {
          if (file === 'config.json' && fullPath.toLowerCase().includes('zebra')) {
            results.push(fullPath);
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
  return results;
}

const locs1 = searchForZebraConfig(process.env.APPDATA);
const locs2 = searchForZebraConfig(process.env.LOCALAPPDATA);
const all = [...locs1, ...locs2];

console.log('Found configs: ', all);

if (all.length > 0) {
  const configPath = all[0];
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
    console.log('SUCCESS: Added scanonu domains to Accepted Hosts in Zebra config at ' + configPath);
  } else {
    console.log('SUCCESS: Domains were already in the config.');
  }
} else {
  console.log('Config not found.');
}
