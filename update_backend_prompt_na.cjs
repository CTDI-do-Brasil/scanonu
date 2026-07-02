const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let code = fs.readFileSync(file, 'utf8');

const updatedPrompt = `  const prompt = \`Analise a imagem da etiqueta do equipamento ONU/ONT e extraia os seguintes campos de forma estruturada. 
Siga atentamente as instruções abaixo para cada campo:
1. fabricante: Fabricante da ONU (ex: Huawei, ZTE, FiberHome, Intelbras, Nokia, Alcatel, SagemCOM). Se não encontrar na etiqueta, escreva 'N/A'.
2. modelo: Modelo exato da ONU (ex: F670L, HG8145V5, EG8145V5, F6600, F680, F673, XC-FIT-150, F@ST 5655V2, etc.). Se não encontrar na etiqueta, escreva 'N/A'.
3. cpe_sn: Serial CPE/Equipamento (ex: PN, SAP, ou N7...). Se for igual ao GPON SN, deixe vazio ou extraia o correto se houver. Se não houver, escreva 'N/A'. No caso de PN ou SAP (como PN: 253925847, SAP: TM04014670), pode capturar essa informação como CPE SN ou Modelo, mas se não achar os clássicos, preencha N/A.
4. gpon_sn: Serial GPON (ex: SMBS12345678, ZTEG12345678, FHTT12345678, ALCL12345678, HWTC12345678). Se a etiqueta NÃO TIVER Gpon SN explícito, NÃO INVENTE. Escreva exatamente 'N/A'.
5. mac: Endereço MAC físico de 12 caracteres hexadecimais (ex: 8020DAD1D2D3). Se a etiqueta NÃO TIVER MAC explícito, NÃO INVENTE. Escreva exatamente 'N/A'.
6. wifi_ssid: Nome da rede Wi-Fi de 2.4GHz ou rede única. Se não achar, 'N/A'.
7. wifi_ssid_5g: Nome da rede Wi-Fi de 5GHz. Se não achar, 'N/A'.
8. wifi_key: Senha padrão do Wi-Fi. ATENÇÃO MÁXIMA À EXATIDÃO: Diferencie claramente letras maiúsculas de minúsculas. CUIDADO REDOBRADO: O modelo de IA tem um vício crônico em ler '!' como a letra 'I' maiúscula. As senhas de Wi-Fi de roteadores (Claro, Vivo, TIM, etc) frequentemente contêm o símbolo de exclamação '!'. Sempre que vir um traço vertical, preste muita atenção se não há um ponto embaixo dele caracterizando um '!'. Se a senha parecer ter um 'I' jogado aleatoriamente (ex: adminI123, TIM_wifiI, Yh6t*XID), o correto quase 100% das vezes é '!'. NUNCA converta '!' para 'I'. Se não achar a senha, 'N/A'.
9. usuario: Usuário padrão de acesso web (ex: admin). Se não achar, 'N/A'.
10. web_key: Senha de acesso web (Password/Senha). Aplique a mesma regra estrita do wifi_key para não confundir '!' com 'I'. Se não achar, 'N/A'.
11. reimpressa: Identifique se a etiqueta é uma reimpressão (geralmente não original, impressa em papel adesivo comum) retornando 'sim' ou 'nao'.\`;`;

// Usamos regex flexível para substituir a definição do prompt inteira
code = code.replace(
  /const prompt = `Analise a imagem da etiqueta[\s\S]*?retornando 'sim' ou 'nao'\.`;/m,
  updatedPrompt
);

fs.writeFileSync(file, code, 'utf8');
console.log('Prompt in server.ts successfully updated with N/A logic.');
