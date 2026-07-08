const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

const regex = /for\s*\(const\s+url\s+of\s+endpoints\)\s*\{\s*try\s*\{\s*const\s+res\s*=\s*await\s+fetch\(`\$\{url\}\/default`,\s*\{\s*method:\s*'GET'\s*\}\);\s*if\s*\(res\.ok\)\s*\{\s*localUrl\s*=\s*url;\s*break;\s*\}\s*\}\s*catch\s*\(e\)\s*\{\}\s*\}\s*if\s*\(!localUrl\)\s*\{\s*throw\s*new\s*Error\('Não foi possível se conectar ao aplicativo Zebra Browser Print\. Certifique-se de que ele está instalado, aberto e rodando em sua máquina local\.'\);\s*\}/;

const replacement = `let debugErrors = [];
            for (const url of endpoints) {
              try {
                const res = await fetch(\`\${url}/default\`, { method: 'GET' });
                if (res.ok) {
                  localUrl = url;
                  break;
                } else {
                  debugErrors.push(\`\${url} HTTP \${res.status}\`);
                }
              } catch (e) {
                debugErrors.push(\`\${url} ERRO: \${e.message}\`);
              }
            }
            
            if (!localUrl) {
              throw new Error('Não foi possível se conectar ao Zebra.\\nDetalhes: ' + debugErrors.join(' | '));
            }`;

if (regex.test(appCode)) {
  const updatedAppCode = appCode.replace(regex, replacement);
  fs.writeFileSync(appPath, updatedAppCode, 'utf8');
  console.log('Update App.tsx debug errors complete');
} else {
  console.log('Target debug block regex not matched in App.tsx');
}
