const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configurações
const CLOUD_URL = 'https://scanonu.ctdibrasil.com.br/api';
const ZEBRA_HOST = '127.0.0.1';
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

  if (!config.station_id) {
    config.station_id = 'station_' + Math.random().toString(36).substring(2, 10);
  }
  if (!config.station_name) {
    config.station_name = 'Zebra_' + os.hostname();
  }

  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('⚠️ Erro ao salvar arquivo de config:', e.message);
  }
}

loadConfig();

console.log('--------------------------------------------------');
console.log('🦓 SMART SCAN - CLIENTE DE IMPRESSÃO NUVEM v3.0 🦓');
console.log('--------------------------------------------------');
console.log(`🆔 ID da Estação: ${config.station_id}`);
console.log(`🖥️ Nome da Estação: ${config.station_name}`);
console.log(`📡 Conectado à nuvem: ${CLOUD_URL}`);
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
  } catch (e) {
    console.error(`⚠️ Erro de conexão com a nuvem (Heartbeat): ${e.message}`);
  }
}

// Auto-detecta a porta e o protocolo do Zebra Browser Print local
function getZebraDevice(hostname, port, protocol) {
  return new Promise((resolve, reject) => {
    const client = protocol === 'https' ? https : http;
    const options = {
      hostname: hostname,
      port: port,
      path: '/default',
      method: 'GET',
      timeout: 1500,
      rejectUnauthorized: false
    };

    const req = client.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Erro ao consultar impressora padrão (HTTP ${res.statusCode})`));
        }
        try {
          // Tenta parsear como JSON primeiro
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          // Fallback para texto plano do Zebra antigo
          let uid = '', name = '', provider = '', connection = 'usb', deviceType = 'printer';
          data.split('\n').forEach(line => {
            if (line.includes('ID:')) uid = line.split('ID:')[1].trim();
            if (line.includes('Name:')) name = line.split('Name:')[1].trim();
            if (line.includes('Provider:')) provider = line.split('Provider:')[1].trim();
            if (line.includes('Connection:')) connection = line.split('Connection:')[1].trim();
          });
          if (uid) {
            resolve({ uid, name, provider, connection, deviceType, version: 3, manufacturer: 'Zebra Technologies' });
          } else {
            reject(new Error("Resposta da impressora não pôde ser interpretada."));
          }
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error("Timeout ao conectar.")); });
  });
}

// Envia ZPL para impressão local
function sendZplToZebra(hostname, port, protocol, device, zpl) {
  return new Promise((resolve, reject) => {
    const client = protocol === 'https' ? https : http;
    const payload = JSON.stringify({ device, data: zpl });
    const options = {
      hostname: hostname,
      port: port,
      path: '/write',
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = client.request(options, (res) => {
      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}. Detalhe: ${resBody.trim() || 'Sem detalhes'}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Detecta portas automaticamente
async function detectZebraEndpoint() {
  const configs = [
    { port: 9101, protocol: 'http' },
    { port: 9102, protocol: 'https' },
    { port: 9101, protocol: 'https' },
    { port: 9100, protocol: 'http' }
  ];

  for (const conf of configs) {
    try {
      const dev = await getZebraDevice(ZEBRA_HOST, conf.port, conf.protocol);
      return { port: conf.port, protocol: conf.protocol, device: dev };
    } catch (e) {
      // Ignora erro e tenta o próximo
    }
  }
  throw new Error("Zebra Browser Print não responde nas portas esperadas (9100/9101/9102). O aplicativo da Zebra está aberto?");
}

// Executa a impressão
async function printZplLocally(zpl, jobId) {
  const endpoint = await detectZebraEndpoint();
  console.log(`🔌 [CONECTADO] Detectado Browser Print em ${endpoint.protocol}://localhost:${endpoint.port}`);
  await sendZplToZebra(ZEBRA_HOST, endpoint.port, endpoint.protocol, endpoint.device, zpl);
  console.log(`✅ [IMPRESSÃO] Job #${jobId} impresso com sucesso na impressora: ${endpoint.device.name}`);
}

// Checa a fila de impressão na nuvem
async function pollJobs() {
  try {
    const data = await cloudRequest(`/print-jobs?station=${config.station_id}`, 'GET');
    if (data.jobs && data.jobs.length > 0) {
      for (const job of data.jobs) {
        console.log(`📥 Recebido Job #${job.id} da nuvem!`);
        try {
          await printZplLocally(job.zpl, job.id);
          await cloudRequest(`/print-jobs/${job.id}`, 'DELETE');
          console.log(`🗑️ Job #${job.id} removido da fila na nuvem.`);
        } catch (err) {
          console.error(`❌ Erro ao processar Job #${job.id}:`, err.message);
        }
      }
    }
  } catch (e) {
    // Silencia erros temporários de conexão
  }
}

// Execução
setInterval(sendHeartbeat, 10000); // Heartbeat a cada 10s
setInterval(pollJobs, 2000);       // Polling de Jobs a cada 2s

sendHeartbeat();
pollJobs();
