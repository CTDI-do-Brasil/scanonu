const fs = require('fs');
const path = require('path');

// 1. Update frontend/src/App.tsx
const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

// Also include version number v1.2.0 in frontend since we checked it out
const appVersionTarget = `<p className="text-[10px] text-blue-200/70 font-medium capitalize">Administrador</p>`;
const appVersionReplacement = `<p className="text-[10px] text-blue-200/70 font-medium capitalize">{user?.role === 'master' ? 'Master' : user?.role === 'consulta' ? 'Consulta' : 'Administrador'} • v1.2.0</p>`;

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
        \`&targetDb=\${targetDatabase}\`,`;

let normAppCode = appCode.replace(/\r?\n/g, '\n');
if (normAppCode.includes(appVersionTarget)) {
  normAppCode = normAppCode.replace(appVersionTarget, appVersionReplacement);
}
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

const serverTargetExcel = `app.get('/api/admin/export-excel', authenticateSession, async (req: any, res: any) => {
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

const serverReplacementExcel = `app.get('/api/admin/export-excel', authenticateSession, async (req: any, res: any) => {
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

const serverTargetXml = `app.get('/api/admin/export-xml', authenticateSession, async (req: any, res: any) => {
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

const serverReplacementXml = `app.get('/api/admin/export-xml', authenticateSession, async (req: any, res: any) => {
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
  // Let's do a precise replace of dbPool.query inside these two functions only!
  // We locate the index of the functions and replace dbPool.query with pool.query
  // For export-excel:
  const idxExcel = updatedServerCode.indexOf("app.get('/api/admin/export-excel'");
  const idxExcelEnd = updatedServerCode.indexOf("app.get('/api/admin/export-xml'", idxExcel);
  let excelSection = updatedServerCode.substring(idxExcel, idxExcelEnd);
  excelSection = excelSection.replace('dbPool.query', 'pool.query');
  
  // For export-xml:
  const idxXml = idxExcelEnd;
  const idxXmlEnd = updatedServerCode.indexOf("app.get('/api/external/units'", idxXml);
  let xmlSection = updatedServerCode.substring(idxXml, idxXmlEnd);
  xmlSection = xmlSection.replace('dbPool.query', 'pool.query');
  
  updatedServerCode = updatedServerCode.substring(0, idxExcel) + excelSection + xmlSection + updatedServerCode.substring(idxXmlEnd);

  fs.writeFileSync(serverPath, updatedServerCode, 'utf8');
  console.log('Update server.ts complete');
}
