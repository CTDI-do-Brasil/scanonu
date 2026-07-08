const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

const target = `      } catch (err) {
        console.error(err);
        alert('Erro ao se conectar com o servidor para impressão.');
      }`;

const replacement = `      } catch (err: any) {
        console.error(err);
        alert(err.message || 'Erro ao se conectar com o servidor para impressão.');
      }`;

const normAppCode = appCode.replace(/\r?\n/g, '\n');
const cleanTarget = target.replace(/\r?\n/g, '\n');
const cleanReplacement = replacement.replace(/\r?\n/g, '\n');

if (normAppCode.includes(cleanTarget)) {
  const updatedAppCode = normAppCode.replace(cleanTarget, cleanReplacement);
  fs.writeFileSync(appPath, updatedAppCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target print catch block not found in App.tsx');
}
