const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

const target = `            for (const url of endpoints) {
              try {
                const res = await fetch(\`\${url}/default\`, { method: 'GET' });
                if (res.ok) {
                  localUrl = url;
                  break;
                }
              } catch (e) {}
            }
            
            if (!localUrl) {
              throw new Error('Não foi possível se conectar ao aplicativo Zebra Browser Print. Certifique-se de que ele está instalado, aberto e rodando em sua máquina local.');
            }`;

const replacement = `            let debugErrors = [];
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
              throw new Error('Não foi possível se conectar ao Zebra Browser Print.\\n\\nDetalhes:\\n' + debugErrors.join('\\n'));
            }`;

const normAppCode = appCode.replace(/\r?\n/g, '\n');
const cleanTarget = target.replace(/\r?\n/g, '\n');
const cleanReplacement = replacement.replace(/\r?\n/g, '\n');

if (normAppCode.includes(cleanTarget)) {
  const updatedAppCode = normAppCode.replace(cleanTarget, cleanReplacement);
  fs.writeFileSync(appPath, updatedAppCode, 'utf8');
  console.log('Update App.tsx debug errors complete');
} else {
  console.log('Target debug block not found in App.tsx');
}
