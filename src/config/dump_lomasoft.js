require('dotenv').config({ path: '../.env' });
const fs = require('fs');

async function test() {
    const baseUrl = process.env.CLOUDFLARE_URL || "https://api.lamdaser.com";
    const url = `${baseUrl}/devoluciones?cliente=361`; 
    console.log("Fetching GET:", url);
    
    try {
        const res = await fetch(url, { headers: { 'Accept': 'application/json' }});
        const text = await res.text();
        fs.writeFileSync('C:\\tmp\\loma_361_full.json', text, 'utf8');
        console.log("Guardado en C:\\tmp\\loma_361_full.json. Length:", text.length);
    } catch(e) {
        console.error(e);
    }
}
test();
