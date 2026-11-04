const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logPath = 'C:/Users/Martin/.gemini/antigravity/brain/6fc4c4bf-51dd-4fcc-84f2-a1fd8a3fce8a/.system_generated/logs/transcript_full.jsonl';
const outputPath = 'C:/Users/Martin/Documents/sincronizador-etiquetas - copia/scratch/extracted_history.md';

async function run() {
    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let editCount = 0;
    let outputContent = '# Extracted Edit History\n\n';

    for await (const line of rl) {
        if (!line.trim()) continue;
        const step = JSON.parse(line);
        if (step.tool_calls) {
            for (const call of step.tool_calls) {
                if (call.name === 'replace_file_content' || call.name === 'write_to_file') {
                    const args = call.args;
                    const file = args.TargetFile || args.AbsolutePath;
                    if (file && (file.includes('listado-bunker.js') || file.includes('listado-bunker.html'))) {
                        editCount++;
                        outputContent += `## EDIT #${editCount} (Step: ${step.step_index}, Tool: ${call.name})\n`;
                        outputContent += `- **File**: \`${file}\`\n`;
                        outputContent += `- **Instruction**: ${args.Instruction}\n\n`;
                        if (args.TargetContent) {
                            outputContent += `### TargetContent\n\`\`\`javascript\n${args.TargetContent}\n\`\`\`\n\n`;
                        }
                        if (args.ReplacementContent) {
                            outputContent += `### ReplacementContent\n\`\`\`javascript\n${args.ReplacementContent}\n\`\`\`\n\n`;
                        }
                        if (args.CodeContent) {
                            outputContent += `### CodeContent\n\`\`\`javascript\n${args.CodeContent}\n\`\`\`\n\n`;
                        }
                        outputContent += '---\n\n';
                    }
                }
            }
        }
    }

    fs.writeFileSync(outputPath, outputContent, 'utf8');
    console.log('Saved history to:', outputPath);
}

run();
