import React, { useState, useEffect, useMemo } from 'react';
import { supabaseAnonimaPublica } from '../supabaseClient';
import { 
  Store, Search, ShoppingBag, Plus, Minus, Trash2, CheckCircle2, 
  AlertCircle, Loader2, Send, ArrowLeft, FileText, Check, Sparkles,
  ChevronDown, ChevronRight, X, Info, Star, Settings, Smartphone,
  Lock, Share2, Copy, MessageSquare
} from 'lucide-react';
import Swal from 'sweetalert2';
import { evaluarPoliticaB2B } from '../utils/politicasB2B';
import { InspeccionPartidaModal, fetchMapaFotosLotesB2B } from '../components/InspeccionPartidaModal';

const DEVICE_SECRET_STORAGE_KEY = 'b2b_colab_device_secret';

function obtenerOCrearDeviceSecret() {
  try {
    let secret = localStorage.getItem(DEVICE_SECRET_STORAGE_KEY);
    if (!secret || secret.length < 16) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      secret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(DEVICE_SECRET_STORAGE_KEY, secret);
    }
    return secret;
  } catch {
    return 'fallback-device-secret';
  }
}

function generarTokenHex(bytesLen = 16) {
  try {
    const bytes = new Uint8Array(bytesLen);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Date.now().toString(16) + Math.random().toString(16).slice(2);
  }
}

export default function PrePedidoPublico({ path }) {
  // Extraer parámetros de la URL (soporta ?token=... para armado y ?revisar=... para aprobación)
  const extraerParametrosUrl = () => {
    const hash = window.location.hash || '';
    const pathname = window.location.pathname || '';
    const search = window.location.search || '';

    const paramsSearch = new URLSearchParams(search);
    const hashSearch = hash.includes('?') ? hash.split('?')[1] : '';
    const paramsHash = new URLSearchParams(hashSearch);

    const revisar = (paramsHash.get('revisar') || paramsSearch.get('revisar') || '').trim();
    if (revisar) {
      return { modo: 'aprobacion', token: '', tokenRevisar: revisar };
    }

    let tok = (paramsHash.get('token') || paramsSearch.get('token') || '').trim();
    if (!tok) {
      const matchHash = hash.match(/pre-pedido[\/]+([a-zA-Z0-9_\-]+)/i);
      if (matchHash && matchHash[1]) tok = matchHash[1].trim();
    }
    if (!tok) {
      const matchPath = pathname.match(/pre-pedido[\/]+([a-zA-Z0-9_\-]+)/i);
      if (matchPath && matchPath[1]) tok = matchPath[1].trim();
    }

    return { modo: 'armado', token: tok, tokenRevisar: '' };
  };

  const { modo, token, tokenRevisar } = extraerParametrosUrl();

  const [loading, setLoading] = useState(true);
  const [delegacion, setDelegacion] = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  // Estados de candado de dispositivo (Modo Armado)
  const [requiereValidacionTelefono, setRequiereValidacionTelefono] = useState(false);
  const [telefonoMascara, setTelefonoMascara] = useState('');
  const [infoPreviaDelegacion, setInfoPreviaDelegacion] = useState(null);
  const [inputUltimosDigitos, setInputUltimosDigitos] = useState('');
  const [validandoTelefono, setValidandoTelefono] = useState(false);
  const [errorValidacionTelefono, setErrorValidacionTelefono] = useState('');
  const [bloqueadoOtroDispositivo, setBloqueadoOtroDispositivo] = useState(false);

  // Estados de Modo Aprobación (?revisar=...)
  const [prepedidoRevision, setPrepedidoRevision] = useState(null);
  const [mostrarCatalogoEnRevision, setMostrarCatalogoEnRevision] = useState(false);
  const [observacionesAprobador, setObservacionesAprobador] = useState('');
  const [pedidoConfirmadoInfo, setPedidoConfirmadoInfo] = useState(null);

  // Estados de Catálogo: Favoritos, Ofertas, Políticas Comerciales e IVA
  const [articulosHabituales, setArticulosHabituales] = useState(() => new Map());
  const [filtroFavoritos, setFiltroFavoritos] = useState(false);
  const [filtroOfertas, setFiltroOfertas] = useState(false);
  const [isOfertasOpen, setIsOfertasOpen] = useState(false);
  const [ofertasActivas, setOfertasActivas] = useState({});
  const [politicaComercial, setPoliticaComercial] = useState(null);
  const [mostrarSinIva, setMostrarSinIva] = useState(false);
  const [showIvaModal, setShowIvaModal] = useState(false);

  // Búsqueda y filtrado
  const [search, setSearch] = useState('');
  const [showSearchHelp, setShowSearchHelp] = useState(false);

  // Estados para acordeones jerárquicos (5 niveles idénticos a Articulos.jsx)
  const [expandedFamilias, setExpandedFamilias] = useState(() => new Set());
  const [expandedAtributos, setExpandedAtributos] = useState(() => new Set());
  const [expandedSubcategorias, setExpandedSubcategorias] = useState(() => new Set());
  const [expandedSubSubcategorias, setExpandedSubSubcategorias] = useState(() => new Set());
  const [expandedSubSubSubcategorias, setExpandedSubSubSubcategorias] = useState(() => new Set());

  // Carrito de selección (clave: producto_codigo -> { producto, cantidad })
  const [selectedItems, setSelectedItems] = useState({});
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [notaColaborador, setNotaColaborador] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [completadoExitoso, setCompletadoExitoso] = useState(false);
  const [datosEnvioCompletado, setDatosEnvioCompletado] = useState(null);
  const [mapaFotosLotes, setMapaFotosLotes] = useState({});
  const [modalPartidaCtx, setModalPartidaCtx] = useState(null);

  useEffect(() => {
    fetchMapaFotosLotesB2B().then(mapa => setMapaFotosLotes(mapa || {}));
    if (modo === 'aprobacion') {
      if (!tokenRevisar) {
        setLoading(false);
        setErrorMsg('No se proporcionó un código de revisión válido.');
        return;
      }
      cargarPrepedidoParaAprobacion(tokenRevisar);
    } else {
      if (!token) {
        setLoading(false);
        setErrorMsg('No se proporcionó un código o enlace de acceso válido.');
        return;
      }
      verificarYVincularDelegacion(token, null);
    }
  }, [modo, token, tokenRevisar]);

  // Cargar datos complementarios del catálogo (precios, ofertas, políticas, habituales)
  const cargarDatosCatalogoCliente = async (clienteId, listasIds, configDelegacion) => {
    // 1. Catálogo de precios
    let query = supabaseAnonimaPublica
      .from('clientes_b2b_catalogo_precios')
      .select('producto_codigo, producto_descripcion, precio_final, kilos_unidad, precio_kilo, iva_porcentaje, precio_neto, precio_kilo_neto, rubro, sub_rubro, familia, articulo_principal, sub_categoria, sub_sub_categoria, sub_sub_sub_categoria, stock_disponible, stock_estado, busqueda_metadata, lista_id')
      .order('producto_descripcion', { ascending: true });

    if (Array.isArray(listasIds) && listasIds.length > 0) {
      query = query.in('lista_id', listasIds);
    }

    let { data: catData, error: catErr } = await query;
    if (catErr && catErr.message && catErr.message.includes('stock_estado')) {
      let fbQuery = supabaseAnonimaPublica
        .from('clientes_b2b_catalogo_precios')
        .select('producto_codigo, producto_descripcion, precio_final, kilos_unidad, precio_kilo, iva_porcentaje, precio_neto, precio_kilo_neto, rubro, sub_rubro, familia, articulo_principal, sub_categoria, sub_sub_categoria, sub_sub_sub_categoria, stock_disponible, busqueda_metadata, lista_id')
        .order('producto_descripcion', { ascending: true });
      if (Array.isArray(listasIds) && listasIds.length > 0) {
        fbQuery = fbQuery.in('lista_id', listasIds);
      }
      const fbRes = await fbQuery;
      catData = fbRes.data;
      catErr = fbRes.error;
    }
    if (catErr) throw catErr;

    // Deduplicar productos por código y consolidar stock
    const mapProds = new Map();
    for (const item of catData || []) {
      const existing = mapProds.get(item.producto_codigo);
      if (!existing) {
        mapProds.set(item.producto_codigo, { ...item });
      } else {
        const exStock = parseFloat(existing.stock_disponible || 0);
        const itStock = parseFloat(item.stock_disponible || 0);
        if (exStock > 0 || itStock > 0) {
          existing.stock_disponible = Math.max(Math.max(0, exStock), Math.max(0, itStock));
          existing.stock_estado = 'disponible';
        } else if (exStock < 0 || itStock < 0) {
          existing.stock_disponible = -Math.max(Math.abs(exStock), Math.abs(itStock));
          existing.stock_estado = 'requiere_produccion';
        }
      }
    }
    const listaCatalogo = Array.from(mapProds.values());
    setCatalogo(listaCatalogo);

    // 2. Artículos habituales / favoritos
    try {
      const { data: habData, error: habErr } = await supabaseAnonimaPublica
        .from('clientes_b2b_articulos_habituales')
        .select('producto_codigo, frecuencia_compra, ultima_compra')
        .eq('cliente_id', clienteId);

      if (!habErr && Array.isArray(habData)) {
        const habMap = new Map();
        for (const h of habData) {
          const cleanCod = (h.producto_codigo || '').toLowerCase().trim();
          if (cleanCod) {
            habMap.set(cleanCod, {
              frecuencia: h.frecuencia_compra || 1,
              ultima_compra: h.ultima_compra
            });
          }
        }
        setArticulosHabituales(habMap);
      }
    } catch (habEx) {
      console.warn('Advertencia al cargar habituales:', habEx.message);
    }

    // 3. Ofertas dinámicas activas
    if (Array.isArray(listasIds) && listasIds.length > 0) {
      try {
        const { data: ofrData, error: ofrErr } = await supabaseAnonimaPublica
          .from('clientes_b2b_ofertas_activas')
          .select('*')
          .eq('activo', true)
          .eq('estado', 'ACTIVA')
          .gt('cuota_disponible', 0);

        if (!ofrErr && Array.isArray(ofrData)) {
          const mapaOfertas = {};
          const clienteIdStr = String(clienteId || '').trim().toUpperCase();
          for (const ofr of ofrData) {
            const aplicaLista = Array.isArray(ofr.listas_ids) && ofr.listas_ids.some(lid => listasIds.includes(lid));
            if (!aplicaLista) continue;

            if (Array.isArray(ofr.excepciones)) {
              const exc = ofr.excepciones.find(e => {
                const eId = String(e.cliente_id || '').trim().toUpperCase();
                const eCode = String(e.codigo_bunker_cliente || '').trim().toUpperCase();
                return eId === clienteIdStr || eCode === clienteIdStr;
              });
              if (exc && exc.tipo_excepcion === 'EXCLUIDO') continue;
            }

            for (const art of ofr.articulos || []) {
              mapaOfertas[art.articulo_numero] = {
                oferta_id: ofr.oferta_id,
                titulo: ofr.titulo,
                descripcion: ofr.descripcion,
                descuento_porcentaje: parseFloat(ofr.descuento_porcentaje) || 5.0,
                cuota_disponible: parseFloat(ofr.cuota_disponible) || 0,
                condicion_cierre: ofr.condicion_cierre,
                fecha_fin: ofr.fecha_fin,
                unidad_cuota: ofr.unidad_cuota,
                factor_conversion_cuota: parseFloat(art.factor_conversion_cuota) || 1.0,
                precio_fijo_oferta: art.precio_fijo_oferta ? parseFloat(art.precio_fijo_oferta) : null
              };
            }
          }
          setOfertasActivas(mapaOfertas);
        }
      } catch (ofrEx) {
        console.warn('Advertencia al cargar ofertas:', ofrEx.message);
      }

      // 4. Política comercial por volumen (sin bloqueo por saldo en vista de pre-armado)
      try {
        const { data: polData, error: polErr } = await supabaseAnonimaPublica
          .from('clientes_b2b_politicas_comerciales')
          .select('*')
          .eq('activo', true)
          .in('lista_id', listasIds);

        if (!polErr && Array.isArray(polData) && polData.length > 0) {
          setPoliticaComercial({
            ...polData[0],
            exige_saldo_cero: false,
            saldo_cliente: 0
          });
        }
      } catch (polEx) {
        console.warn('Advertencia al cargar política comercial:', polEx.message);
      }
    }

    if (configDelegacion) {
      setMostrarSinIva(Boolean(configDelegacion.mostrar_sin_iva));
    }

    return listaCatalogo;
  };

  // MODO ARMADO: Validar y vincular dispositivo del colaborador
  const verificarYVincularDelegacion = async (tok, digitosIngresados = null) => {
    try {
      if (digitosIngresados !== null) {
        setValidandoTelefono(true);
        setErrorValidacionTelefono('');
      } else {
        setLoading(true);
        setErrorMsg('');
      }

      const deviceSecret = obtenerOCrearDeviceSecret();

      const { data: rpcRes, error: rpcErr } = await supabaseAnonimaPublica.rpc(
        'validar_y_vincular_delegacion_b2b',
        {
          p_token: tok,
          p_ultimos_digitos: digitosIngresados ? String(digitosIngresados).trim() : null,
          p_device_secret: deviceSecret
        }
      );

      if (rpcErr) {
        throw new Error(rpcErr.message || 'No se pudo validar el enlace.');
      }

      if (!rpcRes || !rpcRes.success) {
        if (rpcRes?.vinculado_otro_dispositivo) {
          setBloqueadoOtroDispositivo(true);
          setErrorMsg(rpcRes.error || 'Este enlace personal ya se encuentra vinculado a otro dispositivo móvil.');
          return;
        }

        if (rpcRes?.requiere_validacion_telefono) {
          setRequiereValidacionTelefono(true);
          setTelefonoMascara(rpcRes.telefono_mascara || '****');
          setInfoPreviaDelegacion({
            nombre_colaborador: rpcRes.nombre_colaborador || 'Colaborador',
            nombre_empresa: rpcRes.nombre_empresa || 'Comercio B2B'
          });
          if (digitosIngresados !== null) {
            setErrorValidacionTelefono(rpcRes.error || 'Los dígitos ingresados no coinciden.');
          }
          return;
        }

        throw new Error(rpcRes?.error || 'El enlace no se encuentra disponible.');
      }

      // Validación exitosa
      const delData = rpcRes.delegacion;
      setRequiereValidacionTelefono(false);
      setBloqueadoOtroDispositivo(false);
      setDelegacion(delData);

      await cargarDatosCatalogoCliente(delData.cliente_id, delData.listas_ids || [], delData);
    } catch (err) {
      console.error('Error al validar delegación:', err);
      setErrorMsg(err.message || 'Error al validar el enlace de acceso.');
    } finally {
      setLoading(false);
      setValidandoTelefono(false);
    }
  };

  // MODO APROBACIÓN: Cargar pre-pedido mediante token_aprobacion
  const cargarPrepedidoParaAprobacion = async (tokRev) => {
    try {
      setLoading(true);
      setErrorMsg('');

      const { data: rpcRes, error: rpcErr } = await supabaseAnonimaPublica.rpc(
        'obtener_prepedido_por_token_aprobacion',
        { p_token_aprobacion: tokRev }
      );

      if (rpcErr) throw new Error(rpcErr.message || 'Error al consultar el pre-pedido.');
      if (!rpcRes || !rpcRes.success || !rpcRes.prepedido) {
        throw new Error(rpcRes?.error || 'No se encontró el pre-pedido solicitado o el enlace es inválido.');
      }

      const prep = rpcRes.prepedido;
      setPrepedidoRevision(prep);

      const configDel = {
        id: prep.delegacion_id,
        cliente_id: prep.cliente_id,
        nombre_empresa: prep.nombre_empresa || 'Comercio B2B',
        nombre_colaborador: prep.colaborador_nombre || 'Colaborador',
        aprobador_nombre: prep.aprobador_nombre || 'Administración',
        mostrar_precios: true,
        mostrar_sin_iva: Boolean(prep.mostrar_sin_iva),
        permitir_toggle_iva: prep.permitir_toggle_iva !== false,
        ver_stock: prep.ver_stock !== false,
        listas_ids: prep.listas_ids || []
      };
      setDelegacion(configDel);

      const listaCatalogo = await cargarDatosCatalogoCliente(
        prep.cliente_id,
        prep.listas_ids || [],
        configDel
      );

      // Poblar los ítems seleccionados a partir del pre-pedido
      const mapCat = new Map();
      for (const prod of listaCatalogo || []) {
        mapCat.set((prod.producto_codigo || '').trim(), prod);
      }

      const initialSelected = {};
      for (const it of prep.items || []) {
        const cod = String(it.producto_codigo || '').trim();
        const cant = parseFloat(it.cantidad) || 0;
        if (!cod || cant <= 0) continue;

        const catProd = mapCat.get(cod);
        const precioUnit = parseFloat(it.precio_unitario) || (catProd ? parseFloat(catProd.precio_final || 0) : 0);

        initialSelected[cod] = {
          cantidad: cant,
          producto: catProd
            ? {
                ...catProd,
                precio_final: precioUnit > 0 ? precioUnit : catProd.precio_final,
                es_oferta: Boolean(it.es_oferta),
                oferta_id: it.oferta_id || null,
                oferta_titulo: it.oferta_titulo || null,
                descuento_porcentaje: it.descuento_porcentaje || 0
              }
            : {
                producto_codigo: cod,
                producto_descripcion: it.producto_descripcion || cod,
                precio_final: precioUnit,
                kilos_unidad: parseFloat(it.kilos_unidad) || 1,
                iva_porcentaje: 21,
                es_oferta: Boolean(it.es_oferta),
                descuento_porcentaje: it.descuento_porcentaje || 0
              }
        };
      }
      setSelectedItems(initialSelected);

      if (prep.estado === 'incorporado' || prep.estado === 'confirmado' || prep.pedido_confirmado_id) {
        setPedidoConfirmadoInfo({
          pedido_id: prep.pedido_confirmado_id,
          confirmado_en: prep.confirmado_en
        });
      }
    } catch (err) {
      console.error('Error cargando pre-pedido para aprobación:', err);
      setErrorMsg(err.message || 'No se pudo cargar el pre-pedido para revisión.');
    } finally {
      setLoading(false);
    }
  };

  // Normalizadores jerárquicos
  const getNormalizedFamilia = (product) => {
    const f = product.familia?.trim() || product.rubro?.trim();
    return f && f !== '' ? f : 'General';
  };

  const getNormalizedAtributoPrincipal = (product) => {
    const ap = product.articulo_principal?.trim() || product.sub_rubro?.trim() || product.producto_descripcion?.trim();
    return ap && ap !== '' ? ap : 'General';
  };

  const sortProductsByKilos = (prods) => {
    return [...prods].sort((a, b) => {
      const kA = parseFloat(a.kilos_unidad || 0);
      const kB = parseFloat(b.kilos_unidad || 0);
      if (kB !== kA) return kB - kA;
      return (a.producto_descripcion || '').localeCompare(b.producto_descripcion || '', 'es');
    });
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val || 0);
  };

  const searchTerms = useMemo(() => {
    return search
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/)
      .filter(Boolean);
  }, [search]);

  const articulosEnOferta = useMemo(() => {
    if (!ofertasActivas || Object.keys(ofertasActivas).length === 0) return [];
    return catalogo.filter(p => {
      const cod = (p.producto_codigo || '').trim();
      return !!ofertasActivas[cod];
    });
  }, [catalogo, ofertasActivas]);

  const resumenOfertasActivas = useMemo(() => {
    const map = new Map();
    Object.values(ofertasActivas || {}).forEach(ofr => {
      if (ofr && ofr.oferta_id && !map.has(ofr.oferta_id)) {
        map.set(ofr.oferta_id, ofr);
      }
    });
    return Array.from(map.values());
  }, [ofertasActivas]);

  const toggleFiltroFavoritos = () => {
    if (!filtroFavoritos && articulosHabituales.size === 0) {
      Swal.fire({
        title: 'Sin Compras Previas',
        text: 'Aún no se registra un historial de compras para sugerir artículos habituales en este comercio.',
        icon: 'info',
        confirmButtonColor: '#8e4785',
        confirmButtonText: 'Entendido'
      });
      return;
    }
    setFiltroFavoritos(prev => !prev);
  };

  // Filtrado de productos (Búsqueda Universal LAMDA + Favoritos + Ofertas)
  const filteredProducts = useMemo(() => {
    return catalogo.filter(product => {
      const cleanCodExact = (product.producto_codigo || '').trim();
      const cleanCodLower = cleanCodExact.toLowerCase();

      if (filtroFavoritos && !articulosHabituales.has(cleanCodLower)) {
        return false;
      }

      if (filtroOfertas && !ofertasActivas[cleanCodExact]) {
        return false;
      }

      if (searchTerms.length > 0) {
        const textParts = [
          product.producto_descripcion || '',
          product.producto_codigo || '',
          product.familia || '',
          product.articulo_principal || '',
          product.sub_categoria || '',
          product.sub_sub_categoria || '',
          product.sub_sub_sub_categoria || '',
          product.rubro || '',
          product.sub_rubro || '',
          product.busqueda_metadata || ''
        ];

        const fullSearchableText = textParts
          .join(' ')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');

        const matchesAllTerms = searchTerms.every(term => fullSearchableText.includes(term));
        if (!matchesAllTerms) return false;
      }
      return true;
    });
  }, [catalogo, searchTerms, filtroFavoritos, filtroOfertas, articulosHabituales, ofertasActivas]);

  const ofertasVisiblesEnSolapa = useMemo(() => {
    if (!ofertasActivas || Object.keys(ofertasActivas).length === 0) return [];
    return sortProductsByKilos(
      filteredProducts.filter(p => !!ofertasActivas[(p.producto_codigo || '').trim()])
    );
  }, [filteredProducts, ofertasActivas]);

  // Agrupamiento Jerárquico en 5 Niveles (Idéntico a Articulos.jsx)
  const hierarchicalData = useMemo(() => {
    const famMap = new Map();

    for (const product of filteredProducts) {
      const famName = getNormalizedFamilia(product);
      const famKey = famName.toLowerCase().trim();
      const atName = getNormalizedAtributoPrincipal(product);
      const atKey = atName.toLowerCase().trim();

      if (!famMap.has(famKey)) {
        famMap.set(famKey, { nombre: famName, atMap: new Map() });
      }
      const famObj = famMap.get(famKey);
      if (!famObj.atMap.has(atKey)) {
        famObj.atMap.set(atKey, { nombre: atName, prods: [] });
      }
      famObj.atMap.get(atKey).prods.push(product);
    }

    return Array.from(famMap.values())
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
      .map(({ nombre: famName, atMap }) => {
        const atributosList = Array.from(atMap.values())
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
          .map(({ nombre: atName, prods }) => {
            const subMap = new Map();
            let hasSubcategorias = false;

            for (const p of prods) {
              const subCat = p.sub_categoria?.trim();
              if (subCat && subCat !== '') {
                hasSubcategorias = true;
                const subKey = subCat.toLowerCase();
                if (!subMap.has(subKey)) {
                  subMap.set(subKey, { nombre: subCat, subProds: [] });
                }
                subMap.get(subKey).subProds.push(p);
              }
            }

            let subcategoriasList = [];
            if (hasSubcategorias) {
              const sinSub = prods.filter(p => !p.sub_categoria || p.sub_categoria.trim() === '');
              if (sinSub.length > 0) {
                subMap.set('general', { nombre: 'General', subProds: sinSub });
              }

              subcategoriasList = Array.from(subMap.values())
                .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
                .map(({ nombre: subName, subProds }) => {
                  const subSubMap = new Map();
                  let hasSubSubcategorias = false;

                  for (const sp of subProds) {
                    const subSubCat = sp.sub_sub_categoria?.trim();
                    if (subSubCat && subSubCat !== '') {
                      hasSubSubcategorias = true;
                      const subSubKey = subSubCat.toLowerCase();
                      if (!subSubMap.has(subSubKey)) {
                        subSubMap.set(subSubKey, { nombre: subSubCat, subSubProds: [] });
                      }
                      subSubMap.get(subSubKey).subSubProds.push(sp);
                    }
                  }

                  let subSubcategoriasList = [];
                  if (hasSubSubcategorias) {
                    const sinSubSub = subProds.filter(p => !p.sub_sub_categoria || p.sub_sub_categoria.trim() === '');
                    if (sinSubSub.length > 0) {
                      subSubMap.set('general', { nombre: 'General', subSubProds: sinSubSub });
                    }

                    subSubcategoriasList = Array.from(subSubMap.values())
                      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
                      .map(({ nombre: subSubName, subSubProds }) => {
                        const subSubSubMap = new Map();
                        let hasSubSubSubcategorias = false;

                        for (const ssp of subSubProds) {
                          const subSubSubCat = ssp.sub_sub_sub_categoria?.trim();
                          if (subSubSubCat && subSubSubCat !== '') {
                            hasSubSubSubcategorias = true;
                            const subSubSubKey = subSubSubCat.toLowerCase();
                            if (!subSubSubMap.has(subSubSubKey)) {
                              subSubSubMap.set(subSubSubKey, { nombre: subSubSubCat, subSubSubProds: [] });
                            }
                            subSubSubMap.get(subSubSubKey).subSubSubProds.push(ssp);
                          }
                        }

                        let subSubSubcategoriasList = [];
                        if (hasSubSubSubcategorias) {
                          const sinSubSubSub = subSubProds.filter(p => !p.sub_sub_sub_categoria || p.sub_sub_sub_categoria.trim() === '');
                          if (sinSubSubSub.length > 0) {
                            subSubSubMap.set('general', { nombre: 'General', subSubSubProds: sinSubSubSub });
                          }

                          subSubSubcategoriasList = Array.from(subSubSubMap.values())
                            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
                            .map(({ nombre: subSubSubName, subSubSubProds }) => ({
                              nombre: subSubSubName,
                              key: `${famName.toLowerCase()}___${atName.toLowerCase()}___${subName.toLowerCase()}___${subSubName.toLowerCase()}___${subSubSubName.toLowerCase()}`,
                              productos: sortProductsByKilos(subSubSubProds)
                            }));
                        }

                        return {
                          nombre: subSubName,
                          key: `${famName.toLowerCase()}___${atName.toLowerCase()}___${subName.toLowerCase()}___${subSubName.toLowerCase()}`,
                          hasSubSubSubcategorias: hasSubSubSubcategorias,
                          subSubSubcategorias: subSubSubcategoriasList,
                          productos: sortProductsByKilos(subSubProds)
                        };
                      });
                  }

                  return {
                    nombre: subName,
                    key: `${famName.toLowerCase()}___${atName.toLowerCase()}___${subName.toLowerCase()}`,
                    hasSubSubcategorias: hasSubSubcategorias,
                    subSubcategorias: subSubcategoriasList,
                    productos: sortProductsByKilos(subProds)
                  };
                });
            }

            return {
              nombre: atName,
              key: `${famName.toLowerCase()}___${atName.toLowerCase()}`,
              hasSubcategorias: hasSubcategorias,
              subcategorias: subcategoriasList,
              productos: sortProductsByKilos(prods)
            };
          });

        const totalProds = atributosList.reduce((acc, at) => acc + at.productos.length, 0);

        return {
          nombre: famName,
          key: famName.toLowerCase(),
          totalProductos: totalProds,
          atributos: atributosList
        };
      });
  }, [filteredProducts]);

  // Manejo de acordeones
  const toggleFamilia = (famKey) => {
    setExpandedFamilias(prev => {
      const next = new Set(prev);
      if (next.has(famKey)) next.delete(famKey);
      else next.add(famKey);
      return next;
    });
  };

  const toggleAtributo = (atKey) => {
    setExpandedAtributos(prev => {
      const next = new Set(prev);
      if (next.has(atKey)) next.delete(atKey);
      else next.add(atKey);
      return next;
    });
  };

  const toggleSubcategoria = (subKey) => {
    setExpandedSubcategorias(prev => {
      const next = new Set(prev);
      if (next.has(subKey)) next.delete(subKey);
      else next.add(subKey);
      return next;
    });
  };

  const toggleSubSubcategoria = (subSubKey) => {
    setExpandedSubSubcategorias(prev => {
      const next = new Set(prev);
      if (next.has(subSubKey)) next.delete(subSubKey);
      else next.add(subSubKey);
      return next;
    });
  };

  const toggleSubSubSubcategoria = (subSubSubKey) => {
    setExpandedSubSubSubcategorias(prev => {
      const next = new Set(prev);
      if (next.has(subSubSubKey)) next.delete(subSubSubKey);
      else next.add(subSubSubKey);
      return next;
    });
  };

  useEffect(() => {
    if ((searchTerms.length > 0 || filtroFavoritos || filtroOfertas) && hierarchicalData.length > 0) {
      const allFamKeys = new Set(hierarchicalData.map(f => f.key));
      const allAtKeys = new Set();
      const allSubKeys = new Set();
      const allSubSubKeys = new Set();
      const allSubSubSubKeys = new Set();

      hierarchicalData.forEach(f => {
        f.atributos.forEach(at => {
          allAtKeys.add(at.key);
          if (at.hasSubcategorias) {
            at.subcategorias.forEach(sub => {
              allSubKeys.add(sub.key);
              if (sub.hasSubSubcategorias) {
                sub.subSubcategorias.forEach(ss => {
                  allSubSubKeys.add(ss.key);
                  if (ss.hasSubSubSubcategorias) {
                    ss.subSubSubcategorias.forEach(sss => {
                      allSubSubSubKeys.add(sss.key);
                    });
                  }
                });
              }
            });
          }
        });
      });

      setExpandedFamilias(allFamKeys);
      setExpandedAtributos(allAtKeys);
      setExpandedSubcategorias(allSubKeys);
      setExpandedSubSubcategorias(allSubSubKeys);
      setExpandedSubSubSubcategorias(allSubSubSubKeys);
    }
  }, [searchTerms, filtroFavoritos, filtroOfertas, hierarchicalData]);

  // Calcular precio efectivo de un producto contemplando ofertas activas
  const obtenerProductoConOferta = (product) => {
    const codExacto = (product.producto_codigo || '').trim();
    const ofertaActiva = ofertasActivas[codExacto] || null;
    if (!ofertaActiva) return product;

    const descOfertaPct = parseFloat(ofertaActiva.descuento_porcentaje) || 5;
    const precioBaseConIva = parseFloat(product.precio_final || 0);
    const ivaPorcentaje = parseFloat(product.iva_porcentaje) || 21.0;

    const precioOfertaConIva = ofertaActiva.precio_fijo_oferta
      ? parseFloat(ofertaActiva.precio_fijo_oferta)
      : Math.round(precioBaseConIva * (1 - descOfertaPct / 100) * 100) / 100;

    const precioOfertaNeto = Math.round((precioOfertaConIva / (1 + (ivaPorcentaje / 100))) * 100) / 100;

    return {
      ...product,
      precio_final_original: precioBaseConIva,
      precio_final: precioOfertaConIva,
      precio_neto: precioOfertaNeto,
      es_oferta: true,
      oferta_id: ofertaActiva.oferta_id,
      oferta_titulo: ofertaActiva.titulo,
      descuento_porcentaje: descOfertaPct
    };
  };

  // Manejo de cantidades seleccionadas
  const cambiarCantidad = (productoRaw, delta) => {
    const producto = obtenerProductoConOferta(productoRaw);
    const cod = (producto.producto_codigo || '').trim();
    setSelectedItems(prev => {
      const actual = prev[cod] ? prev[cod].cantidad : 0;
      const nueva = Math.max(0, actual + delta);

      if (nueva === 0) {
        const next = { ...prev };
        delete next[cod];
        return next;
      }

      return {
        ...prev,
        [cod]: {
          producto,
          cantidad: nueva
        }
      };
    });
  };

  const eliminarItemSeleccionado = (cod) => {
    setSelectedItems(prev => {
      const next = { ...prev };
      delete next[cod];
      return next;
    });
  };

  const itemsArray = Object.values(selectedItems);
  const totalArticulosDiferentes = itemsArray.length;
  const totalUnidades = itemsArray.reduce((acc, i) => acc + i.cantidad, 0);

  // Carrito normalizado para evaluación de política comercial por volumen
  const cartParaPolitica = useMemo(() => {
    return itemsArray.map(it => {
      const p = parseFloat(it.producto.precio_final || 0);
      return {
        producto_codigo: it.producto.producto_codigo,
        producto_descripcion: it.producto.producto_descripcion,
        cantidad: it.cantidad,
        precio_unitario: p,
        subtotal: p * it.cantidad,
        iva_porcentaje: parseFloat(it.producto.iva_porcentaje || 21),
        es_oferta: Boolean(it.producto.es_oferta)
      };
    });
  }, [itemsArray]);

  const politicaEval = useMemo(() => {
    return evaluarPoliticaB2B(politicaComercial, cartParaPolitica, {
      cliente_id: delegacion?.cliente_id
    });
  }, [politicaComercial, cartParaPolitica, delegacion?.cliente_id]);

  const canViewStock = Boolean(delegacion?.ver_stock !== false);
  const canToggleIva = Boolean(delegacion?.mostrar_precios && delegacion?.permitir_toggle_iva !== false);

  // Renderizador de Ficha de Producto (idéntico a Articulos.jsx)
  const renderProductCard = (product) => {
    const cod = (product.producto_codigo || '').trim();
    const sel = selectedItems[cod];
    const currentQty = sel ? sel.cantidad : 0;
    const kilosUnidad = parseFloat(product.kilos_unidad) || 1.0;
    const ivaPorcentaje = parseFloat(product.iva_porcentaje) || 21.0;

    const precioBultoConIva = parseFloat(product.precio_final || 0);
    const precioKiloConIva = parseFloat(product.precio_kilo || 0) > 0 ? parseFloat(product.precio_kilo) : precioBultoConIva;

    const precioBultoNeto = product.precio_neto !== null && product.precio_neto !== undefined 
      ? parseFloat(product.precio_neto) 
      : Math.round((precioBultoConIva / (1 + (ivaPorcentaje / 100))) * 100) / 100;

    const precioKiloNeto = product.precio_kilo_neto !== null && product.precio_kilo_neto !== undefined 
      ? parseFloat(product.precio_kilo_neto) 
      : Math.round((precioKiloConIva / (1 + (ivaPorcentaje / 100))) * 100) / 100;

    const esModoNeto = mostrarSinIva === true;
    const displayPrecioKilo = esModoNeto ? precioKiloNeto : precioKiloConIva;
    const displayPrecioBulto = esModoNeto ? precioBultoNeto : precioBultoConIva;

    const ofertaActiva = ofertasActivas[cod] || null;
    const descOfertaPct = ofertaActiva ? (parseFloat(ofertaActiva.descuento_porcentaje) || 5) : 0;

    let displayPrecioBultoOferta = displayPrecioBulto;
    let displayPrecioKiloOferta = displayPrecioKilo;
    if (ofertaActiva) {
      displayPrecioBultoOferta = ofertaActiva.precio_fijo_oferta
        ? parseFloat(ofertaActiva.precio_fijo_oferta)
        : Math.round(displayPrecioBulto * (1 - descOfertaPct / 100) * 100) / 100;
      displayPrecioKiloOferta = Math.round((displayPrecioBultoOferta / kilosUnidad) * 100) / 100;
    }

    const cleanProdCod = cod.toLowerCase();
    const habInfo = articulosHabituales.get(cleanProdCod);
    const esFavorito = !!habInfo;

    const infoPartida = mapaFotosLotes[cod] || null;
    const cantFotosPartida = Array.isArray(infoPartida?.imagenes) ? infoPartida.imagenes.length : 0;

    return (
      <div key={product.id || product.producto_codigo} className={`product-card ${esFavorito ? 'es-favorito' : ''} ${ofertaActiva ? 'es-oferta' : ''}`}>
        {/* Primera línea: Stock + ⭐ Habitual + Descripción + IVA + Oferta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          {canViewStock ? (() => {
            const rawStock = parseFloat(product.stock_disponible || 0);
            let esDisponible = false;
            let esRequiereProd = false;
            let cantStock = 0;
            let cantPotencial = 0;

            if (product.stock_estado === 'disponible' || (!product.stock_estado && rawStock > 0)) {
              if (rawStock > 0) {
                esDisponible = true;
                cantStock = rawStock;
              }
            }

            if (!esDisponible) {
              if (product.stock_estado === 'requiere_produccion' || rawStock < 0 || (product.busqueda_metadata && product.busqueda_metadata.includes('__REQ_PROD:'))) {
                esRequiereProd = true;
                if (rawStock < 0) {
                  cantPotencial = Math.round(Math.abs(rawStock));
                } else if (product.busqueda_metadata && product.busqueda_metadata.includes('__REQ_PROD:')) {
                  const match = product.busqueda_metadata.match(/__REQ_PROD:(\d+)__/);
                  if (match) cantPotencial = parseInt(match[1], 10);
                }
              }
            }

            if (esDisponible) {
              return (
                <span 
                  className="b2b-stock-badge stock-disponible" 
                  title={`Stock inmediato en depósito: ${cantStock} unidad(es)`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                    backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0',
                    borderRadius: '12px', padding: '1px 7px', fontSize: '0.74rem', fontWeight: '700', whiteSpace: 'nowrap'
                  }}
                >
                  🟢 {cantStock} u.
                </span>
              );
            }

            if (esRequiereProd && cantPotencial > 0) {
              return (
                <span 
                  className="b2b-stock-badge stock-produccion" 
                  title={`Con insumos para producir aprox. ${cantPotencial} unidad(es)`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                    backgroundColor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd',
                    borderRadius: '12px', padding: '1px 7px', fontSize: '0.74rem', fontWeight: '700', whiteSpace: 'nowrap'
                  }}
                >
                  🔵 Requiere prod. (~{cantPotencial} u.)
                </span>
              );
            }

            return (
              <span 
                className="b2b-stock-badge stock-agotado" 
                title="Sin stock físico inmediato"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '3px',
                  backgroundColor: '#f1f5f9', color: '#64748b', border: '1px solid #cbd5e1',
                  borderRadius: '12px', padding: '1px 7px', fontSize: '0.74rem', fontWeight: '600', whiteSpace: 'nowrap'
                }}
              >
                ⚪ Sin stock
              </span>
            );
          })() : (
            (parseFloat(product.stock_disponible) > 0) && (
              <span className="stock-dot" title="Disponible" />
            )
          )}

          {esFavorito && (
            <span 
              className="b2b-favorito-tag" 
              title={`Artículo habitual (comprado ${habInfo.frecuencia} ${habInfo.frecuencia === 1 ? 'vez' : 'veces'})`}
            >
              ⭐
            </span>
          )}
          <h4 className={`product-name ${ofertaActiva ? 'product-name-oferta' : ''}`} style={{ fontSize: '0.92rem', fontWeight: '600', margin: 0, flex: 1, lineHeight: '1.25' }}>
            {product.producto_descripcion}
          </h4>
          {delegacion?.mostrar_precios && esModoNeto && (
            <span className={`b2b-iva-pill ${ivaPorcentaje < 20 ? 'iva-105' : ''}`} title={`Alícuota de IVA: ${ivaPorcentaje}%`}>
              IVA {ivaPorcentaje}%
            </span>
          )}
          {ofertaActiva && (
            <span className="b2b-oferta-badge" title={`Oferta promocional activa: ${ofertaActiva.titulo}`}>
              🔥 {descOfertaPct}% OFF
            </span>
          )}
        </div>

        {/* Segunda línea: Botón (+) + Ver partida a la IZQUIERDA | Precios a la DERECHA */}
        <div className="product-meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            {currentQty > 0 ? (
              <div className="quantity-controls">
                <button 
                  className="qty-btn"
                  onClick={() => cambiarCantidad(product, -1)}
                  title="Disminuir"
                >
                  <Minus size={13} />
                </button>
                <span className="qty-value">{currentQty}</span>
                <button 
                  className="qty-btn"
                  onClick={() => cambiarCantidad(product, 1)}
                  title="Aumentar"
                >
                  <Plus size={13} />
                </button>
              </div>
            ) : (
              <button 
                className="btn-add-plus"
                onClick={() => cambiarCantidad(product, 1)}
                title="Seleccionar artículo"
              >
                <Plus size={15} />
              </button>
            )}

            {cantFotosPartida > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setModalPartidaCtx({
                    product,
                    infoPartida,
                    displayPrecioBulto: ofertaActiva ? displayPrecioBultoOferta : displayPrecioBulto,
                    displayPrecioKilo: ofertaActiva ? displayPrecioKiloOferta : displayPrecioKilo,
                    esModoNeto
                  });
                }}
                title="Ver fotografías de la partida actual en depósito"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  backgroundColor: 'rgba(13, 148, 136, 0.14)',
                  color: '#2dd4bf',
                  border: '1px solid rgba(20, 184, 166, 0.4)',
                  borderRadius: '8px',
                  padding: '3px 8px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                <span>📷</span>
                <span>Ver partida{cantFotosPartida > 1 ? ` (${cantFotosPartida})` : ''}</span>
              </button>
            )}
          </div>

          {/* Precios o Presentación */}
          <div className="product-price-container" style={{ textAlign: 'right' }}>
            {delegacion?.mostrar_precios ? (
              ofertaActiva ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                    <span style={{ textDecoration: 'line-through', opacity: 0.5, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      ({formatCurrency(displayPrecioBulto)})
                    </span>
                    <span className="product-price-bulto" style={{ color: '#16a34a', fontWeight: '700' }}>
                      ({formatCurrency(displayPrecioBultoOferta)}{esModoNeto ? ' s/IVA' : ''})
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                    <span style={{ textDecoration: 'line-through', opacity: 0.5, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {formatCurrency(displayPrecioKilo)}
                    </span>
                    <span className="product-price-kilo" style={{ color: '#16a34a', fontWeight: '700' }}>
                      {formatCurrency(displayPrecioKiloOferta)}<span className="product-price-kilo-unit">/kg</span>
                      {esModoNeto && <span className="b2b-neto-tag"> Neto</span>}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <span className="product-price-bulto" title={`Precio por bulto cerrado (${kilosUnidad}kg)`}>
                    ({formatCurrency(displayPrecioBulto)}{esModoNeto ? ' s/IVA' : ''})
                  </span>
                  <span className="product-price-kilo">
                    {formatCurrency(displayPrecioKilo)}<span className="product-price-kilo-unit">/kg</span>
                    {esModoNeto && <span className="b2b-neto-tag"> Neto</span>}
                  </span>
                </>
              )
            ) : (
              <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
                {kilosUnidad > 1 ? `${kilosUnidad} kg` : 'Unidad'}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Construir URL de WhatsApp para enviar el pre-pedido al responsable de aprobación
  const construirUrlWhatsAppAprobacion = (datos) => {
    if (!datos) return '#';
    const lineasItems = (datos.items || []).slice(0, 12).map(
      it => `• ${it.cantidad}x ${it.producto_descripcion}`
    );
    if ((datos.items || []).length > 12) {
      lineasItems.push(`...y ${datos.items.length - 12} artículo(s) más.`);
    }

    const bloques = [
      `Hola${datos.aprobador_nombre ? ` ${datos.aprobador_nombre}` : ''}, preparé una selección preliminar de mercadería para *${datos.nombre_empresa || 'el comercio'}* (${datos.total_unidades} bultos / ${datos.items.length} artículos).`
    ];

    if (datos.mostrar_precios && datos.total_estimado > 0) {
      bloques.push(
        `💰 Total estimado: *${formatCurrency(datos.total_estimado)}*${datos.descuento_porcentaje > 0 ? ` (incluye ${datos.descuento_porcentaje}% bonif. por volumen)` : ''}`
      );
    }

    if (datos.nota_colaborador) {
      bloques.push(`💬 Nota: _"${datos.nota_colaborador}"_`);
    }

    bloques.push(`📦 Detalle:\n${lineasItems.join('\n')}`);
    bloques.push(`👉 Podés revisar, ajustar cantidades o aprobar el pedido directamente desde este enlace:\n${datos.link_revision}`);

    const texto = bloques.join('\n\n');
    const cleanPhone = String(datos.aprobador_telefono || '').replace(/[^0-9]/g, '');
    return cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(texto)}`
      : `https://wa.me/?text=${encodeURIComponent(texto)}`;
  };

  // MODO ARMADO: Guardar Pre-Pedido y preparar envío por WhatsApp
  const handleConfirmarEnvioPrepedido = async () => {
    if (itemsArray.length === 0) return;
    setSubmitting(true);

    try {
      const tokenAprobacion = generarTokenHex(16);

      const payloadItems = itemsArray.map(it => ({
        producto_codigo: it.producto.producto_codigo,
        producto_descripcion: it.producto.producto_descripcion,
        cantidad: it.cantidad,
        kilos_unidad: parseFloat(it.producto.kilos_unidad || 1),
        precio_unitario: parseFloat(it.producto.precio_final || 0),
        subtotal: parseFloat(it.producto.precio_final || 0) * it.cantidad,
        es_oferta: Boolean(it.producto.es_oferta),
        oferta_id: it.producto.oferta_id || null,
        oferta_titulo: it.producto.oferta_titulo || null,
        descuento_porcentaje: it.producto.descuento_porcentaje || 0
      }));

      const descPct = politicaEval.aplica ? politicaEval.porcentaje : 0;
      const totalEst = politicaEval.totalEstimado || 0;

      const { error: prepErr } = await supabaseAnonimaPublica
        .from('clientes_b2b_prepedidos')
        .insert({
          delegacion_id: delegacion.id,
          cliente_id: delegacion.cliente_id,
          colaborador_nombre: delegacion.nombre_colaborador || 'Colaborador',
          items: payloadItems,
          nota_colaborador: notaColaborador.trim() || null,
          estado: 'pendiente_revision',
          token_aprobacion: tokenAprobacion,
          aprobador_nombre: delegacion.aprobador_nombre || null,
          aprobador_telefono: delegacion.aprobador_telefono || null,
          descuento_porcentaje: descPct,
          total_estimado: totalEst
        });

      if (prepErr) throw prepErr;

      if (delegacion.tipo_enlace === 'unico') {
        await supabaseAnonimaPublica
          .from('clientes_b2b_delegaciones')
          .update({ activo: false, updated_at: new Date().toISOString() })
          .eq('id', delegacion.id);
      }

      const linkRevision = `${window.location.origin}/#/pre-pedido?revisar=${tokenAprobacion}`;
      const datosCompletados = {
        token_aprobacion: tokenAprobacion,
        link_revision: linkRevision,
        nombre_empresa: delegacion.nombre_empresa || 'Comercio',
        colaborador_nombre: delegacion.nombre_colaborador || 'Colaborador',
        aprobador_nombre: delegacion.aprobador_nombre || '',
        aprobador_telefono: delegacion.aprobador_telefono || '',
        items: payloadItems,
        total_unidades: totalUnidades,
        total_estimado: totalEst,
        descuento_porcentaje: descPct,
        mostrar_precios: Boolean(delegacion.mostrar_precios),
        nota_colaborador: notaColaborador.trim()
      };

      setDatosEnvioCompletado(datosCompletados);
      setShowConfirmModal(false);
      setCompletadoExitoso(true);
    } catch (err) {
      console.error('Error registrando pre-pedido:', err);
      Swal.fire({
        title: 'Error al registrar',
        text: 'No se pudo guardar el pre-pedido: ' + (err.message || 'Error de conexión'),
        icon: 'error',
        confirmButtonColor: '#7c3aed'
      });
    } finally {
      setSubmitting(false);
    }
  };

  // MODO APROBACIÓN: Confirmar y convertir en Pedido Oficial LAMDA
  const handleAprobarYConfirmarPedidoOficial = async () => {
    if (itemsArray.length === 0) {
      Swal.fire({
        title: 'Sin artículos',
        text: 'El pedido debe contener al menos un artículo para poder confirmarse.',
        icon: 'warning',
        confirmButtonColor: '#7c3aed'
      });
      return;
    }

    const confirmRes = await Swal.fire({
      title: '¿Confirmar Pedido a LAMDA?',
      html: `
        <div style="text-align:left; font-size:0.9rem; color:#cbd5e1; line-height:1.5;">
          <p style="margin:0 0 8px 0;">Estás por confirmar el pedido definitivo para <strong>${delegacion?.nombre_empresa || 'el comercio'}</strong>:</p>
          <ul style="margin:0 0 10px 0; padding-left:18px;">
            <li>Artículos distintos: <strong>${totalArticulosDiferentes}</strong> (${totalUnidades} bultos/unidades)</li>
            ${politicaEval.aplica ? `<li>Bonificación por volumen: <strong style="color:#34d399;">-${politicaEval.porcentaje}% (${formatCurrency(politicaEval.montoDescuento)})</strong></li>` : ''}
            <li>Total Final Estimado: <strong style="color:#34d399;">${formatCurrency(politicaEval.totalEstimado)}</strong></li>
          </ul>
          <p style="margin:0; font-size:0.8rem; color:#94a3b8;">El pedido ingresará directamente a preparación en el depósito de LAMDA.</p>
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#10b981',
      cancelButtonColor: '#334155',
      confirmButtonText: '✅ Sí, Confirmar Pedido',
      cancelButtonText: 'Revisar de nuevo',
      background: '#0f172a',
      color: '#f8fafc'
    });

    if (!confirmRes.isConfirmed) return;

    setSubmitting(true);
    try {
      const payloadItems = itemsArray.map(it => ({
        producto_codigo: it.producto.producto_codigo,
        producto_descripcion: it.producto.producto_descripcion,
        cantidad: it.cantidad,
        kilos_unidad: parseFloat(it.producto.kilos_unidad || 1),
        precio_unitario: parseFloat(it.producto.precio_final || 0),
        subtotal: parseFloat(it.producto.precio_final || 0) * it.cantidad,
        es_oferta: Boolean(it.producto.es_oferta),
        oferta_id: it.producto.oferta_id || null,
        descuento_porcentaje: it.producto.descuento_porcentaje || 0
      }));

      const descPct = politicaEval.aplica ? politicaEval.porcentaje : 0;
      const totalFinal = politicaEval.totalEstimado || 0;

      const { data: rpcRes, error: rpcErr } = await supabaseAnonimaPublica.rpc(
        'confirmar_prepedido_aprobador',
        {
          p_token_aprobacion: tokenRevisar,
          p_items: payloadItems,
          p_observaciones: observacionesAprobador.trim() || null,
          p_descuento_porcentaje: descPct,
          p_total_final: totalFinal
        }
      );

      if (rpcErr) throw new Error(rpcErr.message || 'No se pudo confirmar el pedido.');
      if (!rpcRes || !rpcRes.success) {
        throw new Error(rpcRes?.error || 'Error al procesar la confirmación del pedido.');
      }

      setPedidoConfirmadoInfo({
        pedido_id: rpcRes.pedido_id,
        total_final: rpcRes.total_final || totalFinal,
        confirmado_en: new Date().toISOString(),
        ya_confirmado: Boolean(rpcRes.ya_confirmado)
      });
    } catch (err) {
      console.error('Error al aprobar y confirmar pedido:', err);
      Swal.fire({
        title: 'Error al confirmar',
        text: err.message || 'No se pudo registrar el pedido.',
        icon: 'error',
        confirmButtonColor: '#7c3aed'
      });
    } finally {
      setSubmitting(false);
    }
  };

  // PANTALLA 1: CARGANDO
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0a0f1d',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#94a3b8',
        padding: '2rem'
      }}>
        <Loader2 size={44} className="spinner" style={{ color: '#7c3aed', marginBottom: '1.25rem' }} />
        <h3 style={{ margin: 0, color: '#f8fafc', fontWeight: 700 }}>
          {modo === 'aprobacion' ? 'Cargando pre-pedido para revisión...' : 'Cargando catálogo de artículos...'}
        </h3>
        <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.5rem' }}>
          Verificando credenciales y listas de precios vigentes
        </p>
      </div>
    );
  }

  // PANTALLA 2: CANDADO DE VALIDACIÓN DE TELÉFONO (4 DÍGITOS) EN PRIMER INGRESO
  if (requiereValidacionTelefono) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0a0f1d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div style={{
          background: '#0f172a',
          border: '1px solid rgba(124, 58, 237, 0.45)',
          borderRadius: '20px',
          padding: '2rem 1.5rem',
          maxWidth: '420px',
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 25px 50px rgba(0,0,0,0.6)'
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'rgba(124, 58, 237, 0.15)',
            border: '2px solid #8b5cf6',
            color: '#c084fc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem'
          }}>
            <Smartphone size={30} />
          </div>

          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#c084fc', fontWeight: 800, marginBottom: '0.25rem' }}>
            🏬 {infoPreviaDelegacion?.nombre_empresa || 'Comercio B2B'}
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 900, margin: '0 0 0.5rem 0', color: '#f8fafc' }}>
            Verificación Única de Dispositivo
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.86rem', lineHeight: '1.5', margin: '0 0 1.25rem 0' }}>
            Hola <strong>{infoPreviaDelegacion?.nombre_colaborador || 'Colaborador'}</strong>. Para habilitar este enlace en tu celular y proteger el acceso del comercio, ingresá los <strong>últimos 4 dígitos</strong> de tu teléfono registrado (<strong>{telefonoMascara}</strong>):
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inputUltimosDigitos.trim().length < 4) {
                setErrorValidacionTelefono('Ingresá los 4 últimos dígitos de tu número de teléfono.');
                return;
              }
              verificarYVincularDelegacion(token, inputUltimosDigitos.trim());
            }}
          >
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              placeholder="••••"
              value={inputUltimosDigitos}
              onChange={(e) => {
                setErrorValidacionTelefono('');
                setInputUltimosDigitos(e.target.value.replace(/[^0-9]/g, '').slice(0, 4));
              }}
              style={{
                width: '160px',
                textAlign: 'center',
                fontSize: '1.8rem',
                fontWeight: 900,
                letterSpacing: '0.35em',
                padding: '0.6rem 0.75rem',
                borderRadius: '12px',
                background: '#090d16',
                border: errorValidacionTelefono ? '2px solid #ef4444' : '2px solid #475569',
                color: '#f8fafc',
                outline: 'none',
                marginBottom: '0.75rem'
              }}
            />

            {errorValidacionTelefono && (
              <div style={{
                color: '#f87171',
                fontSize: '0.8rem',
                fontWeight: 600,
                marginBottom: '0.85rem',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                padding: '0.5rem'
              }}>
                {errorValidacionTelefono}
              </div>
            )}

            <button
              type="submit"
              disabled={validandoTelefono || inputUltimosDigitos.length < 4}
              style={{
                width: '100%',
                background: inputUltimosDigitos.length === 4
                  ? 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)'
                  : '#334155',
                color: 'white',
                border: 'none',
                padding: '0.85rem 1.25rem',
                borderRadius: '12px',
                fontSize: '0.92rem',
                fontWeight: 800,
                cursor: inputUltimosDigitos.length === 4 ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: inputUltimosDigitos.length === 4 ? '0 8px 20px rgba(124, 58, 237, 0.35)' : 'none'
              }}
            >
              {validandoTelefono ? (
                <>
                  <Loader2 size={18} className="spinner" />
                  <span>Verificando dispositivo...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} />
                  <span>Validar y Vincular Mi Celular</span>
                </>
              )}
            </button>
          </form>

          <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '1.1rem', lineHeight: '1.4' }}>
            🔒 Una vez validado, este enlace abrirá directamente en este teléfono sin volver a pedirte confirmación.
          </div>
        </div>
      </div>
    );
  }

  // PANTALLA 3: ERROR O DISPOSITIVO BLOQUEADO
  if (errorMsg) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0a0f1d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '16px',
          padding: '2rem',
          maxWidth: '460px',
          textAlign: 'center',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
        }}>
          {bloqueadoOtroDispositivo ? (
            <Lock size={48} style={{ color: '#f59e0b', margin: '0 auto 1rem' }} />
          ) : (
            <AlertCircle size={48} style={{ color: '#f87171', margin: '0 auto 1rem' }} />
          )}
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.75rem 0' }}>
            {bloqueadoOtroDispositivo ? 'Enlace Vinculado a Otro Dispositivo' : 'Enlace No Disponible'}
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: '1.5', margin: '0 0 1.5rem 0' }}>
            {errorMsg}
          </p>
          <div style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: '1.45' }}>
            {bloqueadoOtroDispositivo
              ? 'Por seguridad, cada enlace de operador funciona únicamente en el teléfono móvil donde fue activado. Si cambiaste de celular, solicitá la desvinculación a la administración.'
              : 'Solicitá a la administración del comercio un nuevo enlace actualizado por WhatsApp.'}
          </div>
        </div>
      </div>
    );
  }

  // PANTALLA 4: PEDIDO OFICIAL YA CONFIRMADO (MODO APROBACIÓN)
  if (modo === 'aprobacion' && pedidoConfirmadoInfo) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0a0f1d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div style={{
          background: '#0f172a',
          border: '1px solid #10b981',
          borderRadius: '20px',
          padding: '2.25rem 1.75rem',
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 25px 50px rgba(16, 185, 129, 0.15)'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '2px solid #10b981',
            color: '#34d399',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.15rem'
          }}>
            <Check size={36} />
          </div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 900, margin: '0 0 0.5rem 0', color: '#f8fafc' }}>
            ¡Pedido Aprobado y Confirmado!
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: '1.5', margin: '0 0 1.25rem 0' }}>
            El pedido de <strong>{delegacion?.nombre_empresa}</strong> fue ingresado oficialmente al sistema de despacho de <strong>LAMDA</strong>.
          </p>

          <div style={{
            background: '#090d16',
            border: '1px solid #1e293b',
            borderRadius: '12px',
            padding: '1rem',
            fontSize: '0.85rem',
            marginBottom: '1.5rem',
            textAlign: 'left'
          }}>
            {pedidoConfirmadoInfo.pedido_id && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span style={{ color: '#94a3b8' }}>N° de Pedido B2B:</span>
                <strong style={{ color: '#38bdf8' }}>#{pedidoConfirmadoInfo.pedido_id}</strong>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ color: '#94a3b8' }}>Artículos confirmados:</span>
              <strong style={{ color: '#f8fafc' }}>{totalArticulosDiferentes} ({totalUnidades} u.)</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>Total estimado:</span>
              <strong style={{ color: '#34d399' }}>{formatCurrency(politicaEval.totalEstimado)}</strong>
            </div>
          </div>

          <div style={{ fontSize: '0.8rem', color: '#64748b', lineHeight: '1.45' }}>
            Ya podés cerrar esta ventana. El equipo de LAMDA procesará el pedido para su preparación y entrega.
          </div>
        </div>
      </div>
    );
  }

  // PANTALLA 5: ÉXITO TRAS PRE-ARMAR PEDIDO (CON BOTÓN DIRECTO A WHATSAPP DEL APROBADOR)
  if (completadoExitoso && datosEnvioCompletado) {
    const waUrl = construirUrlWhatsAppAprobacion(datosEnvioCompletado);

    return (
      <div style={{
        minHeight: '100vh',
        background: '#0a0f1d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <div style={{
          background: '#0f172a',
          border: '1px solid #10b981',
          borderRadius: '20px',
          padding: '2rem 1.5rem',
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 25px 50px rgba(16, 185, 129, 0.15)'
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '2px solid #10b981',
            color: '#34d399',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem'
          }}>
            <Check size={32} />
          </div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 900, margin: '0 0 0.4rem 0' }}>
            ¡Pre-Pedido Listo para Aprobación!
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.86rem', lineHeight: '1.45', margin: '0 0 1.25rem 0' }}>
            Tu selección quedó guardada. Recordá que <strong>este envío aún no confirma la compra ante LAMDA</strong>: envialo ahora por WhatsApp para su revisión y confirmación final.
          </p>

          <div style={{
            background: '#090d16',
            border: '1px solid #1e293b',
            borderRadius: '12px',
            padding: '0.9rem 1rem',
            fontSize: '0.84rem',
            marginBottom: '1.25rem',
            textAlign: 'left'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <span style={{ color: '#94a3b8' }}>Comercio:</span>
              <strong style={{ color: '#f8fafc' }}>{datosEnvioCompletado.nombre_empresa}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <span style={{ color: '#94a3b8' }}>Artículos seleccionados:</span>
              <strong style={{ color: '#34d399' }}>{datosEnvioCompletado.items.length} ({datosEnvioCompletado.total_unidades} u.)</strong>
            </div>
            {datosEnvioCompletado.mostrar_precios && datosEnvioCompletado.total_estimado > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ color: '#94a3b8' }}>Total estimado:</span>
                <strong style={{ color: '#38bdf8' }}>{formatCurrency(datosEnvioCompletado.total_estimado)}</strong>
              </div>
            )}
            {datosEnvioCompletado.nota_colaborador && (
              <div style={{ marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.5rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Nota incluida:</span>
                <p style={{ margin: '0.2rem 0 0 0', color: '#cbd5e1', fontStyle: 'italic' }}>"{datosEnvioCompletado.nota_colaborador}"</p>
              </div>
            )}
          </div>

          {/* BOTÓN PRINCIPAL: ENVIAR POR WHATSAPP AL RESPONSABLE */}
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.6rem',
              width: '100%',
              boxSizing: 'border-box',
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              color: 'white',
              textDecoration: 'none',
              padding: '0.9rem 1.25rem',
              borderRadius: '12px',
              fontSize: '0.95rem',
              fontWeight: 900,
              boxShadow: '0 8px 25px rgba(34, 197, 94, 0.35)',
              marginBottom: '0.75rem'
            }}
          >
            <Share2 size={18} />
            <span>
              Enviar por WhatsApp {datosEnvioCompletado.aprobador_nombre ? `a ${datosEnvioCompletado.aprobador_nombre}` : 'para Aprobación'}
            </span>
          </a>

          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(datosEnvioCompletado.link_revision);
              Swal.fire({
                title: 'Enlace copiado',
                text: 'Podés pegarlo en el chat de WhatsApp de quien aprueba las compras.',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false,
                background: '#0f172a',
                color: '#f8fafc'
              });
            }}
            style={{
              width: '100%',
              background: 'rgba(56, 189, 248, 0.12)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              padding: '0.65rem 1rem',
              borderRadius: '10px',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.45rem'
            }}
          >
            <Copy size={15} />
            <span>Copiar enlace de revisión y aprobación</span>
          </button>

          {delegacion?.tipo_enlace === 'permanente' && (
            <button
              type="button"
              onClick={() => {
                setSelectedItems({});
                setNotaColaborador('');
                setCompletadoExitoso(false);
                setDatosEnvioCompletado(null);
              }}
              style={{
                marginTop: '1.1rem',
                background: 'transparent',
                color: '#94a3b8',
                border: '1px solid #334155',
                padding: '0.6rem 1.1rem',
                borderRadius: '10px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              🔄 Armar un nuevo pre-pedido
            </button>
          )}
        </div>
      </div>
    );
  }

  // PANTALLA PRINCIPAL: MODO APROBACIÓN O MODO ARMADO DE PRE-PEDIDO
  const mostrarSeccionCatalogo = modo === 'armado' || mostrarCatalogoEnRevision;

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0f1d',
      color: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      paddingBottom: totalArticulosDiferentes > 0 ? '115px' : '30px'
    }}>
      {/* ENCABEZADO INSTITUCIONAL */}
      <header style={{
        background: modo === 'aprobacion'
          ? 'linear-gradient(135deg, #064e3b 0%, #0f172a 100%)'
          : 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
        borderBottom: modo === 'aprobacion'
          ? '1px solid rgba(16, 185, 129, 0.35)'
          : '1px solid rgba(124, 58, 237, 0.3)',
        padding: '0.85rem 1rem',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{
              fontSize: '0.68rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: modo === 'aprobacion' ? '#34d399' : '#c084fc',
              fontWeight: 800
            }}>
              🏬 {delegacion?.nombre_empresa || 'Comercio B2B'}
            </div>
            <h1 style={{ margin: '0.1rem 0 0 0', fontSize: '1.05rem', fontWeight: 900, color: '#f8fafc' }}>
              {modo === 'aprobacion'
                ? '✅ Revisión y Confirmación de Pedido'
                : '📋 Pre-Armado de Pedido (Sujeto a Aprobación)'}
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {canToggleIva && (
              <button
                type="button"
                onClick={() => setShowIvaModal(true)}
                className={`b2b-gear-icon-btn ${mostrarSinIva ? 'active' : ''}`}
                title="Configurar modalidad de precios (Con IVA / Sin IVA)"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: '#f8fafc',
                  borderRadius: '8px',
                  padding: '0.35rem 0.55rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.74rem',
                  fontWeight: 700
                }}
              >
                <Settings size={15} />
                <span>{mostrarSinIva ? 'Sin IVA' : 'Con IVA'}</span>
              </button>
            )}

            {delegacion?.nombre_colaborador && (
              <div style={{
                background: 'rgba(124, 58, 237, 0.2)',
                border: '1px solid rgba(124, 58, 237, 0.4)',
                padding: '0.25rem 0.65rem',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: '#c084fc'
              }}>
                👤 {modo === 'aprobacion' ? `Armado por: ${delegacion.nombre_colaborador}` : delegacion.nombre_colaborador}
              </div>
            )}
          </div>
        </div>

        {/* BARRA DE BÚSQUEDA, FAVORITOS Y OFERTAS (cuando el catálogo está visible) */}
        {mostrarSeccionCatalogo && (
          <div className="b2b-top-search-section" style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', width: '100%', flexWrap: 'wrap' }}>
              <div className="b2b-search-centered-wrapper" style={{ flex: '1', minWidth: '200px' }}>
                <Search className="input-icon" size={18} style={{ left: '1rem', color: 'var(--accent)' }} />
                <input
                  type="text"
                  placeholder="Buscar artículo (ej: avena, nuez, maiz, 5kg)..."
                  className="search-input b2b-main-search-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ paddingRight: search ? '4.5rem' : '2.8rem' }}
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="b2b-search-btn-clear"
                    title="Limpiar búsqueda"
                  >
                    <X size={16} />
                  </button>
                )}
                <button
                  onClick={() => setShowSearchHelp(!showSearchHelp)}
                  className={`b2b-search-btn-info ${showSearchHelp ? 'active' : ''}`}
                  title="Ayuda de búsqueda"
                >
                  <Info size={16} />
                </button>
              </div>

              {/* Switch de Favoritos */}
              <button
                type="button"
                onClick={toggleFiltroFavoritos}
                className={`b2b-favoritos-btn ${filtroFavoritos ? 'active' : ''}`}
                title={filtroFavoritos ? 'Desactivar filtro y ver catálogo completo' : 'Filtrar artículos habituales de este comercio'}
              >
                <Star 
                  size={17} 
                  style={{ 
                    fill: filtroFavoritos ? '#f59e0b' : 'none', 
                    color: filtroFavoritos ? '#f59e0b' : 'var(--text-muted)',
                    transition: 'all 0.2s'
                  }} 
                />
                <span>Favoritos</span>
                <span className="b2b-favoritos-count-badge">
                  {articulosHabituales.size}
                </span>
              </button>

              {/* Switch de Ofertas */}
              {articulosEnOferta.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFiltroOfertas(prev => !prev)}
                  className={`b2b-ofertas-btn ${filtroOfertas ? 'active' : ''}`}
                  title={filtroOfertas ? 'Desactivar filtro y ver catálogo completo' : 'Ver únicamente artículos con ofertas activas'}
                >
                  <span>🔥</span>
                  <span>Ofertas</span>
                  <span className="b2b-ofertas-count-badge">
                    {articulosEnOferta.length}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {showSearchHelp && (
          <div className="b2b-search-help-box" style={{ marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <Info size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Búsqueda Inteligente:</strong> Podés escribir varias palabras separadas por espacio (ej: <code className="b2b-code-pill">nuez mpsa</code> o <code className="b2b-code-pill">maiz fto</code>) para filtrar acumulativamente los artículos.
              </div>
            </div>
            <button 
              onClick={() => setShowSearchHelp(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 'auto', padding: '2px' }}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </header>

      {/* AVISO CLARO DE MODO PRE-DEFINICIÓN (EN MODO ARMADO) */}
      {modo === 'armado' && (
        <div style={{
          padding: '0.6rem 1rem',
          background: 'rgba(245, 158, 11, 0.1)',
          borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.5rem',
          fontSize: '0.78rem',
          color: '#fde68a'
        }}>
          <span>
            ⚠️ <strong>Modo Pre-Definición:</strong> Estás predefiniendo un pedido para ser aprobado. No confirma la compra a LAMDA hasta que sea validado por la administración.
          </span>
          <span style={{ color: '#94a3b8', fontSize: '0.74rem' }}>
            {delegacion?.mostrar_precios
              ? (mostrarSinIva ? '💰 Precios Netos sin IVA' : '💰 Precios con IVA incluido')
              : '🛡️ Modo Reposición'}
          </span>
        </div>
      )}

      {/* SECCIÓN DE REVISIÓN Y EDICIÓN DEL APROBADOR (?revisar=...) */}
      {modo === 'aprobacion' && (
        <section style={{ padding: '1rem', maxWidth: '900px', margin: '0 auto' }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            borderRadius: '16px',
            padding: '1.25rem',
            boxShadow: '0 15px 35px rgba(0,0,0,0.4)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#34d399', fontWeight: 800, textTransform: 'uppercase' }}>
                  📋 Pre-Pedido Recibido para Aprobación
                </span>
                <h2 style={{ margin: '0.2rem 0 0 0', fontSize: '1.15rem', fontWeight: 900, color: '#f8fafc' }}>
                  Selección preparada por {prepedidoRevision?.colaborador_nombre || 'Colaborador'}
                </h2>
              </div>
              {prepedidoRevision?.created_at && (
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', background: '#1e293b', padding: '4px 10px', borderRadius: '999px' }}>
                  🕒 {new Date(prepedidoRevision.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              )}
            </div>

            {prepedidoRevision?.nota_colaborador && (
              <div style={{
                background: 'rgba(124, 58, 237, 0.12)',
                border: '1px solid rgba(124, 58, 237, 0.35)',
                borderRadius: '10px',
                padding: '0.75rem 1rem',
                marginBottom: '1rem',
                fontSize: '0.85rem',
                color: '#e2e8f0'
              }}>
                <strong style={{ color: '#c084fc', display: 'block', marginBottom: '2px', fontSize: '0.76rem' }}>
                  💬 Nota de quien armó el pre-pedido:
                </strong>
                "{prepedidoRevision.nota_colaborador}"
              </div>
            )}

            {/* LISTA EDITABLE DE ARTÍCULOS DEL PRE-PEDIDO */}
            <div style={{
              background: '#090d16',
              border: '1px solid #1e293b',
              borderRadius: '12px',
              padding: '0.5rem 0.75rem',
              marginBottom: '1rem'
            }}>
              {itemsArray.length === 0 ? (
                <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.88rem' }}>
                  Quitaste todos los artículos del pre-pedido. Podés abrir el catálogo debajo para agregar productos.
                </div>
              ) : (
                itemsArray.map(it => {
                  const cod = (it.producto.producto_codigo || '').trim();
                  const unitPrice = parseFloat(it.producto.precio_final || 0);
                  const sub = unitPrice * it.cantidad;
                  return (
                    <div
                      key={cod}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.6rem 0',
                        borderBottom: '1px dashed rgba(255,255,255,0.07)',
                        flexWrap: 'wrap'
                      }}
                    >
                      <div style={{ flex: 1, minWidth: '180px' }}>
                        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span>{it.producto.producto_descripcion}</span>
                          {it.producto.es_oferta && (
                            <span style={{ fontSize: '0.68rem', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', padding: '1px 6px', borderRadius: '6px', fontWeight: 800 }}>
                              🔥 {it.producto.descuento_porcentaje}% OFF
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: '2px' }}>
                          {formatCurrency(unitPrice)} c/u (c/IVA)
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <div className="quantity-controls">
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() => cambiarCantidad(it.producto, -1)}
                            title="Disminuir cantidad"
                          >
                            <Minus size={13} />
                          </button>
                          <span className="qty-value">{it.cantidad}</span>
                          <button
                            type="button"
                            className="qty-btn"
                            onClick={() => cambiarCantidad(it.producto, 1)}
                            title="Aumentar cantidad"
                          >
                            <Plus size={13} />
                          </button>
                        </div>

                        <div style={{ minWidth: '95px', textAlign: 'right', fontWeight: 800, fontSize: '0.88rem', color: '#34d399' }}>
                          {formatCurrency(sub)}
                        </div>

                        <button
                          type="button"
                          onClick={() => eliminarItemSeleccionado(cod)}
                          title="Quitar artículo"
                          style={{
                            background: 'rgba(239, 68, 68, 0.12)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            color: '#f87171',
                            borderRadius: '8px',
                            padding: '5px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* BANNER DE POLÍTICA COMERCIAL POR VOLUMEN */}
            {politicaComercial && itemsArray.length > 0 && (
              <div style={{
                borderRadius: '10px',
                padding: '0.7rem 0.9rem',
                fontSize: '0.82rem',
                marginBottom: '1rem',
                background: politicaEval.aplica ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                border: `1px solid ${politicaEval.aplica ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`,
                color: politicaEval.aplica ? '#34d399' : '#fbbf24'
              }}>
                {politicaEval.aplica ? (
                  <div>
                    🎉 <strong>¡Bonificación por volumen del {politicaEval.porcentaje}% aplicada!</strong> (-{formatCurrency(politicaEval.montoDescuento)})
                    {politicaEval.proximoTramo && (
                      <div style={{ fontSize: '0.74rem', marginTop: '3px', opacity: 0.9 }}>
                        ↳ Sumando {formatCurrency(politicaEval.faltaParaProximo)} más accedés al {politicaEval.proximoPorcentaje}%
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    💡 Sumando <strong>{formatCurrency(politicaEval.faltaParaProximo)}</strong> más al pedido accedés al <strong>{politicaEval.proximoPorcentaje}% de bonificación por volumen</strong>.
                  </div>
                )}
              </div>
            )}

            {/* RESUMEN TOTAL Y OBSERVACIONES DE ENTREGA */}
            <div style={{
              background: '#090d16',
              border: '1px solid #1e293b',
              borderRadius: '12px',
              padding: '0.9rem 1rem',
              marginBottom: '1rem'
            }}>
              {politicaEval.aplica && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    <span>Subtotal bruto:</span>
                    <span>{formatCurrency(politicaEval.subtotalBruto)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: '#34d399', fontWeight: 700, marginBottom: '0.35rem' }}>
                    <span>Bonificación por volumen ({politicaEval.porcentaje}%):</span>
                    <span>-{formatCurrency(politicaEval.montoDescuento)}</span>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1.05rem', fontWeight: 900, color: '#f8fafc' }}>
                <span>Total Final Estimado (c/IVA):</span>
                <span style={{ color: '#34d399', fontSize: '1.25rem' }}>{formatCurrency(politicaEval.totalEstimado)}</span>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.35rem' }}>
                📝 Observaciones para la entrega o administración de LAMDA (opcional):
              </label>
              <textarea
                rows={2}
                placeholder="Ej: Horario de recepción, indicaciones para el reparto..."
                value={observacionesAprobador}
                onChange={(e) => setObservacionesAprobador(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: '#090d16',
                  border: '1px solid #334155',
                  borderRadius: '10px',
                  padding: '0.6rem',
                  color: 'white',
                  fontSize: '0.82rem',
                  outline: 'none',
                  resize: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setMostrarCatalogoEnRevision(prev => !prev)}
                style={{
                  flex: 1,
                  minWidth: '200px',
                  background: 'rgba(124, 58, 237, 0.15)',
                  color: '#c084fc',
                  border: '1px solid rgba(124, 58, 237, 0.4)',
                  padding: '0.8rem 1rem',
                  borderRadius: '12px',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                {mostrarCatalogoEnRevision ? '🔼 Ocultar Catálogo de Artículos' : '➕ Agregar más artículos del catálogo'}
              </button>

              <button
                type="button"
                disabled={submitting || itemsArray.length === 0}
                onClick={handleAprobarYConfirmarPedidoOficial}
                style={{
                  flex: 2,
                  minWidth: '240px',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '0.85rem 1.25rem',
                  borderRadius: '12px',
                  fontSize: '0.95rem',
                  fontWeight: 900,
                  cursor: itemsArray.length > 0 ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 6px 20px rgba(16, 185, 129, 0.35)'
                }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={18} className="spinner" />
                    <span>Confirmando pedido...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={18} />
                    <span>✅ Aprobar y Confirmar Pedido a LAMDA</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* MODAL DE CONFIGURACIÓN DE IVA (CON IVA / SIN IVA) */}
      {showIvaModal && (
        <div className="b2b-iva-modal-backdrop" onClick={() => setShowIvaModal(false)}>
          <div className="b2b-iva-modal" onClick={(e) => e.stopPropagation()}>
            <div className="b2b-iva-modal-header">
              <h3 className="b2b-iva-modal-title">
                <Settings size={20} style={{ color: 'var(--accent-light)' }} />
                Modalidad de Precios
              </h3>
              <button 
                onClick={() => setShowIvaModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="b2b-iva-options-group">
              <div 
                className={`b2b-iva-option-card ${mostrarSinIva ? 'selected' : ''}`}
                onClick={() => { setMostrarSinIva(true); setShowIvaModal(false); }}
              >
                <input 
                  type="radio" 
                  name="iva_option_colab" 
                  checked={mostrarSinIva} 
                  onChange={() => { setMostrarSinIva(true); setShowIvaModal(false); }}
                  className="b2b-iva-radio"
                />
                <div style={{ flex: 1 }}>
                  <div className="b2b-iva-option-title">Precios sin IVA (Neto Gravado)</div>
                  <div className="b2b-iva-option-desc">Muestra los precios base netos y discrimina las alícuotas (21% y 10,5%) por ítem.</div>
                </div>
                {mostrarSinIva && <Check size={18} style={{ color: 'var(--accent-light)' }} />}
              </div>

              <div 
                className={`b2b-iva-option-card ${!mostrarSinIva ? 'selected' : ''}`}
                onClick={() => { setMostrarSinIva(false); setShowIvaModal(false); }}
              >
                <input 
                  type="radio" 
                  name="iva_option_colab" 
                  checked={!mostrarSinIva} 
                  onChange={() => { setMostrarSinIva(false); setShowIvaModal(false); }}
                  className="b2b-iva-radio"
                />
                <div style={{ flex: 1 }}>
                  <div className="b2b-iva-option-title">Precios con IVA Incluido (Final)</div>
                  <div className="b2b-iva-option-desc">Muestra los valores con su tasa impositiva correspondiente incorporada.</div>
                </div>
                {!mostrarSinIva && <Check size={18} style={{ color: 'var(--accent-light)' }} />}
              </div>
            </div>

            <button 
              className="btn-primary" 
              onClick={() => setShowIvaModal(false)}
              style={{ width: '100%' }}
            >
              Aplicar y Continuar
            </button>
          </div>
        </div>
      )}

      {/* CATÁLOGO JERÁRQUICO DE ARTÍCULOS (Idéntico a Articulos.jsx) */}
      {mostrarSeccionCatalogo && (
        <main style={{ padding: '0.75rem 1rem' }}>
          {hierarchicalData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3.5rem 1rem', border: '1px dashed var(--border-glass)', borderRadius: '12px', background: 'var(--bg-card)' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                No se encontraron artículos con los criterios seleccionados.
              </p>
              {search && (
                <button 
                  className="b2b-action-chip" 
                  onClick={() => setSearch('')}
                  style={{ margin: '0.5rem auto 0', display: 'inline-flex' }}
                >
                  Limpiar búsqueda
                </button>
              )}
            </div>
          ) : (
            <div className="b2b-familias-accordion-container">
              {/* Solapa Especial / Acordeón de Ofertas Activas */}
              {ofertasVisiblesEnSolapa.length > 0 && !filtroOfertas && (
                <div 
                  className={`b2b-familia-card ${isOfertasOpen ? 'open' : ''}`}
                  style={{ 
                    border: '1.5px solid rgba(245, 158, 11, 0.45)', 
                    background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 23, 42, 0.85) 100%)'
                  }}
                >
                  <div 
                    className="b2b-familia-header"
                    onClick={() => setIsOfertasOpen(prev => !prev)}
                    style={{ 
                      borderLeft: '3px solid #f59e0b',
                      background: isOfertasOpen ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.04)'
                    }}
                  >
                    <div className="b2b-familia-title-group">
                      <div className="b2b-accordion-chevron" style={{ color: '#f59e0b' }}>
                        {isOfertasOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </div>
                      <span style={{ fontSize: '1rem', lineHeight: 1 }}>🔥</span>
                      <h2 className="b2b-familia-name" style={{ color: '#fbbf24' }}>
                        Ofertas Activas
                      </h2>
                      <span 
                        className="b2b-count-badge" 
                        style={{ 
                          background: 'rgba(245, 158, 11, 0.2)', 
                          color: '#fbbf24', 
                          border: '1px solid rgba(245, 158, 11, 0.45)', 
                          marginLeft: 'auto'
                        }}
                      >
                        {ofertasVisiblesEnSolapa.length} {ofertasVisiblesEnSolapa.length === 1 ? 'artículo' : 'artículos'}
                      </span>
                    </div>
                  </div>

                  {isOfertasOpen && (
                    <div className="b2b-familia-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', padding: '0.5rem 0.6rem 0.75rem' }}>
                      {resumenOfertasActivas.map(ofr => (
                        <div 
                          key={ofr.oferta_id} 
                          style={{
                            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(15, 23, 42, 0.95) 100%)',
                            border: '1px solid rgba(245, 158, 11, 0.35)',
                            borderRadius: '8px',
                            padding: '0.65rem 0.85rem'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                            <span style={{ fontWeight: '700', color: '#fbbf24', fontSize: '0.88rem' }}>
                              🏷️ {ofr.titulo || 'Promoción Activa'}
                            </span>
                            <span style={{
                              background: 'rgba(245, 158, 11, 0.2)',
                              color: '#fbbf24',
                              border: '1px solid rgba(245, 158, 11, 0.45)',
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontWeight: '700',
                              fontSize: '0.74rem'
                            }}>
                              {ofr.descuento_porcentaje}% OFF
                            </span>
                          </div>
                          {ofr.descripcion && (
                            <p style={{ margin: '0.3rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                              {ofr.descripcion}
                            </p>
                          )}
                        </div>
                      ))}

                      <div className="b2b-articulos-subgrid">
                        {ofertasVisiblesEnSolapa.map(renderProductCard)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {hierarchicalData.map(familia => {
                const isFamOpen = expandedFamilias.has(familia.key);

                return (
                  <div key={familia.key} className={`b2b-familia-card ${isFamOpen ? 'open' : ''}`}>
                    <div 
                      className="b2b-familia-header"
                      onClick={() => toggleFamilia(familia.key)}
                    >
                      <div className="b2b-familia-title-group">
                        <div className="b2b-accordion-chevron">
                          {isFamOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </div>
                        <h2 className="b2b-familia-name">{familia.nombre}</h2>
                        <span className="b2b-count-badge">
                          {familia.totalProductos} {familia.totalProductos === 1 ? 'artículo' : 'artículos'}
                        </span>
                      </div>
                    </div>

                    {isFamOpen && (
                      <div className="b2b-familia-body">
                        {familia.atributos.map(atributo => {
                          const isAtOpen = expandedAtributos.has(atributo.key);

                          return (
                            <div key={atributo.key} className={`b2b-atributo-group ${isAtOpen ? 'open' : ''}`}>
                              <div 
                                className="b2b-atributo-header"
                                onClick={() => toggleAtributo(atributo.key)}
                              >
                                <div className="b2b-atributo-title-group">
                                  <div className="b2b-accordion-chevron sub">
                                    {isAtOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                  </div>
                                  <h3 className="b2b-atributo-name">{atributo.nombre}</h3>
                                  <span className="b2b-count-badge sub">
                                    {atributo.productos.length}
                                  </span>
                                </div>
                              </div>

                              {isAtOpen && (
                                atributo.hasSubcategorias ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.35rem', background: 'rgba(0,0,0,0.15)', borderTop: '1px solid var(--border-glass)' }}>
                                    {atributo.subcategorias.map(subcat => {
                                      const isSubOpen = expandedSubcategorias.has(subcat.key);

                                      return (
                                        <div key={subcat.key} className={`b2b-subcategoria-card ${isSubOpen ? 'open' : ''}`}>
                                          <div 
                                            className="b2b-subcategoria-header"
                                            onClick={() => toggleSubcategoria(subcat.key)}
                                          >
                                            <div className="b2b-subcategoria-title-group">
                                              <div className="b2b-accordion-chevron sub3">
                                                {isSubOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                              </div>
                                              <h4 className="b2b-subcategoria-name">{subcat.nombre}</h4>
                                              <span className="b2b-count-badge sub3">
                                                {subcat.productos.length}
                                              </span>
                                            </div>
                                          </div>

                                          {isSubOpen && (
                                            subcat.hasSubSubcategorias ? (
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', padding: '0.3rem', background: 'rgba(0,0,0,0.2)' }}>
                                                {subcat.subSubcategorias.map(subsub => {
                                                  const isSubSubOpen = expandedSubSubcategorias.has(subsub.key);

                                                  return (
                                                    <div key={subsub.key} className={`b2b-subsubcategoria-card ${isSubSubOpen ? 'open' : ''}`}>
                                                      <div 
                                                        className="b2b-subsubcategoria-header"
                                                        onClick={() => toggleSubSubcategoria(subsub.key)}
                                                      >
                                                        <div className="b2b-subsubcategoria-title-group">
                                                          <div className="b2b-accordion-chevron sub4">
                                                            {isSubSubOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                          </div>
                                                          <h5 className="b2b-subsubcategoria-name">{subsub.nombre}</h5>
                                                          <span className="b2b-count-badge sub4">
                                                            {subsub.productos.length}
                                                          </span>
                                                        </div>
                                                      </div>

                                                      {isSubSubOpen && (
                                                        subsub.hasSubSubSubcategorias ? (
                                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem', padding: '0.25rem', background: 'rgba(0,0,0,0.25)' }}>
                                                            {subsub.subSubSubcategorias.map(subsubsub => {
                                                              const isSubSubSubOpen = expandedSubSubSubcategorias.has(subsubsub.key);

                                                              return (
                                                                <div key={subsubsub.key} className={`b2b-subsubsubcategoria-card ${isSubSubSubOpen ? 'open' : ''}`}>
                                                                  <div 
                                                                    className="b2b-subsubsubcategoria-header"
                                                                    onClick={() => toggleSubSubSubcategoria(subsubsub.key)}
                                                                  >
                                                                    <div className="b2b-subsubsubcategoria-title-group">
                                                                      <div className="b2b-accordion-chevron sub5">
                                                                        {isSubSubSubOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                                                                      </div>
                                                                      <h6 className="b2b-subsubsubcategoria-name">{subsubsub.nombre}</h6>
                                                                      <span className="b2b-count-badge sub5">
                                                                        {subsubsub.productos.length}
                                                                      </span>
                                                                    </div>
                                                                  </div>

                                                                  {isSubSubSubOpen && (
                                                                    <div className="b2b-articulos-subgrid">
                                                                      {subsubsub.productos.map(renderProductCard)}
                                                                    </div>
                                                                  )}
                                                                </div>
                                                              );
                                                            })}
                                                          </div>
                                                        ) : (
                                                          <div className="b2b-articulos-subgrid">
                                                            {subsub.productos.map(renderProductCard)}
                                                          </div>
                                                        )
                                                      )}
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            ) : (
                                              <div className="b2b-articulos-subgrid">
                                                {subcat.productos.map(renderProductCard)}
                                              </div>
                                            )
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div className="b2b-articulos-subgrid">
                                    {atributo.productos.map(renderProductCard)}
                                  </div>
                                )
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* BARRA FLOTANTE INFERIOR EN MODO ARMADO (CON INDICADOR DE BONIFICACIÓN POR VOLUMEN) */}
      {modo === 'armado' && totalArticulosDiferentes > 0 && (
        <footer style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'rgba(15, 23, 42, 0.96)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(124, 58, 237, 0.45)',
          padding: '0.65rem 1rem',
          zIndex: 990,
          boxShadow: '0 -10px 25px rgba(0,0,0,0.5)'
        }}>
          {politicaComercial && delegacion?.mostrar_precios && (
            <div style={{
              fontSize: '0.73rem',
              marginBottom: '0.4rem',
              color: politicaEval.aplica ? '#34d399' : '#fbbf24',
              fontWeight: 700
            }}>
              {politicaEval.aplica
                ? `🎉 Bonificación por volumen del ${politicaEval.porcentaje}% aplicada (-${formatCurrency(politicaEval.montoDescuento)})`
                : `💡 Sumando ${formatCurrency(politicaEval.faltaParaProximo)} más aplica ${politicaEval.proximoPorcentaje}% de descuento por volumen`}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.66rem', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800 }}>
                Pre-Pedido (Sujeto a Aprobación)
              </div>
              <div style={{ fontSize: '0.96rem', fontWeight: 900, color: '#34d399' }}>
                {totalArticulosDiferentes} artículo{totalArticulosDiferentes > 1 ? 's' : ''} ({totalUnidades} u.)
              </div>
              {delegacion?.mostrar_precios && politicaEval.totalEstimado > 0 && (
                <div style={{ fontSize: '0.76rem', color: '#cbd5e1', fontWeight: 700 }}>
                  Total est.: {formatCurrency(politicaEval.totalEstimado)} (c/IVA)
                </div>
              )}
            </div>

            <button
              onClick={() => setShowConfirmModal(true)}
              style={{
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.15rem',
                borderRadius: '12px',
                fontSize: '0.88rem',
                fontWeight: 900,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: '0 4px 15px rgba(16, 185, 129, 0.35)'
              }}
            >
              <span>Revisar y Enviar para Aprobación</span>
              <Send size={16} />
            </button>
          </div>
        </footer>
      )}

      {/* MODAL DE REVISIÓN Y ENVÍO DEL COLABORADOR (MODO ARMADO) */}
      {showConfirmModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.82)',
          backdropFilter: 'blur(8px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '480px',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '1.25rem',
            boxShadow: '0 25px 50px rgba(0,0,0,0.7)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900, color: '#f8fafc' }}>
                  📤 Enviar Pre-Pedido para Aprobación
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#c084fc' }}>
                  Para revisión de {delegacion?.aprobador_nombre || `la administración de ${delegacion?.nombre_empresa}`}
                </span>
              </div>
              <button
                onClick={() => setShowConfirmModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '10px',
              padding: '0.55rem 0.75rem',
              fontSize: '0.76rem',
              color: '#fde68a',
              marginBottom: '0.85rem',
              lineHeight: '1.4'
            }}>
              ℹ️ <strong>Importante:</strong> Al continuar se generará el enlace de revisión para que envíes por WhatsApp a quien aprueba las compras. El pedido no se confirma ante LAMDA hasta que sea aprobado.
            </div>

            {/* LISTA DE ÍTEMS CON CONTROLES DE EDICIÓN RÁPIDA */}
            <div style={{
              background: '#090d16',
              border: '1px solid #1e293b',
              borderRadius: '12px',
              maxHeight: '220px',
              overflowY: 'auto',
              padding: '0.5rem 0.75rem',
              marginBottom: '0.85rem'
            }}>
              {itemsArray.map(it => {
                const cod = (it.producto.producto_codigo || '').trim();
                return (
                  <div
                    key={cod}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.45rem 0',
                      borderBottom: '1px dashed rgba(255,255,255,0.06)',
                      fontSize: '0.82rem'
                    }}
                  >
                    <div style={{ flex: 1, paddingRight: '0.4rem' }}>
                      <div style={{ color: '#f8fafc', fontWeight: 600 }}>
                        {it.producto.producto_descripcion}
                      </div>
                      {delegacion?.mostrar_precios && (
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                          {formatCurrency(parseFloat(it.producto.precio_final || 0) * it.cantidad)}
                        </div>
                      )}
                    </div>
                    <div className="quantity-controls">
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={() => cambiarCantidad(it.producto, -1)}
                      >
                        <Minus size={12} />
                      </button>
                      <span className="qty-value">{it.cantidad}</span>
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={() => cambiarCantidad(it.producto, 1)}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {delegacion?.mostrar_precios && (
              <div style={{
                background: '#090d16',
                border: '1px solid #1e293b',
                borderRadius: '10px',
                padding: '0.65rem 0.85rem',
                marginBottom: '0.85rem',
                fontSize: '0.82rem'
              }}>
                {politicaEval.aplica && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#34d399', marginBottom: '0.25rem', fontWeight: 700 }}>
                    <span>Bonificación por volumen ({politicaEval.porcentaje}%):</span>
                    <span>-{formatCurrency(politicaEval.montoDescuento)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, color: '#f8fafc', fontSize: '0.92rem' }}>
                  <span>Total Estimado (c/IVA):</span>
                  <span style={{ color: '#34d399' }}>{formatCurrency(politicaEval.totalEstimado)}</span>
                </div>
              </div>
            )}

            {/* NOTA OPCIONAL DEL COLABORADOR */}
            <div style={{ marginBottom: '1.15rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.35rem' }}>
                📝 Mensaje o comentario para quien aprueba el pedido (opcional):
              </label>
              <textarea
                rows={3}
                placeholder="Ej: Indicar urgencias, faltantes en depósito o sugerencias para este pedido..."
                value={notaColaborador}
                onChange={(e) => setNotaColaborador(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: '#090d16',
                  border: '1px solid #334155',
                  borderRadius: '10px',
                  padding: '0.65rem',
                  color: 'white',
                  fontSize: '0.82rem',
                  outline: 'none',
                  resize: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => setShowConfirmModal(false)}
                style={{
                  flex: 1,
                  background: '#334155',
                  color: '#cbd5e1',
                  border: 'none',
                  padding: '0.75rem',
                  borderRadius: '10px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                Seguir editando
              </button>
              <button
                onClick={handleConfirmarEnvioPrepedido}
                disabled={submitting || itemsArray.length === 0}
                style={{
                  flex: 2,
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem',
                  borderRadius: '10px',
                  fontWeight: 900,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)'
                }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="spinner" />
                    <span>Generando envío...</span>
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    <span>Guardar y Preparar WhatsApp</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visor de Inspección Visual de Partida en Depósito */}
      <InspeccionPartidaModal
        isOpen={Boolean(modalPartidaCtx)}
        onClose={() => setModalPartidaCtx(null)}
        product={modalPartidaCtx?.product}
        infoPartida={modalPartidaCtx?.infoPartida}
        currentQty={
          modalPartidaCtx?.product
            ? (selectedItems[(modalPartidaCtx.product.producto_codigo || '').trim()]?.cantidad || 0)
            : 0
        }
        onChangeQty={(newQty) => {
          if (modalPartidaCtx?.product) {
            const cod = (modalPartidaCtx.product.producto_codigo || '').trim();
            const current = selectedItems[cod]?.cantidad || 0;
            cambiarCantidad(modalPartidaCtx.product, Math.max(0, newQty) - current);
          }
        }}
        displayPrecioBulto={modalPartidaCtx?.displayPrecioBulto}
        displayPrecioKilo={modalPartidaCtx?.displayPrecioKilo}
        esModoNeto={modalPartidaCtx?.esModoNeto}
        mostrarPrecios={Boolean(delegacion?.mostrar_precios)}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}
