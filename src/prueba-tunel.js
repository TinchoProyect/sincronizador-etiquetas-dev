const ngrok = require('ngrok');

(async function() {
  try {
    console.log("Intentando abrir el túnel...");
    
    // Conectamos usando tu token y el puerto 3005
    const url = await ngrok.connect({
      proto: 'http',
      addr: 3005,
      authtoken: 'TU_TOKEN_AQUI_PEGALO_ACA_SIN_BORRAR_LAS_COMILLAS',
    });

    console.log("¡ÉXITO! El túnel se abrió.");
    console.log("La dirección pública es: " + url);
    console.log("Ahora prueba entrar a esa dirección desde tu celular.");

  } catch (error) {
    console.error("FALLÓ LA CONEXIÓN:");
    console.error(error);
  }
})();