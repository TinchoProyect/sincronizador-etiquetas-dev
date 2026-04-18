const cp = require('child_process');
const fs = require('fs');

const output = cp.execSync('git show 427dfa4:src/produccion/js/ingredientes.js', {encoding: 'utf8'});
const start = output.indexOf('const sectoresContainer = document.getElementById');
console.log(output.substring(start, start + 1500));
