const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configurações
const CLOUD_URL = 'https://scanonu.ctdibrasil.com.br/api';
const ZEBRA_HOST = '127.0.0.1';
const ZEBRA_PORT = 9100;
const CONFIG_FILE = path.join(__dirname, 'config.json');

let config = {
  station_id: '',
  station_name: ''
};

// Carrega ou inicializa a configuração local
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const fileData = fs.readFileSync(CONFIG_FILE, 'utf8');
      config = JSON.parse(fileData);
    }
  } catch (e) {
    console.error('⚠️ Erro ao ler arquivo de config, gerando novo...', e.message);
  }

  // Se estiver sem ID ou Nome da estação, gera um automático baseado no Hostname do PC
  if (!config.station_id) {
    config.station_id = 'station_' + Math.random().toString(36).substring(2, 10);
  }
  if (!config.station_name) {
    config.station_name = 'Zebra_' + os.hostname();
  }

  // Salva a configuração atualizada
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('⚠️ Erro ao salvar arquivo de config:', e.message);
  }
}

loadConfig();

console.log('--------------------------------------------------');
console.log('🦓 SMART SCAN - CLIENTE DE IMPRESSÃO NUVEM v2 🦓');
console.log('--------------------------------------------------');
console.log(`🆔 ID da Estação: ${config.station_id}`);
console.log(`🖥️ Nome da Estação: ${config.station_name}`);
console.log(`📡 Conectado à nuvem: ${CLOUD_URL}`);
console.log(`🖨️ Procurando Zebra local na porta ${ZEBRA_PORT}...`);
console.log('--------------------------------------------------');

// Helper para fazer requisições HTTPS simplificadas para a nuvem
function cloudRequest(urlPath, method, payload = null) {
  return new Promise((resolve, reject) => {
    const url = `${CLOUD_URL}${urlPath}`;
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          resolve({});
        }
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// Envia sinal de vida (heartbeat) para registrar este computador na nuvem
async function sendHeartbeat() {
  try {
    const payload = JSON.stringify({
      id: config.station_id,
      name: config.station_name
    });
    await cloudRequest('/active-printers', 'POST', payload);
    // Log silencioso ou apenas um ponto para indicar atividade
  } catch (e) {
    console.error(`⚠️ Erro de conexão com a nuvem (Heartbeat): ${e.message}`);
  }
}

// Envia o ZPL para a impressora física via Zebra Browser Print local (porta 9100)
function printZplLocally(zpl, jobId) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: ZEBRA_HOST, port: ZEBRA_PORT, path: '/default' }, (defaultRes) => {
      let data = '';
      defaultRes.on('data', chunk => data += chunk);
      defaultRes.on('end', () => {
        try {
          let uid = '', name = '', provider = '';
          data.split('\n').forEach(line => {
            if (line.includes('ID:')) uid = line.split('ID:')[1].trim();
            if (line.includes('Name:')) name = line.split('Name:')[1].trim();
            if (line.includes('Provider:')) provider = line.split('Provider:')[1].trim();
          });

          if (!uid) return reject(new Error("Impressora padrão não configurada no Zebra Browser Print"));

          const payload = JSON.stringify({
            device: {
              deviceType: 'printer', uid: uid, provider: provider || 'com.zebra.ds.webdriver.desktop.provider.DefaultDeviceProvider',
              name: name, connection: 'usb', version: 3, manufacturer: 'Zebra Technologies'
            },
            data: zpl
          });

          const printReq = http.request({
            hostname: ZEBRA_HOST, port: ZEBRA_PORT, path: '/write', method: 'POST',
            headers: { 
              'Content-Type': 'application/json', 
              'Content-Length': Buffer.byteLength(payload) 
            }
          }, (printRes) => {
            if (printRes.statusCode === 200) {
              console.log(`✅ [IMPRESSÃO] Job #${jobId} impresso com sucesso na impressora local: ${name}`);
              resolve();
            } else {
              reject(new Error(`Erro HTTP Zebra: ${printRes.statusCode}`));
            }
          });

          printReq.on('error', reject);
          printReq.write(payload);
          printReq.end();
        } catch (e) { 
          reject(e); 
        }
      });
    }).on('error', reject);
  });
}

// Checa a fila de impressão na nuvem
async function pollJobs() {
  try {
    const data = await cloudRequest(`/print-jobs?station=${config.station_id}`, 'GET');
    if (data.jobs && data.jobs.length > 0) {
      for (const job of data.jobs) {
        console.log(`📥 Recebido Job #${job.id} da nuvem!`);
        try {
          // Imprime
          await printZplLocally(job.zpl, job.id);
          // Avisa a nuvem para apagar da fila
          await cloudRequest(`/print-jobs/${job.id}`, 'DELETE');
          console.log(`🗑️ Job #${job.id} removido da fila na nuvem.`);
        } catch (err) {
          console.error(`❌ Erro ao processar Job #${job.id}:`, err.message);
        }
      }
    }
  } catch (e) {
    // Silencia erros de timeout ou instabilidade na nuvem
  }
}

// Execução
setInterval(sendHeartbeat, 10000); // Heartbeat a cada 10s
setInterval(pollJobs, 2000);       // Polling de Jobs a cada 2s

sendHeartbeat();
pollJobs();
