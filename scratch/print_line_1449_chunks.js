const fs = require('fs');
const path = require('path');

const logDir = 'C:\\Users\\Martin\\.gemini\\antigravity\\brain\\6fc4c4bf-51dd-4fcc-84f2-a1fd8a3fce8a\\.system_generated\\logs';
const transcriptFullPath = path.normalize(path.join(logDir, 'transcript_full.jsonl'));

const fileContent = fs.readFileSync(transcriptFullPath, 'utf8');
const lines = fileContent.split('\n');

const lineObj = JSON.parse(lines[1448]);
const tc = lineObj.tool_calls[0];
const chunks = tc.args.ReplacementChunks || [];

let out = `Found ${chunks.length} chunks.\n\n`;
chunks.forEach((c, idx) => {
    out += `=== Chunk #${idx + 1} ===\n`;
    out += `Lines: ${c.StartLine} - ${c.EndLine}\n`;
    out += `TargetContent:\n${c.TargetContent}\n`;
    out += `ReplacementContent:\n${c.ReplacementContent}\n`;
    out += `------------------------------------\n\n`;
});

fs.writeFileSync('C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/line_1449_chunks.txt', out, 'utf8');
console.log('Wrote chunks directly to file in UTF-8.');
