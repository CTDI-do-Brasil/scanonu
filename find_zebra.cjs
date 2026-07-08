const fs = require('fs');
const path = require('path');

function findZebraDirs(baseDir) {
  let results = [];
  try {
    const list = fs.readdirSync(baseDir);
    for (const file of list) {
      const fullPath = path.join(baseDir, file);
      if (file.toLowerCase().includes('zebra') && fs.statSync(fullPath).isDirectory()) {
         results.push(fullPath);
         try {
           const subList = fs.readdirSync(fullPath);
           for (const sub of subList) {
             results.push(path.join(fullPath, sub));
           }
         } catch(e) {}
      }
    }
  } catch (e) {}
  return results;
}

const res1 = findZebraDirs(process.env.APPDATA);
const res2 = findZebraDirs(process.env.LOCALAPPDATA);
console.log('Zebra dirs in APPDATA:', res1);
console.log('Zebra dirs in LOCALAPPDATA:', res2);
