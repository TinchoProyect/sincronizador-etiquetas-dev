const fs = require('fs');
const path = require('path');

const logDir = 'C:\\Users\\Martin\\.gemini\\antigravity\\brain\\6fc4c4bf-51dd-4fcc-84f2-a1fd8a3fce8a\\.system_generated\\logs';
const transcriptFullPath = path.normalize(path.join(logDir, 'transcript_full.jsonl'));

if (!fs.existsSync(transcriptFullPath)) {
    console.error('transcript_full.jsonl does not exist!');
    process.exit(1);
}

const fileContent = fs.readFileSync(transcriptFullPath, 'utf8');
const lines = fileContent.split('\n');

let foundCount = 0;
lines.forEach((line, idx) => {
    if (!line.trim()) return;
    try {
        const obj = JSON.parse(line);
        if (obj.tool_calls && Array.isArray(obj.tool_calls)) {
            obj.tool_calls.forEach(tc => {
                const str = JSON.stringify(tc);
                if (str.includes('gp-switch-enlace-container')) {
                    foundCount++;
                    console.log(`Match #${foundCount} | Line ${idx + 1} | Tool: ${tc.name}`);
                    console.log('TargetFile:', tc.args.TargetFile);
                    console.log('Snippet:', str.substring(str.indexOf('gp-switch-enlace-container') - 100, str.indexOf('gp-switch-enlace-container') + 200));
                    console.log('-------------------------------------------------------------\n');
                }
            });
        }
    } catch (e) {
        // Ignored parse error
    }
});

console.log(`Found ${foundCount} references in tool calls.`);
