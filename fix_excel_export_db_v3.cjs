const fs = require('fs');
const path = require('path');

// 1. Update frontend/src/App.tsx
const appPath = path.join(__dirname, 'frontend/src/App.tsx');
let appCode = fs.readFileSync(appPath, 'utf8');

// Include version indicator
const appVersionTarget = `<p className="text-[10px] text-blue-200/70 font-medium capitalize">Administrador</p>`;
const appVersionReplacement = `<p className="text-[10px] text-blue-200/70 font-medium capitalize">{user?.role === 'master' ? 'Master' : user?.role === 'consulta' ? 'Consulta' : 'Administrador'} • v1.2.0</p>`;

const appTarget = `  const handleExportExcel = async () => {
    if (!user || user.role !== 'master') return;
    try {
      const response = await fetch(
        \`/api/admin/export-excel?search=\${encodeURIComponent(filterSearch)}\` +
        \`&startDate=\${encodeURIComponent(filterStartDate)}\` +
        \`&endDate=\${encodeURIComponent(filterEndDate)}\` +
        \`&modelo=\${encodeURIComponent(filterModel)}\__,`;

const appReplacement = `  const handleExportExcel = async () => {
    if (!user || (user.role !== 'master' && user.role !== 'admin' && user.role !== 'consulta')) return;
    try {
      const response = await fetch(
        \`/api/admin/export-excel?search=\${encodeURIComponent(filterSearch)}\` +
        \`&startDate=\${encodeURIComponent(filterStartDate)}\` +
        \`&endDate=\${encodeURIComponent(filterEndDate)}\` +
        \`&modelo=\${encodeURIComponent(filterModel)}\` +
        \`&targetDb=\${targetDatabase}\__,`;

let normAppCode = appCode.replace(/\r?\n/g, '\n');
if (normAppCode.includes(appVersionTarget)) {
  normAppCode = normAppCode.replace(appVersionTarget, appVersionReplacement);
}
// Clean target to match
const cleanAppTarget = appTarget.replace(/\r?\n/g, '\n').replace('__', '');
const cleanAppReplacement = appReplacement.replace(/\r?\n/g, '\n').replace('__', '');

if (normAppCode.includes(cleanAppTarget)) {
  const updatedAppCode = normAppCode.replace(cleanAppTarget, cleanAppReplacement);
  fs.writeFileSync(appPath, updatedAppCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target handleExportExcel block not found in App.tsx');
}

// 2. Update backend/src/server.ts
const serverPath = path.join(__dirname, 'backend/src/server.ts');
let serverCode = fs.readFileSync(serverPath, 'utf8');
let normServerCode = serverCode.replace(/\r?\n/g, '\n');

// Update export-xml route block
const xmlStartStr = "app.get('/api/admin/export-xml'";
const excelStartStr = "app.get('/api/admin/export-excel'";
const externalStartStr = "app.get('/api/external/units'";

const idxXml = normServerCode.indexOf(xmlStartStr);
const idxExcel = normServerCode.indexOf(excelStartStr);
const idxExternal = normServerCode.indexOf(externalStartStr);

if (idxXml !== -1 && idxExcel !== -1 && idxExternal !== -1) {
  // Isolate XML section
  let xmlSection = normServerCode.substring(idxXml, idxExcel);
  xmlSection = xmlSection.replace(
    'const { serialNumber, mac, startDate, endDate, modelo } = req.query;',
    'const { serialNumber, mac, startDate, endDate, modelo, targetDb } = req.query;'
  );
  xmlSection = xmlSection.replace(
    `    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }`,
    `    const pool = targetDb ? getPoolForDatabase(targetDb as string) : dbPool;
    if (!dbConnected || !pool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }`
  );
  xmlSection = xmlSection.replace(
    'await dbPool.query(queryText, queryValues)',
    'await pool.query(queryText, queryValues)'
  );

  // Isolate Excel section
  let excelSection = normServerCode.substring(idxExcel, idxExternal);
  excelSection = excelSection.replace(
    'const { search, startDate, endDate, modelo } = req.query;',
    'const { search, startDate, endDate, modelo, targetDb } = req.query;'
  );
  excelSection = excelSection.replace(
    `    if (!dbConnected || !dbPool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }`,
    `    const pool = targetDb ? getPoolForDatabase(targetDb as string) : dbPool;
    if (!dbConnected || !pool) {
      return res.status(500).json({ error: 'Banco de dados não está conectado.' });
    }`
  );
  excelSection = excelSection.replace(
    'await dbPool.query(queryText, queryValues)',
    'await pool.query(queryText, queryValues)'
  );

  normServerCode = normServerCode.substring(0, idxXml) + xmlSection + excelSection + normServerCode.substring(idxExternal);
  fs.writeFileSync(serverPath, normServerCode, 'utf8');
  console.log('Update server.ts complete');
} else {
  console.log('Target route start positions not found in server.ts');
}
