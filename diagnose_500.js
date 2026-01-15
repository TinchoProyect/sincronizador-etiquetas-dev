const http = require('http');

const carroId = 1940;
const usuarioId = 1;
const url = `http://localhost:3002/api/produccion/carro/${carroId}/ingredientes?usuarioId=${usuarioId}`;

console.log(`Fetching: ${url}`);

http.get(url, (res) => {
    console.log(`Status: ${res.statusCode}`);
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log('Response Body:');
        console.log(data);
    });

}).on("error", (err) => {
    console.log("Error: " + err.message);
});
