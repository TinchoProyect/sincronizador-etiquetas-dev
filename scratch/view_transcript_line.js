const fs = require('fs');
const path = require('path');

const logDir = 'C:\\Users\\Martin\\.gemini\\antigravity\\brain\\6fc4c4bf-51dd-4fcc-84f2-a1fd8a3fce8a\\.system_generated\\logs';
const transcriptFullPath = path.normalize(path.join(logDir, 'transcript_full.jsonl'));

const fileContent = fs.readFileSync(transcriptFullPath, 'utf8');
const lines = fileContent.split('\n');

const lineObj = JSON.parse(lines[1448]); // 1449 is 1448 index
console.log('Line 1449:');
console.log(JSON.stringify(lineObj.tool_calls, null, 2));
