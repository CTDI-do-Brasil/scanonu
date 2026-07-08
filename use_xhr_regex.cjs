const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

const regex = /let\s+debugErrors:\s*string\[\]\s*=\s*\[\];[\s\S]*?throw\s+new\s+Error\('Não\s+foi\s+possível\s+se\s+conectar\s+ao\s+Zebra[^\)]+\);\s*\}/;

const replacement = `let debugErrors: string[] = [];
            
            // Usar XMLHttpRequest em vez de fetch para tentar contornar bloqueios PNA (Private Network Access) do Chrome
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
            }
            
            if (!localUrl) {
              throw new Error('Não foi possível se conectar ao Zebra.\\nDetalhes: ' + debugErrors.join(' | '));
            }`;

if (regex.test(appCode)) {
  const updatedAppCode = appCode.replace(regex, replacement);
  fs.writeFileSync(appPath, updatedAppCode, 'utf8');
  console.log('Update App.tsx to use XMLHttpRequest complete');
} else {
  console.log('Target fetch block regex not matched in App.tsx');
}
