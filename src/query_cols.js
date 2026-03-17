const { Client } = require('pg');
const fs = require('fs');
async function main() {
    const client = new Client({
        user: 'postgres',
        host: 'localhost',
        database: 'etiquetas',
        password: 'ta3Mionga',
        port: 5432
    });
    try {
        await client.connect();
        const res = await client.query("SELECT * FROM stock_real_consolidado LIMIT 1");
        fs.writeFileSync('cols.txt', Object.keys(res.rows[0]).join(', '));
    } catch(e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
main();
