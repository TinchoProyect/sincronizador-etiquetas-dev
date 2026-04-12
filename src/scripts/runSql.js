require("dotenv").config({ path: "process.env.NODE_ENV === 'production' ? '.env.production' : '.env'" });

async function test() {
    try {
        const pool = require("../produccion/config/database");
        
        // mnw063ln-cr9t4 belongs to client 1 (Emilio).
        // Let's pass it via presupuestos_ext_ids
        
        const checkRes = await fetch(`http://localhost:3000/api/produccion/validar-impresion?presupuestos_ext_ids=mnw063ln-cr9t4&fecha=2026-04-12`);
        const data = await checkRes.json();
        console.log("VALIDATE MULTIPLE RESPONSE:", data);
        
    } catch(e) {
        console.error(e.message);
    } finally {
        process.exit();
    }
}
test();
