const fs = require('fs');
const path = require('path');

const SEARCH_ROOTS = [
    'c:\\Users\\Martin\\Documents',
    'c:\\Users\\Martin\\Desktop',
    'c:\\Users\\Martin\\Downloads',
    'c:\\Users\\Martin'
];

function findSqlFiles(dir, depth = 0) {
    if (depth > 3) return []; // limit recursion depth
    let results = [];
    try {
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const fullPath = path.join(dir, file);
            let stat;
            try {
                stat = fs.statSync(fullPath);
            } catch (e) {
                continue;
            }
            if (stat && stat.isDirectory()) {
                if (file.toLowerCase().includes('node_modules') || file.startsWith('.') || file.toLowerCase().includes('appdata')) {
                    continue;
                }
                results = results.concat(findSqlFiles(fullPath, depth + 1));
            } else {
                const ext = path.extname(file).toLowerCase();
                const name = file.toLowerCase();
                if (ext === '.sql' || ext === '.backup' || ext === '.bak' || name.includes('dump') || name.includes('backup')) {
                    if (stat.size > 1024) { // only files > 1KB
                        results.push({ path: fullPath, size: stat.size, mtime: stat.mtime });
                    }
                }
            }
        }
    } catch (e) {
        // ignore errors
    }
    return results;
}

console.log('Buscando archivos de respaldo de base de datos...');
let allFiles = [];
for (const root of SEARCH_ROOTS) {
    console.log(`Buscando en ${root}...`);
    allFiles = allFiles.concat(findSqlFiles(root));
}

// Sort by mtime descending
allFiles.sort((a, b) => b.mtime - a.mtime);

console.log(`Encontrados ${allFiles.length} archivos potenciales:`);
allFiles.forEach(f => {
    console.log(`- ${f.path} (${Math.round(f.size / 1024)} KB) - Modificado: ${f.mtime}`);
});
