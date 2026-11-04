const fs = require('fs');
const path = require('path');

function searchInDir(dir, query) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (!file.includes('node_modules') && !file.startsWith('.') && !file.includes('dist')) {
                searchInDir(fullPath, query);
            }
        } else {
            if (file.endsWith('.js') || file.endsWith('.jsx') || file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.html') || file.endsWith('.json')) {
                const content = fs.readFileSync(fullPath, 'utf8');
                if (content.toLowerCase().includes(query.toLowerCase())) {
                    console.log(`Found "${query}" in: ${fullPath}`);
                }
            }
        }
    }
}

const b2bSrc = path.join(__dirname, '..', '..', '..', 'b2b-portal', 'src');
console.log('Searching under:', b2bSrc);

if (fs.existsSync(b2bSrc)) {
    console.log('--- Searching for "saldo" ---');
    searchInDir(b2bSrc, 'saldo');

    console.log('--- Searching for "actual" ---');
    searchInDir(b2bSrc, 'actual');
} else {
    console.log('b2bSrc not found!');
}
