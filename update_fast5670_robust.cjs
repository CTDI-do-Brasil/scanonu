const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'backend/src/server.ts');
let lines = fs.readFileSync(file, 'utf8').split('\n');
let newLines = [];

let inSaveGponBlock = false;
let saveGponReplaced = false;

let inSaveDuplicateBlock = false;
let saveDuplicateReplaced = false;

let inScanDuplicateBlock = false;
let scanDuplicateReplaced = false;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Save GPON Random Block
    if (!saveGponReplaced && line.includes("if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {") && lines[i-1].includes("UNIQUE constraint no PostgreSQL")) {
        inSaveGponBlock = true;
        
        newLines.push("    const normalizedModelo = normalizeModel(modelo, fabricante);");
        newLines.push("    const isFast5670 = normalizedModelo === 'F@ST 5670' || normalizedModelo === 'F@ST 5670V2';");
        newLines.push("");
        newLines.push("    // Gerar um GPON SN unico se vier como N/A apenas para F@ST 5670");
        newLines.push("    if (isFast5670 && (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA')) {");
        newLines.push("      const suffix = (mac && mac.toUpperCase() !== 'N/A') ? mac : Math.random().toString(36).substring(2, 10).toUpperCase();");
        newLines.push("      gpon_sn = 'N/A_' + suffix;");
        newLines.push("    } else if (!gpon_sn || gpon_sn.toUpperCase() === 'N/A' || gpon_sn.toUpperCase() === 'NA') {");
        newLines.push("      gpon_sn = 'N/A';");
        newLines.push("    }");
        
        // skip lines until normalizedModelo declaration
        while (!lines[i].includes("const normalizedModelo = normalizeModel(modelo, fabricante);")) {
            i++;
        }
        // now `i` is at the old normalizedModelo declaration line, which we skip because we already outputted it
        saveGponReplaced = true;
        inSaveGponBlock = false;
        continue; // skip the current old line
    }

    // 2. Save Duplicate Check
    if (!saveDuplicateReplaced && line.includes("let checkRes: any = { rowCount: 0 };")) {
        // found it
        newLines.push("    let checkRes: any = { rowCount: 0 };");
        newLines.push("    let duplicateType = 'GPON Serial';");
        newLines.push("");
        newLines.push("    if (gpon_sn && !gpon_sn.startsWith('N/A_') && gpon_sn.toUpperCase() !== 'N/A') {");
        newLines.push("      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE gpon_sn = $1 AND gpon_sn <> \\'N/A\\' AND gpon_sn <> \\'NA\\'', [gpon_sn]);");
        newLines.push("    } else if (isFast5670 && wifi_ssid && wifi_ssid.toUpperCase() !== 'N/A' && wifi_ssid.toUpperCase() !== 'NA') {");
        newLines.push("      checkRes = await pool.query('SELECT gpon_sn FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND (modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\')', [wifi_ssid]);");
        newLines.push("      duplicateType = 'SSID da Rede (pois não há GPON na etiqueta)';");
        newLines.push("    }");

        // skip lines until we close the block
        while (!lines[i].includes("duplicateType = 'SSID da Rede")) {
            i++;
        }
        // skip the closing bracket of else if
        i++;
        
        saveDuplicateReplaced = true;
        continue;
    }

    // 3. Scan Duplicate Check
    if (!scanDuplicateReplaced && line.includes("if (dbConnected && dbPool && scanResult.gpon_sn && scanResult.gpon_sn.toUpperCase() !== 'N/A' && scanResult.gpon_sn.toUpperCase() !== 'NA') {")) {
        newLines.push("    if (dbConnected && dbPool) {");
        newLines.push("      try {");
        newLines.push("        let checkRes = { rowCount: 0, rows: [] as any[] };");
        newLines.push("        const normModelo = normalizeModel(scanResult.modelo || '', scanResult.fabricante || '');");
        newLines.push("        const isScanFast5670 = normModelo === 'F@ST 5670' || normModelo === 'F@ST 5670V2';");
        newLines.push("        ");
        newLines.push("        if (scanResult.gpon_sn && scanResult.gpon_sn.toUpperCase() !== 'N/A' && scanResult.gpon_sn.toUpperCase() !== 'NA') {");
        newLines.push("          checkRes = await dbPool.query(");
        newLines.push("            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE gpon_sn = $1',");
        newLines.push("            [scanResult.gpon_sn]");
        newLines.push("          );");
        newLines.push("        } else if (isScanFast5670 && scanResult.wifi_ssid && scanResult.wifi_ssid.toUpperCase() !== 'N/A' && scanResult.wifi_ssid.toUpperCase() !== 'NA') {");
        newLines.push("          checkRes = await dbPool.query(");
        newLines.push("            'SELECT fabricante, modelo, cpe_sn, gpon_sn, mac, wifi_ssid, wifi_ssid_5g, wifi_key, usuario, web_key, web_key AS senha FROM etiquetas_scan_onu WHERE wifi_ssid = $1 AND (modelo = \\'F@ST 5670\\' OR modelo = \\'F@ST 5670V2\\')',");
        newLines.push("            [scanResult.wifi_ssid]");
        newLines.push("          );");
        newLines.push("        }");
        newLines.push("");
        newLines.push("        if (checkRes.rowCount && checkRes.rowCount > 0) {");
        newLines.push("          existsInDb = true;");
        newLines.push("          existingData = checkRes.rows[0];");
        newLines.push("        }");
        newLines.push("      } catch (dbErr) {");
        newLines.push("        console.error('Erro ao verificar duplicidade no scan-label:', dbErr);");
        newLines.push("      }");
        newLines.push("    }");

        // skip lines until the closing bracket
        while (!lines[i].includes("console.error('Erro ao verificar duplicidade no scan-label:', dbErr);")) {
            i++;
        }
        // skip the catch bracket and the if bracket
        i += 2;
        
        scanDuplicateReplaced = true;
        continue;
    }

    newLines.push(line);
}

fs.writeFileSync(file, newLines.join('\n'), 'utf8');
console.log('Update robust complete!');
