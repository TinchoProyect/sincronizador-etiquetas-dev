const fs = require('fs');
const path = require('path');

const logDir = 'C:\\Users\\Martin\\.gemini\\antigravity\\brain\\6fc4c4bf-51dd-4fcc-84f2-a1fd8a3fce8a\\.system_generated\\logs';
const transcriptFullPath = path.normalize(path.join(logDir, 'transcript_full.jsonl'));

console.log('Reading full transcript from:', transcriptFullPath);

if (!fs.existsSync(transcriptFullPath)) {
    console.error('transcript_full.jsonl does not exist!');
    process.exit(1);
}

const fileContent = fs.readFileSync(transcriptFullPath, 'utf8');
const lines = fileContent.split('\n');

let foundCount = 0;
let out = '';

lines.forEach((line, idx) => {
    if (!line.trim()) return;
    try {
        const obj = JSON.parse(line);
        if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
            obj.tool_calls.forEach(tc => {
                if (tc.name === 'replace_file_content' || tc.name === 'multi_replace_file_content') {
                    const args = tc.args || {};
                    const targetFile = args.TargetFile || '';
                    if (targetFile.includes('listado-bunker.html')) {
                        foundCount++;
                        out += `Match #${foundCount} | Line ${idx + 1} | Tool: ${tc.name}\n`;
                        out += `Instruction: ${args.Instruction}\n`;
                        out += `TargetContent:\n${typeof args.TargetContent === 'string' ? args.TargetContent : JSON.stringify(args.TargetContent)}\n`;
                        out += `ReplacementContent:\n${typeof args.ReplacementContent === 'string' ? args.ReplacementContent : JSON.stringify(args.ReplacementContent || args.ReplacementChunks, null, 2)}\n`;
                        out += `-------------------------------------------------------------\n\n`;
                    }
                }
            });
        }
    } catch (e) {
        // Ignored parse error
    }
});

fs.writeFileSync('C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/html_modifications.txt', out, 'utf8');
console.log(`Found ${foundCount} modifications to listado-bunker.html in the full transcript and wrote to file.`);
