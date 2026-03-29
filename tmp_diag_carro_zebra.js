tch(`/api/produccion/carro/${carroId}/articulos-etiquetas`);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Error HTTP ${response.status}`);
        }

        const articulos = await response.json();

        // Imprimir etiquetas para cada artículo según su cantidad
        for (const articulo of articulos) {
            const imprimirResponse = await fetch('http://localhost:3000/api/imprimir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    articulo: {
                        numero: articulo.articulo_numero,
                        nombre: articulo.descripcion,
                        codigo_barras: articulo.codigo_barras
                    },
                    cantidad: articulo.cantidad
                })
            });

            if (!imprimirResponse.ok) {
                throw new Error(`Error al imprimir etiqueta para ${articulo.descripcion}`);
            }
        }

        // Mostrar notificación de éxito
        mostrarNotificacion('Etiquetas impresas correctamente');

    } catch (error) {
        console.error('Error al imprimir etiquetas:', error);
        mostrarNotificacion(`Error: ${error.message}`, true);
    } finally {
        // Restaurar el botón
        if (btnImprimirEtiquetas) {
            btnImprimirEtiquetas.disabled = false;
            btnImprimirEtiquetas.classList.remove('procesando');
            btnImprimirEtiquetas.textContent = 'Imprimir etiquetas';
        }
    }
}

// Hacer disponibles las funciones globalmente
window.marcarCarroPreparado = marcarCarroPreparado;
window.finalizarProduccion = finalizarProduccion;
window.asentarProduccion = finalizarProduccion; // Alias para compatibilidad
window.imprimirEtiquetasCarro = imprimi