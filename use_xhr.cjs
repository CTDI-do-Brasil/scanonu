const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

// Replace the fetch block with an XMLHttpRequest wrapped in a Promise
const target = `            let debugErrors = [];
            for (const url of endpoints) {
              try {
                const res = await fetch(\`\${url}/available\`, { method: 'GET' });
                if (res.ok) {
                  localUrl = url;
                  break;
                } else {
                  debugErrors.push(\`\${url} HTTP \${res.status}\`);
                }
              } catch (e) {
                debugErrors.push(\`\${url} ERRO: \${(e as Error).message}\`);
              }
            }`;

const replacement = `            let debugErrors: string[] = [];
            
            // Zebra BrowserPrint.js usa XMLHttpRequest. Vamos emular isso para evitar bloqueios do fetch (PNA/CORS).
            const checkEndpoint = (url: string): Promise<boolean> => {
              return new Promise((resolve) => {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', \`\${url}/available\`, true);
                xhr.onreadystatechange = function() {
                  if (xhr.readyState === 4) {
                    if (xhr.status >= 200 && xhr.status < 400) {
                      resolve(true);
                    } else {
                      debugErrors.push(\`\${url} HTTP \${xhr.status}\`);
                      resolve(false);
                    }
                  }
                };
                xhr.onerror = function() {
                  debugErrors.push(\`\${url} XHR Error\`);
                  resolve(false);
                };
                xhr.send();
              });
            };

            for (const url of endpoints) {
              const isOk = await checkEndpoint(url);
              if (isOk) {
                localUrl = url;
                break;
              }
            }`;

const normAppCode = appCode.replace(/\r?\n/g, '\n');
const cleanTarget = target.replace(/\r?\n/g, '\n');
const cleanReplacement = replacement.replace(/\r?\n/g, '\n');

if (normAppCode.includes(cleanTarget)) {
  const updatedAppCode = normAppCode.replace(cleanTarget, cleanReplacement);
  fs.writeFileSync(appPath, updatedAppCode, 'utf8');
  console.log('Update App.tsx to use XMLHttpRequest complete');
} else {
  console.log('Target fetch block not found in App.tsx');
}
