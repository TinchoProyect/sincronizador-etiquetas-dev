const { Client } = require('pg');
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
        const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log(JSON.stringify(res.rows.map(r => r.table_name), null, 2));
    } catch(e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
main();
