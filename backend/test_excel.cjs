const XLSX = require('xlsx');

// Create a workbook with the user's data
const wb = XLSX.utils.book_new();
const ws_data = [
  ['fabricante', 'modelo', 'CPE SN', 'GPON ID', 'MAC'],
  ['SagemCOM', 'F@ST 5670', 'N7221768L001025', 'SMBS00464DBB', 'E4C0E2BEB277']
];
const ws = XLSX.utils.aoa_to_sheet(ws_data);
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
console.log('Parsed rows:', rows);

const getVal = (row, keys) => {
  const rowKeys = Object.keys(row);
  for (const k of keys) {
    const matchingKey = rowKeys.find(rk => rk.trim().toLowerCase() === k.trim().toLowerCase());
    if (matchingKey && row[matchingKey] !== undefined && row[matchingKey] !== null) {
      return String(row[matchingKey]).trim();
    }
  }
  return '';
};

for (const row of rows) {
  const gpon_sn_raw = getVal(row, ['GPON', 'gpon', 'GPON Serial Number', 'GPON Serial', 'gpon_sn', 'Gpon Sn', 'GPON SN', 'GPON ID', 'Serial', 'S/N', 'serial', 'CUSN']);
  console.log('gpon_sn_raw:', gpon_sn_raw);
}
