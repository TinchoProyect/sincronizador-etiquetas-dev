const fs = require('fs');
const readline = require('readline');

async function run() {
    const fileStream = fs.createReadStream('C:\\Users\\Martin\\.gemini\\antigravity\\brain\\ef87772e-8ba5-4542-9cc5-8f8c5a97eb52\\.system_generated\\logs\\transcript.jsonl');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let output = '';

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const step = JSON.parse(line);
            
            // Buscar en tool_calls de la respuesta del modelo
            if (step.tool_calls) {
                for (const tc of step.tool_calls) {
                    if (tc.name === 'replace_file_content' || tc.name === 'write_to_file') {
                        const content = tc.args.ReplacementContent || tc.args.CodeContent;
                        if (content && content.includes('desglose-seccion-costos')) {
                            output += '--- FOUND IN ReplacementContent ---\n' + content + '\n\n';
                        }
                    }
                }
            }
            
            // También buscar en content
            if (step.content && step.content.includes('desglose-seccion-costos')) {
                output += '--- FOUND IN Content ---\n' + step.content + '\n\n';
            }
        } catch (e) {
            // Ignorar errores de parseo
        }
    }

    fs.writeFileSync('scratch/extracted_html.txt', output, 'utf8');
    console.log('Done writing extracted_html.txt');
}

run();
