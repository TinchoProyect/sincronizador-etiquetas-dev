const fs = require('fs');

const logPath = 'C:/Users/Martin/.gemini/antigravity/brain/6fc4c4bf-51dd-4fcc-84f2-a1fd8a3fce8a/.system_generated/tasks/task-1701.log';
if (!fs.existsSync(logPath)) {
    console.error('Log file not found.');
    process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
    if (line.includes('exited with code')) {
        console.log(`Line ${idx + 1}: ${line}`);
    }
});
