const http = require('http');

http.get('http://localhost:3002/api/produccion/mantenimiento/stock', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log("Response received. Length:", json.length);
            console.dir(json, { depth: null });
        } catch (e) {
            console.log("Error parsing json:", e.message);
            console.log("Raw response:", data);
        }
    });
}).on('error', (err) => {
    console.error("HTTP request error:", err.message);
});
