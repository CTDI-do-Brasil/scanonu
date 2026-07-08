const fs = require('fs');
const path = require('path');

// Update frontend/src/App.tsx
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
        \`&targetDb=\${targetDatabase}\`,`;

let normAppCode = appCode.replace(/\r?\n/g, '\n');
const cleanAppTarget = appTarget.replace(/\r?\n/g, '\n');
const cleanAppReplacement = appReplacement.replace(/\r?\n/g, '\n');

if (normAppCode.includes(cleanAppTarget)) {
  const updatedAppCode = normAppCode.replace(cleanAppTarget, cleanAppReplacement);
  fs.writeFileSync(appPath, updatedAppCode, 'utf8');
  console.log('Update App.tsx complete');
} else {
  console.log('Target handleExportExcel block not found in App.tsx');
}
