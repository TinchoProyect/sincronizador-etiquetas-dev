const http = require('http');

http.get('http://localhost:3005/health', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log('Logistica Health check status code:', res.statusCode);
        console.log('Response body:');
        console.log(JSON.stringify(JSON.parse(data), null, 2));
        process.exit(0);
    });
}).on('error', (err) => {
    console.error('Logistica Health check failed:', err.message);
    process.exit(1);
});
