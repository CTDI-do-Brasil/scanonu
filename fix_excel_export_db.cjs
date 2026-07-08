const fs = require('fs');
const path = require('path');

// 1. Update frontend/src/App.tsx
const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

const appTarget = `  const handleExportExcel = async () => {
    if (!user || user.role !== 'master') return;
    try {
      const response = await fetch(
        \`/api/admin/export-excel?search=\${encodeURIComponent(filterSearch)}\` +
        \`&startDate=\${encodeURIComponent(filterStartDate)}\` +
        \`&endDate=\${encodeURIComponent(filterEndDate)}\` +
        \`&modelo=\${encodeURIComponent(filterModel)}\`,`;

const appReplacement = `  const handleExportExcel = async () => {
    if (!user || (user.role !== 'master' && user.role !== 'admin' && user.role !== 'consulta')) return;
    try {
      const response = await fetch(
        \`/api/admin/export-excel?search=\${encodeURIComponent(filterSearch)}\` +
        \`&startDate=\${encodeURIComponent(filterStartDate)}\` +
        \`&endDate=\${encodeURIComponent(filterEndDate)}\` +
        \`&modelo=\${encodeURIComponent(filterModel)}\` +
        \`&targetDb=\${currentDb}\`,`;

const normAppCode = appCode.replace(/\r?\n/g, '\n');
const normAppTarget = appTarget.replace(/\r?\n/g, '\n');

if (normAppCode.includes(normAppTarget)) {
  const updatedAppCode = normAppCode.replace(normAppTarget, appReplacement.replace(/\r?\n/g, '\n'));
  fs.writeFileSync(appPath, updatedAppCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target handleExportExcel block not found in App.tsx');
}

// 2. Update backend/src/server.ts
const serverPath = path.join(__dirname, 'backend/src/server.ts');
let serverCode = fs.readFileSync(serverPath, 'utf8');

const serverTargetExcel = `// Rota para exportar todas as etiquetas em Excel (somente Admin)
app.get('/api/admin/export-excel', authenticateSession, async (req: any, res: any) => {
  try {
    const { search, startDate, endDate, modelo } = req.query;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    if (req.user.role !== 'master' && req.user.role !== 'admin' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado. Perfil sem permissão para exportar a planilha.' });
    }

    let queryText = 'SELECT * FROM etiquetas_scan_onu WHERE 1=1';
    const queryValues: any[] = [];
    let paramCount = 1;`;

const serverReplacementExcel = `// Rota para exportar todas as etiquetas em Excel (somente Admin)
app.get('/api/admin/export-excel', authenticateSession, async (req: any, res: any) => {
  try {
    const { search, startDate, endDate, modelo, targetDb } = req.query;

    const pool = targetDb ? getPoolForDatabase(targetDb as string) : dbPool;
    if (!dbConnected || !pool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    if (req.user.role !== 'master' && req.user.role !== 'admin' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado. Perfil sem permissão para exportar a planilha.' });
    }

    let queryText = 'SELECT * FROM etiquetas_scan_onu WHERE 1=1';
    const queryValues: any[] = [];
    let paramCount = 1;`;

const serverTargetXml = `// Rota para exportar todas as etiquetas em XML (somente Admin)
app.get('/api/admin/export-xml', authenticateSession, async (req: any, res: any) => {
  try {
    const { serialNumber, mac, startDate, endDate, modelo } = req.query;

    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    if (req.user.role !== 'master' && req.user.role !== 'admin' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado. Perfil sem permissão para exportar o banco.' });
    }

    let queryText = 'SELECT * FROM etiquetas_scan_onu WHERE 1=1';
    const queryValues: any[] = [];
    let paramCount = 1;`;

const serverReplacementXml = `// Rota para exportar todas as etiquetas em XML (somente Admin)
app.get('/api/admin/export-xml', authenticateSession, async (req: any, res: any) => {
  try {
    const { serialNumber, mac, startDate, endDate, modelo, targetDb } = req.query;

    const pool = targetDb ? getPoolForDatabase(targetDb as string) : dbPool;
    if (!dbConnected || !pool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }

    if (req.user.role !== 'master' && req.user.role !== 'admin' && req.user.role !== 'consulta') {
      return res.status(403).json({ error: 'Acesso negado. Perfil sem permissão para exportar o banco.' });
    }

    let queryText = 'SELECT * FROM etiquetas_scan_onu WHERE 1=1';
    const queryValues: any[] = [];
    let paramCount = 1;`;

const normServerCode = serverCode.replace(/\r?\n/g, '\n');
const normServerTargetExcel = serverTargetExcel.replace(/\r?\n/g, '\n');
const normServerTargetXml = serverTargetXml.replace(/\r?\n/g, '\n');

let serverUpdated = false;
let updatedServerCode = normServerCode;

if (normServerCode.includes(normServerTargetExcel)) {
  updatedServerCode = updatedServerCode.replace(normServerTargetExcel, serverReplacementExcel.replace(/\r?\n/g, '\n'));
  serverUpdated = true;
} else {
  console.log('Target export-excel block not found in server.ts');
}

if (normServerCode.includes(normServerTargetXml)) {
  updatedServerCode = updatedServerCode.replace(normServerTargetXml, serverReplacementXml.replace(/\r?\n/g, '\n'));
  serverUpdated = true;
} else {
  console.log('Target export-xml block not found in server.ts');
}

if (serverUpdated) {
  // Also replace database pool references in those routes (dbPool.query -> pool.query)
  // Let's replace dbPool.query with pool.query in export-excel and export-xml routes
  // The query calls: const etiquetasRes = await dbPool.query(queryText, queryValues);
  updatedServerCode = updatedServerCode.replace(/await dbPool\.query\(queryText,\s*queryValues\)/g, 'await pool.query(queryText, queryValues)');
  fs.writeFileSync(serverPath, updatedServerCode, 'utf8');
  console.log('Update server.ts complete');
}
