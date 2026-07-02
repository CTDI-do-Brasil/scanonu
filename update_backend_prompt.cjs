const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(file, 'utf8');

const newPrompt = `  const prompt = \`Analise a imagem da etiqueta do equipamento ONU/ONT e extraia os seguintes campos de forma estruturada. 
Siga atentamente as instruções abaixo para cada campo:
1. fabricante: Fabricante da ONU (ex: Huawei, ZTE, FiberHome, Intelbras, Nokia, Alcatel, SagemCOM).
2. modelo: Modelo exato da ONU (ex: F670L, HG8145V5, EG8145V5, F6600, F680, F673, XC-FIT-150, F@ST 5655V2, etc.).
3. cpe_sn: Serial CPE/Equipamento (geralmente começa com N7 ou similar). Se for igual ao GPON SN, deixe vazio ou extraia o correto se houver.
4. gpon_sn: Serial GPON (ex: SMBS12345678, ZTEG12345678, FHTT12345678, ALCL12345678, HWTC12345678). Certifique-se de que tenha 12 caracteres. Se começar com SMB8, corrija para SMBS.
5. mac: Endereço MAC físico de 12 caracteres hexadecimais (ex: 8020DAD1D2D3). Remova separadores como ':' ou '-'. Certifique-se de que o prefixo/OUI seja válido para o fabricante.
6. wifi_ssid: Nome da rede Wi-Fi de 2.4GHz ou rede única.
7. wifi_ssid_5g: Nome da rede Wi-Fi de 5GHz, se existir separadamente.
8. wifi_key: Senha padrão do Wi-Fi. ATENÇÃO MÁXIMA À EXATIDÃO: Diferencie claramente letras maiúsculas de minúsculas. CUIDADO REDOBRADO: O modelo de IA tem um vício crônico em ler '!' como a letra 'I' maiúscula. As senhas de Wi-Fi de roteadores (Claro, Vivo, TIM, etc) frequentemente contêm o símbolo de exclamação '!'. Sempre que vir um traço vertical, preste muita atenção se não há um ponto embaixo dele caracterizando um '!'. Se a senha parecer ter um 'I' jogado aleatoriamente (ex: adminI123, TIM_wifiI), o correto quase 100% das vezes é '!'. NUNCA converta '!' para 'I'.
9. usuario: Usuário padrão de acesso web (geralmente admin, user, etc.).
10. web_key: Senha de acesso web (Password/Senha). ATENÇÃO MÁXIMA À EXATIDÃO: Diferencie letras MAIÚSCULAS de minúsculas. EXTREMO CUIDADO COM O SÍMBOLO DE EXCLAMAÇÃO '!'. Você está lendo o símbolo '!' como a letra 'I' maiúscula incorretamente em suas últimas leituras. Reveja a imagem e garanta que está lendo '!' como exclamação. Muitas senhas web de fabricantes terminam com '!'. NÃO converta '!' para 'I'.
11. reimpressa: Identifique se a etiqueta é uma reimpressão (geralmente não original, impressa em papel adesivo comum) retornando 'sim' ou 'nao'.\`;`;

// Usamos uma regex flexível para substituir a definição do prompt inteira
code = code.replace(
  /const prompt = `Analise a imagem da etiqueta[\s\S]*?retornando 'sim' ou 'nao'\.`;/m,
  newPrompt
);

fs.writeFileSync(file, code, 'utf8');
console.log('Prompt in server.ts successfully updated.');
