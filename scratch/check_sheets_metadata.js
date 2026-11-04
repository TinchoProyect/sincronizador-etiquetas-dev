const { getSheets } = require('../src/google/gsheetsClient');
require('dotenv').config();

const spreadsheetId = '1r7VEnEArREqAGZiDxQCW4A0XIKb8qaxHXD0TlVhfuf8';

async function run() {
    try {
        console.log('--- REVISANDO GOOGLE SPREADSHEET ONLINE ---');
        console.log('Spreadsheet ID:', spreadsheetId);
        
        const sheets = await getSheets();
        
        // 1. Obtener metadatos de las hojas
        const metadata = await sheets.spreadsheets.get({
            spreadsheetId
        });
        
        console.log('\nHojas encontradas en este Spreadsheet:');
        metadata.data.sheets.forEach(s => {
            console.log(`- Título: ${s.properties.title} (ID: ${s.properties.sheetId})`);
        });

        // 2. Leer la cantidad de filas y las últimas filas del tab "Presupuestos"
        console.log('\nLeyendo la hoja "Presupuestos"...');
        const rangeRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Presupuestos!A:P'
        });
        
        const rows = rangeRes.data.values || [];
        console.log(`Filas totales leídas del Sheet (incluyendo cabecera): ${rows.length}`);
        
        if (rows.length > 0) {
            console.log('\nÚltimas 5 filas en el Sheet:');
            const lastRows = rows.slice(-5);
            lastRows.forEach((r, idx) => {
                console.log(`Fila ${rows.length - 5 + idx + 1}:`, r);
            });
        }

        // 3. Leer las últimas filas del tab "DetallesPresupuestos"
        console.log('\nLeyendo la hoja "DetallesPresupuestos"...');
        const detailsRes = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'DetallesPresupuestos!A:Q'
        });
        
        const detailRows = detailsRes.data.values || [];
        console.log(`Filas totales leídas de DetallesPresupuestos: ${detailRows.length}`);
        
        if (detailRows.length > 0) {
            console.log('\nÚltimas 5 filas de detalles en el Sheet:');
            const lastDetailRows = detailRows.slice(-5);
            lastDetailRows.forEach((r, idx) => {
                console.log(`Fila ${detailRows.length - 5 + idx + 1}:`, r);
            });
        }
        
    } catch (e) {
        console.error('Error crítico consultando Google Sheets:', e);
    }
}

run();
