fetch('http://localhost:3002/api/produccion/buscar-articulos?q=ave')
    .then(r => r.json())
    .then(d => {
       console.log("CLAVES GLOBALES:", Object.keys(d));
       console.log("PRIMER ART KEYS:", d.articulos ? Object.keys(d.articulos[0]) : "No articulos");
       console.log("EJEMPLO ART[0]:", d.articulos ? d.articulos[0] : null);
    })
    .catch(console.error);
