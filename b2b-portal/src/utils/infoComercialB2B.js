// filepath: b2b-portal/src/utils/infoComercialB2B.js
import { supabase } from '../supabaseClient';
import { fetchPoliticaB2B, fetchOfertasB2B } from './politicasB2B';

let cachedInfoComercial = null;
let cachedClienteKey = null;

/**
 * Consulta dinámica y universal de la información comercial de cualquier cliente
 * (Ofertas activas de producto, política de volumen con saldo, formas de pago y 4 ventanas)
 */
export async function fetchInfoComercialCliente(profile) {
  if (!profile || !profile.cliente_id) return null;

  const clienteKey = String(profile.cliente_id).trim();
  if (cachedInfoComercial && cachedClienteKey === clienteKey) {
    return cachedInfoComercial;
  }

  const encodedId = encodeURIComponent(clienteKey);
  const endpoints = [
    `/api/presupuestos/portal/info-comercial/${encodedId}`,
    `http://localhost:3000/api/presupuestos/portal/info-comercial/${encodedId}`,
    `http://localhost:3003/api/presupuestos/portal/info-comercial/${encodedId}`
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          cachedInfoComercial = json.data;
          cachedClienteKey = clienteKey;
          console.log(`✅ [INFO-COMERCIAL] Datos comerciales cargados dinámicamente para ${clienteKey}:`, json.data);
          return json.data;
        }
      }
    } catch (e) {
      // Intentar con el siguiente endpoint de fallback
    }
  }

  // Si los endpoints locales no están disponibles (ej. portal en Cloudflare remoto),
  // consultar dinámicamente Supabase Cloud para verificar si este cliente o su lista tienen política u ofertas
  let politicaCloud = null;
  let promosCloud = [];
  try {
    const [polRes, ofrRes] = await Promise.all([
      fetchPoliticaB2B(profile),
      fetchOfertasB2B(profile)
    ]);

    if (polRes) {
      const primerTramo = polRes.tramos?.[0];
      politicaCloud = {
        nombre: polRes.nombre || 'Bonificación por Volumen',
        aplica_sobre: polRes.aplica_sobre || 'NETO',
        exige_saldo_cero: polRes.exige_saldo_cero !== false,
        tolerancia_saldo: parseFloat(polRes.tolerancia_saldo || primerTramo?.tolerancia_saldo) || 500.00,
        saldo_cuenta_corriente: parseFloat(polRes.saldo_cliente || profile.saldo || 0),
        tramos: (polRes.tramos || []).map(t => ({
          monto_minimo: String(t.monto_minimo || '300000.00'),
          descuento_porcentaje: String(t.descuento_porcentaje || '5.00'),
          etiqueta: t.etiqueta || `Supera $${parseFloat(t.monto_minimo || 300000).toLocaleString('es-AR')}`
        }))
      };
    }

    if (ofrRes && Object.keys(ofrRes).length > 0) {
      promosCloud = Object.values(ofrRes).map(o => ({
        titulo: o.titulo || 'Oferta Especial',
        descripcion: o.descripcion || '',
        descuento_porcentaje: o.descuento_porcentaje || 5,
        cuota_disponible: o.cuota_disponible || 0,
        unidad_cuota: o.unidad_cuota || 'KILOS',
        fecha_fin: o.fecha_fin || null
      }));
    }
  } catch (errCloud) {
    console.warn('⚠️ [INFO-COMERCIAL] Error consultando políticas/ofertas en Supabase:', errCloud);
  }

  // Fallback seguro: Si el cliente NO tiene políticas ni ofertas activas, son estrictamente null / []
  const fallbackResult = {
    cliente: {
      codigo_bunker_cliente: clienteKey,
      cliente_nombre: profile.nombre_empresa || profile.nombre_completo || 'Cliente',
      razon_social: profile.nombre_empresa || '',
      lista_id: Array.isArray(profile.listas_precios) && profile.listas_precios[0] ? String(profile.listas_precios[0]) : null
    },
    promos: promosCloud,
    politica_comercial: politicaCloud, // NULL si el cliente no tiene política asignada
    formas_pago: {
      banco: {
        nombre: 'Banco Galicia',
        alias: 'LAMDA.SER.MARTIN'
      },
      ensobrado: {
        titulo: 'Ensobrado (Servicio LAMDA)',
        canales: [
          'Portal de Clientes LAMDA (función Pagos en Efectivo / Ensobrado)',
          'Enlace Móvil por WhatsApp (asistente interactivo sin claves para celular)'
        ],
        instruccion: 'Anota el monto, el sistema asiste el conteo y arqueo de billetes, se rotula el sobre con el N° asignado (ej: SOB-XXXX), cliente e importe, se cargan 2 fotos (frente y dorso) y al finalizar envía confirmación automática por WhatsApp. Queda listo para entregar al chofer o en depósito.'
      },
      cajero: {
        titulo: 'Cajeros y Terminales Autoservicio Galicia',
        cuenta: 'Caja de Ahorro 4007844-1 373-4',
        titular: 'Martin Ignacio Serrano',
        disponibilidad: 'Lobbies 24 hs habilitados todos los días',
        sucursales_la_plata: [
          'La Plata Centro: Calle 7 N° 875 (e/ 49 y 50) • Calle 13 N° 665 (Plaza Paso) • Av. 7 N° 59 (Plaza Olazábal)',
          'Los Hornos / Acceso Sur: Av. 44 N° 1724 (esq. 29)',
          'City Bell / Gonnet: Plaza Gral. Belgrano N° 57/63 (City Bell)'
        ]
      }
    },
    politica_intereses: {
      habilitado: true,
      dias_ventana_estandar: 7,
      dias_gracia_natural: 3,
      dias_tope_sin_comodin: 10,
      dias_ventana_cortesia: 7,
      dias_total_cortesia: 14,
      cupo_cortesias_anual: 3,
      cortesias_usadas_anio: 0,
      cortesias_disponibles_anio: 3,
      cortesias_restantes_anio: 3,
      tasa_servicio_financiero: 3.0,
      tasa_tem: 3.0,
      tasa_diaria: 0.001,
      iva_porcentaje: 21,
      modo_sistema: 'SOMBRA'
    }
  };

  cachedInfoComercial = fallbackResult;
  cachedClienteKey = clienteKey;
  return fallbackResult;
}
