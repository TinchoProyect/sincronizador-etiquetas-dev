const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logPath = 'C:\\Users\\Martin\\.gemini\\antigravity\\brain\\7605c2e6-80f1-4a9c-9d8e-334011c8dcda\\.system_generated\\logs\\transcript.jsonl';

async function run() {
    if (!fs.existsSync(logPath)) {
        console.error('Log file does not exist:', logPath);
        return;
    }

    console.log('Reading transcript.jsonl...');
    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let lineCount = 0;
    let matchCount = 0;
    for await (const line of rl) {
        lineCount++;
        if (line.includes('presupuestos') && (line.includes('id_presupuesto_ext') || line.includes('comprobante_lomasoft') || line.includes('id_factura_lomasoft'))) {
            // Check if it has a large table dump or JSON array of budgets
            if (line.length > 500) {
                matchCount++;
                console.log(`Line ${lineCount}: Found long matching line (${line.length} chars)`);
                // Print a snippet of the line
                console.log(line.substring(0, 300) + '...');
                
                // Save it to a scratch file for inspection
                fs.writeFileSync(`scratch/match_${matchCount}.json`, line);
            }
        }
    }
    console.log(`Finished reading ${lineCount} lines. Found ${matchCount} long matches.`);
}

run();
