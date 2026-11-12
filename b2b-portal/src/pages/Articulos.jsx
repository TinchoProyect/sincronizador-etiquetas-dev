import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  Loader2, 
  AlertCircle, 
  Plus, 
  Minus, 
  Trash2, 
  ShoppingBag, 
  ChevronDown, 
  ChevronRight,
  Info,
  X,
  Settings,
  Check,
  Star
} from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../supabaseClient';
import { getCache, setCache } from '../utils/cacheStore';
import { registrarAccesoTelemetria } from '../utils/telemetria';
import { fetchPoliticaB2B, evaluarPoliticaB2B, fetchOfertasB2B } from '../utils/politicasB2B';
import { InspeccionPartidaModal, fetchMapaFotosLotesB2B } from '../components/InspeccionPartidaModal';
import {
  DesgloseIngredientesModal,
  BotonVerIngredientesB2B,
  fetchMapaIngredientesComercialesB2B,
  resolverInfoIngredientesProductoB2B
} from '../components/DesgloseIngredientesModal';

export default function Articulos({ 
  profile, 
  cart = [], 
  addToCart, 
  removeFromCart, 
  toggleKitInCart,
  clearCart, 
  setCurrentTab,
  onCanToggleIvaChanged,
  openIvaModalTrigger
}) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [hasNoLists, setHasNoLists] = useState(false);
  const [showSearchHelp, setShowSearchHelp] = useState(false);
  const [showMobileCartSheet, setShowMobileCartSheet] = useState(false);

  // Kits de Insumos Externos (UP / Colaborador) - Exclusivo por Usuario/Perfil
  const puedeUsarKits = Boolean(
    profile?.habilitar_kits_produccion || 
    (Array.isArray(profile?.permisos) && profile.permisos.includes('habilitar_kits_produccion')) ||
    profile?.cliente_id === 'CB-0006'
  );
  const [articulosKits, setArticulosKits] = useState(() => new Map());
  const [selectedKits, setSelectedKits] = useState({});

  // Estados para Artículos Habituales / Favoritos
  const [articulosHabituales, setArticulosHabituales] = useState(() => new Map());
  const [filtroFavoritos, setFiltroFavoritos] = useState(false);
  const [filtroOfertas, setFiltroOfertas] = useState(false);
  const [isOfertasOpen, setIsOfertasOpen] = useState(false);

  // Estados para configuración de Modalidad de IVA condicional por lista
  const [canToggleIva, setCanToggleIva] = useState(false);
  // Predeterminado: Sin IVA (Neto) si no se configuró explícitamente otra cosa
  const [mostrarSinIva, setMostrarSinIva] = useState(() => {
    const saved = localStorage.getItem('b2b_mostrar_sin_iva');
    if (saved !== null) {
      return saved === 'true';
    }
    return true; // Predeterminado: Sin IVA (Neto)
  });
  const [showIvaModal, setShowIvaModal] = useState(false);

  // Estados de acordeones colapsables para los 5 Niveles Jerárquicos
  const [expandedFamilias, setExpandedFamilias] = useState(() => new Set());
  const [expandedAtributos, setExpandedAtributos] = useState(() => new Set());
  const [expandedSubcategorias, setExpandedSubcategorias] = useState(() => new Set());
  const [expandedSubSubcategorias, setExpandedSubSubcategorias] = useState(() => new Set());
  const [expandedSubSubSubcategorias, setExpandedSubSubSubcategorias] = useState(() => new Set());
  const [politicaComercial, setPoliticaComercial] = useState(null);
  const [ofertasActivas, setOfertasActivas] = useState({});
  const [mapaFotosLotes, setMapaFotosLotes] = useState({});
  const [modalPartidaCtx, setModalPartidaCtx] = useState(null);
  const [mapaIngredientesComerciales, setMapaIngredientesComerciales] = useState({});
  const [modalIngredientesCtx, setModalIngredientesCtx] = useState(null);

  useEffect(() => {
    fetchMapaFotosLotesB2B().then(mapa => setMapaFotosLotes(mapa || {}));
    fetchMapaIngredientesComercialesB2B().then(mapa => setMapaIngredientesComerciales(mapa || {}));
    if (profile?.cliente_id && profile.cliente_id !== 'LAB-DEMO') {
      fetchPoliticaB2B(profile).then(pol => setPoliticaComercial(pol));
      fetchOfertasB2B(profile).then(ofrs => setOfertasActivas(ofrs || {}));
    }
  }, [profile]);

  const articulosEnOferta = useMemo(() => {
    if (!ofertasActivas || Object.keys(ofertasActivas).length === 0) return [];
    return products.filter(p => {
      const cod = (p.producto_codigo || '').trim();
      return !!ofertasActivas[cod];
    });
  }, [products, ofertasActivas]);

  const politicaEval = useMemo(() => {
    return evaluarPoliticaB2B(politicaComercial, cart, profile);
  }, [politicaComercial, cart, profile]);

  // Permiso para ver stock enriquecido (🟢 / 🔵 / ⚪)
  // La fuente de verdad estricta es la presencia de 'ver_stock' en el array de permisos
  const canViewStock = Boolean(
    Array.isArray(profile?.permisos) 
      ? profile.permisos.includes('ver_stock') 
      : profile?.ver_stock === true
  );

  useEffect(() => {
    fetchCatalogo();
    if (profile?.cliente_id !== 'LAB-DEMO') {
      const clientIdent = profile?.nombre_empresa || profile?.nombre_completo || profile?.email || (profile?.cliente_id ? `Cliente ${profile.cliente_id}` : null);
      registrarAccesoTelemetria('Navegación de Catálogo y Precios', clientIdent, { dedupeMs: 15000 });
    }
  }, [profile?.cliente_id]);

  // Abrir modal de IVA cuando se toca la tuerquita del encabezado móvil
  useEffect(() => {
    if (openIvaModalTrigger > 0) {
      setShowIvaModal(true);
    }
  }, [openIvaModalTrigger]);

  const toggleModalidadIva = (sinIva) => {
    setMostrarSinIva(sinIva);
    localStorage.setItem('b2b_mostrar_sin_iva', sinIva ? 'true' : 'false');
    setShowIvaModal(false);
    registrarAccesoTelemetria(`⚙️ Cambió vista de precios: ${sinIva ? 'Sin IVA (Neto)' : 'Con IVA (Final)'}`, profile);
  };

  const fetchCatalogo = async () => {
    const cacheKey = `catalogo_${profile?.id || 'guest'}`;
    const cachedProducts = getCache(cacheKey);
    if (cachedProducts && cachedProducts.length > 0) {
      setProducts(cachedProducts);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const hostActual = typeof window !== 'undefined' ? String(window.location.hostname || '').toLowerCase() : '';
      const esLocalHost = hostActual === 'localhost' || hostActual === '127.0.0.1' || hostActual.startsWith('192.168.') || hostActual.startsWith('10.') || hostActual.startsWith('100.');
      if (esLocalHost && (profile?.cliente_id === 'LAB-DEMO' || String(window.location.pathname || '').toLowerCase().includes('/catalogo') || String(window.location.search || '').includes('lab=1'))) {
        const respLab = await fetch('/api/produccion/catalogo/b2b-preview-lab', { cache: 'no-store' });
        const jsonLab = await respLab.json();
        if (respLab.ok && jsonLab?.ok && Array.isArray(jsonLab.catalogo)) {
          setHasNoLists(false);
          setCanToggleIva(true);
          if (onCanToggleIvaChanged) onCanToggleIvaChanged(true);
          setProducts(jsonLab.catalogo);
          setLoading(false);
          return;
        }
      }

      // 1. Obtener la asignación de listas, prioridad y permiso de toggle de IVA del cliente
      const { data: rawUserLists, error: listsError } = await supabase
        .from('clientes_b2b_perfiles_listas')
        .select('lista_id, es_principal, permitir_toggle_iva, fecha_inicio');

      if (listsError) throw listsError;

      // Filtrar lista_id = 1 insertada por el trigger por defecto si el cliente ya tiene listas reales sincronizadas desde Búnker (fecha_inicio === null)
      const hasRealBunkerLists = (rawUserLists || []).some(ul => ul.fecha_inicio === null);
      const userLists = hasRealBunkerLists
        ? (rawUserLists || []).filter(ul => !(ul.lista_id === 1 && ul.fecha_inicio !== null))
        : (rawUserLists || []);

      // Si el cliente no tiene ninguna lista asignada, se bloquea el catálogo
      if (!userLists || userLists.length === 0) {
        setProducts([]);
        setHasNoLists(true);
        setLoading(false);
        return;
      }

      setHasNoLists(false);

      // Determinar si alguna de las listas asignadas permite la ruedita de IVA
      const permiteIva = userLists.some(ul => ul.permitir_toggle_iva === true);
      setCanToggleIva(permiteIva);
      if (onCanToggleIvaChanged) {
        onCanToggleIvaChanged(permiteIva);
      }

      const listIds = userLists.map(ul => ul.lista_id);
      const listPriorityMap = new Map();
      for (const ul of userLists) {
        listPriorityMap.set(ul.lista_id, ul.es_principal ? 1 : 2);
      }

      // 2. Obtener precios del catálogo filtrados estrictamente por las listas asignadas
      let { data, error: fetchError } = await supabase
        .from('clientes_b2b_catalogo_precios')
        .select('producto_codigo, producto_descripcion, precio_final, kilos_unidad, precio_kilo, iva_porcentaje, precio_neto, precio_kilo_neto, lista_id, rubro, sub_rubro, familia, articulo_principal, sub_categoria, sub_sub_categoria, sub_sub_sub_categoria, stock_disponible, stock_estado, busqueda_metadata')
        .in('lista_id', listIds)
        .order('producto_descripcion', { ascending: true });

      // Fallback si la columna stock_estado aún no está en Supabase
      if (fetchError && fetchError.message && fetchError.message.includes('stock_estado')) {
        const fallbackRes = await supabase
          .from('clientes_b2b_catalogo_precios')
          .select('producto_codigo, producto_descripcion, precio_final, kilos_unidad, precio_kilo, iva_porcentaje, precio_neto, precio_kilo_neto, lista_id, rubro, sub_rubro, familia, articulo_principal, sub_categoria, sub_sub_categoria, sub_sub_sub_categoria, stock_disponible, busqueda_metadata')
          .in('lista_id', listIds)
          .order('producto_descripcion', { ascending: true });
        data = fallbackRes.data;
        fetchError = fallbackRes.error;
      }

      if (fetchError) throw fetchError;

      const prodMap = new Map();
      for (const item of data || []) {
        const existing = prodMap.get(item.producto_codigo);
        const itemPrice = parseFloat(item.precio_final);
        
        if (!existing) {
          prodMap.set(item.producto_codigo, { ...item });
        } else {
          const existingPrice = parseFloat(existing.precio_final);
          const existingPriority = listPriorityMap.get(existing.lista_id) || 0;
          const itemPriority = listPriorityMap.get(item.lista_id) || 0;

          let shouldUpdatePrice = false;
          if (existingPrice <= 0 && itemPrice > 0) {
            shouldUpdatePrice = true;
          } else if (itemPrice > 0) {
            if (itemPriority > existingPriority) {
              shouldUpdatePrice = true;
            } else if (itemPriority === existingPriority) {
              if (itemPrice < existingPrice) {
                shouldUpdatePrice = true;
              }
            }
          }

          if (shouldUpdatePrice) {
            existing.precio_final = item.precio_final;
            existing.precio_kilo = item.precio_kilo;
            existing.precio_neto = item.precio_neto;
            existing.precio_kilo_neto = item.precio_kilo_neto;
            existing.iva_porcentaje = item.iva_porcentaje;
            existing.kilos_unidad = item.kilos_unidad;
            existing.lista_id = item.lista_id;
          }

          // Consolidación de stock inteligente multi-lista
          const exStock = parseFloat(existing.stock_disponible || 0);
          const itStock = parseFloat(item.stock_disponible || 0);

          if (exStock > 0 || itStock > 0) {
            existing.stock_disponible = Math.max(Math.max(0, exStock), Math.max(0, itStock));
            existing.stock_estado = 'disponible';
          } else if (exStock < 0 || itStock < 0) {
            const potEx = Math.abs(exStock);
            const potIt = Math.abs(itStock);
            existing.stock_disponible = -Math.max(potEx, potIt);
            existing.stock_estado = 'requiere_produccion';
          } else {
            existing.stock_disponible = 0;
            existing.stock_estado = existing.stock_estado || item.stock_estado || 'sin_stock';
          }
        }
      }

      const finalProds = Array.from(prodMap.values());
      setCache(cacheKey, finalProds, 300);
      setProducts(finalProds);

      // 3. Obtener artículos habituales / favoritos del cliente
      try {
        let habQuery = supabase
          .from('clientes_b2b_articulos_habituales')
          .select('producto_codigo, frecuencia_compra, ultima_compra');
        
        if (profile?.cliente_id) {
          habQuery = habQuery.eq('cliente_id', profile.cliente_id);
        }

        const { data: habData, error: habErr } = await habQuery;
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
        console.warn('⚠️ No se pudieron cargar favoritos:', habEx.message);
      }

      // 4. Cargar definición de kits de insumos si el usuario tiene permiso (ej: Matías)
      if (puedeUsarKits) {
        try {
          const { data: kitsData } = await supabase
            .from('clientes_b2b_articulos_kits')
            .select('*')
            .eq('activo', true);

          const kMap = new Map();
          for (const k of (kitsData || [])) {
            const list = kMap.get(k.producto_codigo) || [];
            list.push(k);
            kMap.set(k.producto_codigo, list);
          }
          setArticulosKits(kMap);
        } catch (errKits) {
          console.warn('⚠️ [KITS] Error cargando kits de insumos:', errKits);
        }
      } else {
        setArticulosKits(new Map());
      }

    } catch (err) {
      console.error('Error al cargar artículos:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Sincronizar estado inicial de selectedKits con el carrito activo
  useEffect(() => {
    if (!puedeUsarKits) return;
    const initialSelected = {};
    for (const item of cart) {
      if (item.kit_parent) {
        initialSelected[item.kit_parent] = true;
      }
    }
    setSelectedKits(prev => ({ ...prev, ...initialSelected }));
  }, [cart, puedeUsarKits]);

  const handleToggleKit = (product, isChecked) => {
    const pCode = (product.producto_codigo || '').trim();
    setSelectedKits(prev => ({
      ...prev,
      [pCode]: isChecked
    }));

    const kitList = articulosKits.get(pCode) || [];
    if (typeof toggleKitInCart === 'function') {
      toggleKitInCart(pCode, isChecked, kitList);
    }
  };

  // Normalización de nombres de Familia y Atributo Principal
  const getNormalizedFamilia = (product) => {
    const f = product.familia?.trim() || product.rubro?.trim();
    return f && f !== '' ? f : 'General';
  };

  const getNormalizedAtributoPrincipal = (product) => {
    const ap = product.articulo_principal?.trim() || product.sub_rubro?.trim() || product.producto_descripcion?.trim();
    return ap && ap !== '' ? ap : 'General';
  };

  // Ordenamiento de mayor a menor presentación (kilos_unidad DESC)
  const sortProductsByKilos = (prods) => {
    return [...prods].sort((a, b) => {
      const kA = parseFloat(a.kilos_unidad || 0);
      const kB = parseFloat(b.kilos_unidad || 0);
      if (kB !== kA) return kB - kA; // Mayor presentación primero (ej: 25kg, 10kg, 5kg, 2kg, 1kg, 300g)
      return a.producto_descripcion.localeCompare(b.producto_descripcion, 'es', { sensitivity: 'base' });
    });
  };

  // Motor de Búsqueda Universal LAMDA
  const searchTerms = useMemo(() => {
    return search
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/)
      .filter(Boolean);
  }, [search]);

  const toggleFiltroFavoritos = () => {
    if (!filtroFavoritos && articulosHabituales.size === 0) {
      Swal.fire({
        title: 'Sin Compras Previas',
        text: 'Aún no registrás un historial de compras para sugerir artículos habituales.',
        icon: 'info',
        confirmButtonColor: '#8e4785',
        confirmButtonText: 'Entendido'
      });
      return;
    }
    const nextState = !filtroFavoritos;
    setFiltroFavoritos(nextState);
    if (nextState) {
      registrarAccesoTelemetria('⭐ Filtró por Sus Artículos Habituales', profile);
    }
  };

  // Filtrado de productos
  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      // Filtro de Ofertas y Promociones
      if (filtroOfertas) {
        const codExacto = (product.producto_codigo || '').trim();
        if (!ofertasActivas[codExacto]) {
          return false;
        }
      }

      // Filtro determinista de Favoritos / Habituales
      if (filtroFavoritos) {
        const cleanCod = (product.producto_codigo || '').toLowerCase().trim();
        if (!articulosHabituales.has(cleanCod)) {
          return false;
        }
      }

      if (searchTerms.length > 0) {
        const infoIng = resolverInfoIngredientesProductoB2B(product, mapaIngredientesComerciales);
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
          product.busqueda_metadata || '',
          infoIng ? infoIng.ingredientes.join(' ') : ''
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
  }, [products, searchTerms, filtroFavoritos, filtroOfertas, articulosHabituales, ofertasActivas, mapaIngredientesComerciales]);

  // Ofertas dinámicas activas que coinciden con la búsqueda actual para la Solapa Especial
  const ofertasVisiblesEnSolapa = useMemo(() => {
    if (!articulosEnOferta.length) return [];
    if (searchTerms.length === 0) return articulosEnOferta;
    return articulosEnOferta.filter(product => {
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

      return searchTerms.every(term => fullSearchableText.includes(term));
    });
  }, [articulosEnOferta, searchTerms]);

  // Resumen de ofertas únicas visibles para mostrar reglas comerciales (vigencia y cuota)
  const resumenOfertasActivas = useMemo(() => {
    if (!ofertasVisiblesEnSolapa || ofertasVisiblesEnSolapa.length === 0) return [];
    const mapOfr = new Map();
    for (const prod of ofertasVisiblesEnSolapa) {
      const cod = (prod.producto_codigo || '').trim();
      const ofr = ofertasActivas[cod];
      if (ofr && !mapOfr.has(ofr.oferta_id)) {
        mapOfr.set(ofr.oferta_id, ofr);
      }
    }
    return Array.from(mapOfr.values());
  }, [ofertasVisiblesEnSolapa, ofertasActivas]);

  // Agrupamiento Jerárquico en 5 Niveles con resiliencia Case-Insensitive y ordenamiento por Kilos
  const hierarchicalData = useMemo(() => {
    const famMap = new Map(); // famKey -> { nombre, atMap }

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
            // Nivel 3: Subcategorías
            const subMap = new Map(); // subKey -> { nombre, subProds }
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
                  // Nivel 4: Sub-subcategorías
                  const subSubMap = new Map(); // subSubKey -> { nombre, subSubProds }
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
                        // Nivel 5: Sub-sub-subcategorías
                        const subSubSubMap = new Map(); // subSubSubKey -> { nombre, subSubSubProds }
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

  // Mantener las acordeones plegadas al utilizar el buscador superior para facilitar la navegación en móvil y escritorio
  useEffect(() => {
    setExpandedFamilias(new Set());
    setExpandedAtributos(new Set());
    setExpandedSubcategorias(new Set());
    setExpandedSubSubcategorias(new Set());
    setExpandedSubSubSubcategorias(new Set());
  }, [search]);

  // Telemetría de búsqueda en catálogo (con debounce para registrar término real buscado)
  useEffect(() => {
    const cleanQ = (search || '').trim();
    if (cleanQ.length < 2) return;
    const timer = setTimeout(() => {
      registrarAccesoTelemetria(`🔍 Buscó en catálogo: "${cleanQ}" (${filteredProducts.length} art.)`, profile, { dedupeMs: 3000 });
    }, 1200);
    return () => clearTimeout(timer);
  }, [search, filteredProducts.length]);

  const formatHierarchyKeyLabel = (rawKey) => {
    if (!rawKey) return '';
    return String(rawKey)
      .split('___')
      .filter(Boolean)
      .map(part => part.trim().replace(/\b\w/g, c => c.toUpperCase()))
      .join(' ➔ ');
  };

  const toggleFamilia = (famKey) => {
    if (!expandedFamilias.has(famKey)) {
      registrarAccesoTelemetria(`📂 Exploró Familia: ${formatHierarchyKeyLabel(famKey)}`, profile, { dedupeMs: 2500 });
    }
    setExpandedFamilias(prev => {
      const next = new Set(prev);
      if (next.has(famKey)) next.delete(famKey);
      else next.add(famKey);
      return next;
    });
  };

  const toggleAtributo = (atKey) => {
    if (!expandedAtributos.has(atKey)) {
      registrarAccesoTelemetria(`🏷️ Miró Artículo: ${formatHierarchyKeyLabel(atKey)}`, profile, { dedupeMs: 2500 });
    }
    setExpandedAtributos(prev => {
      const next = new Set(prev);
      if (next.has(atKey)) next.delete(atKey);
      else next.add(atKey);
      return next;
    });
  };

  const toggleSubcategoria = (subKey) => {
    if (!expandedSubcategorias.has(subKey)) {
      registrarAccesoTelemetria(`🔎 Miró Variedad: ${formatHierarchyKeyLabel(subKey)}`, profile, { dedupeMs: 2500 });
    }
    setExpandedSubcategorias(prev => {
      const next = new Set(prev);
      if (next.has(subKey)) next.delete(subKey);
      else next.add(subKey);
      return next;
    });
  };

  const toggleSubSubcategoria = (subSubKey) => {
    if (!expandedSubSubcategorias.has(subSubKey)) {
      registrarAccesoTelemetria(`🔎 Miró Variedad: ${formatHierarchyKeyLabel(subSubKey)}`, profile, { dedupeMs: 2500 });
    }
    setExpandedSubSubcategorias(prev => {
      const next = new Set(prev);
      if (next.has(subSubKey)) next.delete(subSubKey);
      else next.add(subSubKey);
      return next;
    });
  };

  const toggleSubSubSubcategoria = (subSubSubKey) => {
    if (!expandedSubSubSubcategorias.has(subSubSubKey)) {
      registrarAccesoTelemetria(`🔎 Miró Variedad: ${formatHierarchyKeyLabel(subSubSubKey)}`, profile, { dedupeMs: 2500 });
    }
    setExpandedSubSubSubcategorias(prev => {
      const next = new Set(prev);
      if (next.has(subSubSubKey)) next.delete(subSubSubKey);
      else next.add(subSubSubKey);
      return next;
    });
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS'
    }).format(val);
  };

  const cartTotal = cart.reduce((acc, item) => acc + item.subtotal, 0);

  // Renderizador de Ficha de Producto con Modalidad de IVA y Alícuotas Dinámicas
  const renderProductCard = (product) => {
    const cartItem = cart.find(item => (item.producto_codigo || '').trim() === (product.producto_codigo || '').trim());
    const currentQty = cartItem ? cartItem.cantidad : 0;
    const hasStock = parseFloat(product.stock_disponible) > 0;
    const kilosUnidad = parseFloat(product.kilos_unidad) || 1.0;
    const ivaPorcentaje = parseFloat(product.iva_porcentaje) || 21.0;

    // Calcular valores Con IVA y Sin IVA
    const precioBultoConIva = parseFloat(product.precio_final);
    const precioKiloConIva = parseFloat(product.precio_kilo) > 0 ? parseFloat(product.precio_kilo) : precioBultoConIva;

    const precioBultoNeto = product.precio_neto !== null && product.precio_neto !== undefined 
      ? parseFloat(product.precio_neto) 
      : Math.round((precioBultoConIva / (1 + (ivaPorcentaje / 100))) * 100) / 100;

    const precioKiloNeto = product.precio_kilo_neto !== null && product.precio_kilo_neto !== undefined 
      ? parseFloat(product.precio_kilo_neto) 
      : Math.round((precioKiloConIva / (1 + (ivaPorcentaje / 100))) * 100) / 100;

    // Determinar valores a desplegar según la modalidad elegida
    const esModoNeto = canToggleIva && mostrarSinIva;
    const displayPrecioKilo = esModoNeto ? precioKiloNeto : precioKiloConIva;
    const displayPrecioBulto = esModoNeto ? precioBultoNeto : precioBultoConIva;
    const cleanProdCod = (product.producto_codigo || '').toLowerCase().trim();
    const habInfo = articulosHabituales.get(cleanProdCod);
    const esFavorito = !!habInfo;

    // Evaluación de Oferta Dinámica Activa
    const codExacto = (product.producto_codigo || '').trim();
    const ofertaActiva = ofertasActivas[codExacto] || null;
    const descOfertaPct = ofertaActiva ? (parseFloat(ofertaActiva.descuento_porcentaje) || 5) : 0;

    let displayPrecioBultoOferta = displayPrecioBulto;
    let displayPrecioKiloOferta = displayPrecioKilo;
    if (ofertaActiva) {
      displayPrecioBultoOferta = ofertaActiva.precio_fijo_oferta
        ? parseFloat(ofertaActiva.precio_fijo_oferta)
        : Math.round(displayPrecioBulto * (1 - descOfertaPct / 100) * 100) / 100;
      displayPrecioKiloOferta = Math.round((displayPrecioBultoOferta / kilosUnidad) * 100) / 100;
    }

    const hasKit = puedeUsarKits && articulosKits.has(codExacto);
    const kitList = hasKit ? articulosKits.get(codExacto) : [];
    const isKitActive = hasKit && !!selectedKits[codExacto];

    // Fotografías dinámicas de partida por lote (solo se muestra el botón si existen fotos activas)
    const infoPartida = mapaFotosLotes[codExacto] || (
      Array.isArray(product.imagenes_lote) && product.imagenes_lote.length > 0
        ? { imagenes: product.imagenes_lote, lote_codigo: product.lote_codigo_vigente }
        : null
    );
    const cantFotosPartida = Array.isArray(infoPartida?.imagenes) ? infoPartida.imagenes.length : 0;
    const infoIngredientes = resolverInfoIngredientesProductoB2B(product, mapaIngredientesComerciales);

    const productPayloadToAdd = ofertaActiva ? {
      ...product,
      precio_final: esModoNeto ? Math.round(displayPrecioBultoOferta * (1 + (ivaPorcentaje / 100)) * 100) / 100 : displayPrecioBultoOferta,
      precio_neto: esModoNeto ? displayPrecioBultoOferta : Math.round((displayPrecioBultoOferta / (1 + (ivaPorcentaje / 100))) * 100) / 100,
      precio_unitario: displayPrecioBultoOferta,
      es_oferta: true,
      oferta_id: ofertaActiva.oferta_id,
      oferta_titulo: ofertaActiva.titulo,
      descuento_porcentaje: descOfertaPct,
      kit_items: isKitActive ? kitList : []
    } : {
      ...product,
      kit_items: isKitActive ? kitList : []
    };

    return (
      <div key={product.id || product.producto_codigo} className={`product-card ${esFavorito ? 'es-favorito' : ''} ${ofertaActiva ? 'es-oferta' : ''}`}>
        {/* Primera línea: Indicador de Stock + ⭐ Habitual + Descripción + Pill de Alícuota de IVA si está habilitado */}
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
                } else if (product.stock_potencial && parseFloat(product.stock_potencial) > 0) {
                  cantPotencial = Math.round(parseFloat(product.stock_potencial));
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
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    backgroundColor: '#dcfce7',
                    color: '#15803d',
                    border: '1px solid #bbf7d0',
                    borderRadius: '12px',
                    padding: '1px 7px',
                    fontSize: '0.74rem',
                    fontWeight: '700',
                    whiteSpace: 'nowrap'
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
                  title={`Sin stock terminado inmediato, pero con insumos en depósito para producir aprox. ${cantPotencial} unidad(es)`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    backgroundColor: '#e0f2fe',
                    color: '#0369a1',
                    border: '1px solid #bae6fd',
                    borderRadius: '12px',
                    padding: '1px 7px',
                    fontSize: '0.74rem',
                    fontWeight: '700',
                    whiteSpace: 'nowrap'
                  }}
                >
                  🔵 Requiere prod. (~{cantPotencial} u.)
                </span>
              );
            }

            return (
              <span 
                className="b2b-stock-badge stock-agotado" 
                title="Sin stock físico ni insumos para producción inmediata"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  backgroundColor: '#f1f5f9',
                  color: '#64748b',
                  border: '1px solid #cbd5e1',
                  borderRadius: '12px',
                  padding: '1px 7px',
                  fontSize: '0.74rem',
                  fontWeight: '600',
                  whiteSpace: 'nowrap'
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
          <h4 
            className={`product-name ${ofertaActiva ? 'product-name-oferta' : ''}`} 
            style={{ 
              fontSize: '0.92rem', 
              fontWeight: '600', 
              color: 'var(--text-primary)', 
              margin: 0, 
              flex: 1, 
              lineHeight: '1.25' 
            }}
          >
            {product.producto_descripcion}
          </h4>
          {canToggleIva && (
            <span className={`b2b-iva-pill ${ivaPorcentaje < 20 ? 'iva-105' : ''}`} title={`Alícuota de IVA: ${ivaPorcentaje}%`}>
              IVA {ivaPorcentaje}%
            </span>
          )}
          {ofertaActiva && (
            <span 
              className="b2b-oferta-badge" 
              title={`Oferta promocional activa: ${ofertaActiva.titulo}`}
            >
              🔥 {descOfertaPct}% OFF
            </span>
          )}
        </div>

        {/* Sección de Kit de Insumos Externos (Solo si el cliente tiene habilitados los kits, ej: Matías) */}
        {hasKit && (
          <div style={{
            background: isKitActive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.02)',
            border: isKitActive ? '1px solid rgba(16, 185, 129, 0.45)' : '1px dashed rgba(255, 255, 255, 0.12)',
            borderRadius: '9px',
            padding: '0.45rem 0.65rem',
            margin: '0.45rem 0',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: isKitActive ? '#10b981' : 'var(--text-secondary)'
            }}>
              <input 
                type="checkbox"
                checked={isKitActive}
                onChange={(e) => handleToggleKit(product, e.target.checked)}
                style={{ accentColor: '#10b981', cursor: 'pointer', width: '15px', height: '15px' }}
              />
              <span>📦 ¿Usar stock de insumos LAMDA en casa? (Añadir Kit)</span>
            </label>
            <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)', paddingLeft: '22px', lineHeight: '1.35' }}>
              {kitList.map(k => (
                <span key={k.id} style={{ display: 'inline-block', marginRight: '10px' }}>
                  • <strong>{k.descripcion}:</strong> {k.cantidad_ratio} {k.unidad_medida} (${Number(k.precio_unitario).toLocaleString('es-AR', { minimumFractionDigits: 2 })})
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Segunda línea: Botón (+) + Botón discreto Ver partida a la IZQUIERDA | Precio Bulto + Precio Kilo Destacado a la DERECHA */}
        <div className="product-meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            {currentQty > 0 ? (
              <div className="quantity-controls">
                <button 
                  className="qty-btn"
                  onClick={() => addToCart(productPayloadToAdd, currentQty - 1)}
                  title="Disminuir"
                >
                  <Minus size={13} />
                </button>
                <span className="qty-value">{currentQty}</span>
                <button 
                  className="qty-btn"
                  onClick={() => addToCart(productPayloadToAdd, currentQty + 1)}
                  title="Aumentar"
                >
                  <Plus size={13} />
                </button>
              </div>
            ) : (
              <button 
                className="btn-add-plus"
                onClick={() => addToCart(productPayloadToAdd, 1)}
                title="Agregar al pedido"
              >
                <Plus size={15} />
              </button>
            )}

            {cantFotosPartida > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  registrarAccesoTelemetria(`📷 Miró fotos de partida: ${product.producto_descripcion} (${product.producto_codigo})`, profile);
                  setModalPartidaCtx({
                    product,
                    infoPartida,
                    productPayloadToAdd,
                    displayPrecioBulto: ofertaActiva ? displayPrecioBultoOferta : displayPrecioBulto,
                    displayPrecioKilo: ofertaActiva ? displayPrecioKiloOferta : displayPrecioKilo,
                    esModoNeto,
                    ofertaActiva,
                    descOfertaPct
                  });
                }}
                title={infoPartida?.es_referencia_caja_madre
                  ? 'Ver fotografías de la caja madre en depósito'
                  : 'Ver fotografías de la partida actual en depósito'}
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

            {infoIngredientes && (
              <BotonVerIngredientesB2B
                onClick={(e) => {
                  e.stopPropagation();
                  registrarAccesoTelemetria(`🥣 Miró ingredientes: ${product.producto_descripcion} (${product.producto_codigo})`, profile);
                  setModalIngredientesCtx({
                    product,
                    infoIngredientes,
                    productPayloadToAdd
                  });
                }}
              />
            )}
          </div>

          {/* Precios: Bulto entre paréntesis más chico + Kilo destacado */}
          <div className="product-price-container" style={{ textAlign: 'right' }}>
            {ofertaActiva ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                  <span style={{ textDecoration: 'line-through', opacity: 0.5, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    ({formatCurrency(displayPrecioBulto)})
                  </span>
                  <span className="product-price-bulto" style={{ color: '#16a34a', fontWeight: '700' }} title={`Precio promocional por bulto cerrado (${kilosUnidad}kg)`}>
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
                {(() => {
                  let fechaTxt = null;
                  if (ofertaActiva.fecha_fin && (ofertaActiva.condicion_cierre === 'FECHA_LIMITE' || ofertaActiva.condicion_cierre === 'AMBAS')) {
                    try {
                      const [y, m, d] = String(ofertaActiva.fecha_fin).split('T')[0].split('-');
                      if (y && m && d) fechaTxt = `${d}/${m}`;
                    } catch {}
                  }
                  const muestraStock = (ofertaActiva.condicion_cierre === 'HASTA_AGOTAR_STOCK' || ofertaActiva.condicion_cierre === 'AMBAS' || ofertaActiva.cuota_disponible > 0);
                  
                  return (
                    <div style={{ fontSize: '0.67rem', color: '#d97706', fontWeight: 600, marginTop: '2px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px' }}>
                      {muestraStock && (
                        <span>⚡ Hasta agotar stock ({ofertaActiva.cuota_disponible} {ofertaActiva.unidad_cuota?.toLowerCase() || 'kg'} disp.)</span>
                      )}
                      {fechaTxt && (
                        <span>📅 Vigente hasta el {fechaTxt}</span>
                      )}
                    </div>
                  );
                })()}
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
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="spinner-container">
        <Loader2 className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Cargando catálogo de artículos...</p>
      </div>
    );
  }

  if (hasNoLists) {
    return (
      <div style={{ padding: '2rem', maxWidth: '600px', margin: '4rem auto', textAlign: 'center' }}>
        <div className="login-card" style={{ padding: '3rem 2rem', border: '1px solid var(--border-glass)', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <AlertCircle size={48} style={{ color: 'var(--accent)', marginBottom: '1.5rem' }} />
          <h2 style={{ fontSize: '1.75rem', fontWeight: '800', marginBottom: '1rem', color: 'var(--text-primary)' }}>Catálogo no Habilitado</h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '1.25rem' }}>
            Su cuenta de cliente (<strong>{profile?.cliente_id || 'N/A'}</strong>) no tiene ninguna lista de precios asignada en la administración local.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
            Por favor, póngase en contacto con la distribuidora para solicitar la asignación de una lista comercial válida.
          </p>
          <button 
            className="btn-primary" 
            onClick={() => setCurrentTab('home')}
            style={{ width: '100%' }}
          >
            Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Cabecera de Sección (Visible solo en Escritorio para no duplicar en celulares) */}
      <div className="b2b-articulos-desktop-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {canToggleIva && (
            <button
              onClick={() => setShowIvaModal(true)}
              className={`b2b-gear-icon-btn ${mostrarSinIva ? 'active' : ''}`}
              title="Configurar modalidad de precios (Con IVA / Sin IVA)"
              aria-label="Configurar IVA"
            >
              <Settings size={17} />
            </button>
          )}
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            Artículos
          </h2>
        </div>
      </div>

      {/* Barra de Búsqueda y Switch de Favoritos */}
      <div className="b2b-top-search-section">
        <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', width: '100%', flexWrap: 'wrap' }}>
          <div className="b2b-search-centered-wrapper" style={{ flex: '1', minWidth: '220px' }}>
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
            title={filtroFavoritos ? 'Desactivar filtro y ver catálogo completo' : 'Filtrar artículos que comprás habitualmente'}
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

          {/* Solapa / Switch de Ofertas si hay ofertas activas */}
          {articulosEnOferta.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const nextOfr = !filtroOfertas;
                setFiltroOfertas(nextOfr);
                if (nextOfr) {
                  registrarAccesoTelemetria(`🔥 Filtró por Artículos en Oferta (${articulosEnOferta.length} art.)`, profile);
                }
              }}
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

      {/* Modal de Configuración de IVA */}
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
              {/* Opción 1: Sin IVA (Neto) - Predeterminado */}
              <div 
                className={`b2b-iva-option-card ${mostrarSinIva ? 'selected' : ''}`}
                onClick={() => toggleModalidadIva(true)}
              >
                <input 
                  type="radio" 
                  name="iva_option" 
                  checked={mostrarSinIva} 
                  onChange={() => toggleModalidadIva(true)}
                  className="b2b-iva-radio"
                />
                <div style={{ flex: 1 }}>
                  <div className="b2b-iva-option-title">Precios sin IVA (Neto Gravado)</div>
                  <div className="b2b-iva-option-desc">Muestra los precios base netos y discrimina las alícuotas (21% y 10,5%) por ítem.</div>
                </div>
                {mostrarSinIva && <Check size={18} style={{ color: 'var(--accent-light)' }} />}
              </div>

              {/* Opción 2: Con IVA Incluido (Final) */}
              <div 
                className={`b2b-iva-option-card ${!mostrarSinIva ? 'selected' : ''}`}
                onClick={() => toggleModalidadIva(false)}
              >
                <input 
                  type="radio" 
                  name="iva_option" 
                  checked={!mostrarSinIva} 
                  onChange={() => toggleModalidadIva(false)}
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

      {/* Cartel de Ayuda Minimalista */}
      {showSearchHelp && (
        <div className="b2b-search-help-box">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
            <Info size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.45' }}>
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

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1rem', borderRadius: '8px', display: 'flex', gap: '0.75rem', alignItems: 'center', color: 'var(--danger)', marginBottom: '1.5rem' }}>
          <AlertCircle size={20} />
          <p>Error al cargar artículos: {error}</p>
        </div>
      )}

      {/* Layout Principal (Catálogo Jerárquico + Carrito Lateral) */}
      <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        
        {/* Lado Izquierdo: Catálogo Jerárquico de 5 Niveles */}
        <div style={{ flex: '1', minWidth: '300px' }}>
          {hierarchicalData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3.5rem 1rem', border: '1px dashed var(--border-glass)', borderRadius: '12px', background: 'var(--bg-card)' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', marginBottom: '0.5rem' }}>No se encontraron artículos con los criterios seleccionados.</p>
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
                    onClick={() => {
                      const nextOpen = !isOfertasOpen;
                      setIsOfertasOpen(nextOpen);
                      if (nextOpen) {
                        registrarAccesoTelemetria(`🔥 Abrió Solapa de Ofertas Activas (${ofertasVisiblesEnSolapa.length} art.)`, profile);
                      }
                    }}
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
                      {/* Banner de Información y Reglas de la Oferta Activa */}
                      {resumenOfertasActivas.map(ofr => {
                        let fechaFinStr = null;
                        if (ofr.fecha_fin) {
                          try {
                            const rawIso = String(ofr.fecha_fin).split('T')[0];
                            const [anio, mes, dia] = rawIso.split('-');
                            if (anio && mes && dia) {
                              fechaFinStr = `${dia}/${mes}/${anio}`;
                            } else {
                              fechaFinStr = new Date(ofr.fecha_fin).toLocaleDateString('es-AR');
                            }
                          } catch {
                            fechaFinStr = ofr.fecha_fin;
                          }
                        }

                        const aplicaFecha = Boolean(fechaFinStr && (ofr.condicion_cierre === 'FECHA_LIMITE' || ofr.condicion_cierre === 'AMBAS'));
                        const aplicaStock = Boolean(ofr.condicion_cierre === 'HASTA_AGOTAR_STOCK' || ofr.condicion_cierre === 'AMBAS' || ofr.cuota_disponible > 0);
                        const cuotaKilos = ofr.cuota_disponible ? parseFloat(ofr.cuota_disponible) : 0;
                        const unidad = ofr.unidad_cuota ? ofr.unidad_cuota.toLowerCase() : 'kg';

                        return (
                          <div 
                            key={ofr.oferta_id} 
                            style={{
                              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(15, 23, 42, 0.95) 100%)',
                              border: '1px solid rgba(245, 158, 11, 0.35)',
                              borderRadius: '8px',
                              padding: '0.65rem 0.85rem',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.35rem'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                              <span style={{ fontWeight: '700', color: '#fbbf24', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span>🏷️</span> {ofr.titulo || 'Condiciones de la Oferta'}
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
                              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: '1.35' }}>
                                {ofr.descripcion}
                              </p>
                            )}

                            {/* Reglas comerciales importantes: vigencia y stock */}
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '0.85rem',
                              marginTop: '0.15rem',
                              paddingTop: '0.35rem',
                              borderTop: '1px solid rgba(245, 158, 11, 0.15)',
                              fontSize: '0.78rem'
                            }}>
                              {aplicaFecha && (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#fde68a' }}>
                                  <span>📅</span>
                                  <span><strong>Vigencia hasta:</strong> {fechaFinStr}</span>
                                </div>
                              )}
                              {aplicaStock && (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#fde68a' }}>
                                  <span>⚡</span>
                                  <span><strong>Condición:</strong> Hasta agotar stock {cuotaKilos > 0 ? `(${cuotaKilos} ${unidad} disponibles)` : ''}</span>
                                </div>
                              )}
                              {!aplicaFecha && !aplicaStock && (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#fde68a' }}>
                                  <span>⚡</span>
                                  <span><strong>Condición:</strong> Promoción por tiempo limitado</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

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
                    {/* Cabecera Nivel 1: Familia */}
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

                    {/* Contenido de la Familia */}
                    {isFamOpen && (
                      <div className="b2b-familia-body">
                        {familia.atributos.map(atributo => {
                          const isAtOpen = expandedAtributos.has(atributo.key);

                          return (
                            <div key={atributo.key} className={`b2b-atributo-group ${isAtOpen ? 'open' : ''}`}>
                              {/* Cabecera Nivel 2: Artículo Principal */}
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

                              {/* Contenido del Atributo Principal: Nivel 3 o Grilla Directa */}
                              {isAtOpen && (
                                atributo.hasSubcategorias ? (
                                  /* Nivel 3: Subcategorías */
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.35rem', background: 'rgba(0,0,0,0.15)', borderTop: '1px solid var(--border-glass)' }}>
                                    {atributo.subcategorias.map(subcat => {
                                      const isSubOpen = expandedSubcategorias.has(subcat.key);

                                      return (
                                        <div key={subcat.key} className={`b2b-subcategoria-card ${isSubOpen ? 'open' : ''}`}>
                                          {/* Cabecera Nivel 3 */}
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

                                          {/* Contenido Nivel 3: Nivel 4 Condicional o Grilla Directa */}
                                          {isSubOpen && (
                                            subcat.hasSubSubcategorias ? (
                                              /* Nivel 4: Sub-subcategorías (ej: Extra Light, Light, Ámbar) */
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', padding: '0.3rem', background: 'rgba(0,0,0,0.2)' }}>
                                                {subcat.subSubcategorias.map(subsub => {
                                                  const isSubSubOpen = expandedSubSubcategorias.has(subsub.key);

                                                  return (
                                                    <div key={subsub.key} className={`b2b-subsubcategoria-card ${isSubSubOpen ? 'open' : ''}`}>
                                                      {/* Cabecera Nivel 4 */}
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

                                                      {/* Contenido Nivel 4: Nivel 5 Condicional o Grilla Directa */}
                                                      {isSubSubOpen && (
                                                        subsub.hasSubSubSubcategorias ? (
                                                          /* Nivel 5: Sub-sub-subcategorías (ej: Mariposa, Cuarto) */
                                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem', padding: '0.25rem', background: 'rgba(0,0,0,0.25)' }}>
                                                            {subsub.subSubSubcategorias.map(subsubsub => {
                                                              const isSubSubSubOpen = expandedSubSubSubcategorias.has(subsubsub.key);

                                                              return (
                                                                <div key={subsubsub.key} className={`b2b-subsubsubcategoria-card ${isSubSubSubOpen ? 'open' : ''}`}>
                                                                  {/* Cabecera Nivel 5 */}
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

                                                                  {/* Grilla de Artículos dentro de Nivel 5 */}
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
                                                          /* Grilla Directa de Artículos dentro de Nivel 4 (sin Nivel 5) */
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
                                              /* Grilla Directa de Artículos dentro de Nivel 3 (como Avena o Nuez con cáscara) */
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
                                  /* Grilla Directa de Artículos sin Nivel 3 (como Garbanzo o Granolas) */
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
        </div>

        {/* Lado Derecho: Carrito Panel Lateral (Sticky en Escritorio) */}
        {cart.length > 0 && (
          <div 
            className="login-card desktop-cart-sidebar" 
            style={{ 
              width: '380px', 
              position: 'sticky', 
              top: '2rem', 
              padding: '1.75rem', 
              margin: '0', 
              animation: 'none', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '1.25rem',
              boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
              border: '1px solid var(--border-glass)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem' }}>
              <ShoppingBag size={22} className="text-secondary" style={{ color: 'var(--accent)' }} />
              <h2 style={{ fontSize: '1.25rem', fontWeight: '700' }}>Revisar Pedido</h2>
              <span style={{ marginLeft: 'auto', background: 'rgba(59,130,246,0.1)', color: 'var(--accent)', borderRadius: '999px', padding: '0.1rem 0.6rem', fontSize: '0.8rem', fontWeight: '600' }}>
                {cart.length} {cart.length === 1 ? 'ítem' : 'ítems'}
              </span>
            </div>

            {/* Listado de ítems */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '300px', overflowY: 'auto', paddingRight: '0.25rem' }}>
              {cart.map(item => (
                <div 
                  key={item.producto_codigo} 
                  className={item.es_oferta ? 'b2b-cart-item-oferta' : ''}
                  style={{ 
                    display: 'flex', 
                    gap: '0.75rem', 
                    alignItems: 'flex-start', 
                    justifyContent: 'space-between', 
                    borderBottom: '1px solid rgba(255,255,255,0.02)', 
                    paddingBottom: '0.75rem' 
                  }}
                >
                  <div style={{ flex: '1', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', marginBottom: '0.25rem' }}>
                      <p 
                        className={item.es_oferta ? 'b2b-cart-title-oferta' : ''}
                        style={{ 
                          fontSize: '0.9rem', 
                          fontWeight: item.es_oferta ? '700' : '600', 
                          color: 'var(--text-primary)', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          whiteSpace: 'nowrap', 
                          margin: 0 
                        }}
                      >
                        {item.producto_descripcion}
                      </p>
                      {item.es_oferta && (
                        <span className="b2b-cart-oferta-badge" title={`Oferta: ${item.oferta_titulo || 'Promoción activa'}`}>
                          🔥 {item.descuento_porcentaje}% OFF
                        </span>
                      )}
                      {item.is_kit_item && (
                        <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700, background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '1px 5px', borderRadius: '4px' }}>
                          📦 Kit Insumos ({item.kit_parent})
                        </span>
                      )}
                    </div>
                    {item.is_kit_item ? (
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.78rem', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '4px', padding: '1px 6px', fontWeight: '700' }}>
                          {item.cantidad} u.
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '4px' }}>
                          x {formatCurrency(item.precio_unitario)} <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>(c/IVA)</span>
                        </span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <button 
                          className="qty-btn"
                          style={{ padding: '2px', minWidth: '18px', height: '18px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)', cursor: 'pointer', color: 'var(--text-primary)' }}
                          onClick={() => addToCart({
                            producto_codigo: item.producto_codigo,
                            producto_descripcion: item.producto_descripcion,
                            precio_final: item.precio_unitario,
                            es_oferta: item.es_oferta,
                            oferta_id: item.oferta_id,
                            descuento_porcentaje: item.descuento_porcentaje,
                            oferta_titulo: item.oferta_titulo
                          }, item.cantidad - 1)}
                        >
                          <Minus size={10} />
                        </button>
                        <span style={{ fontSize: '0.85rem', fontWeight: '700', minWidth: '16px', textAlign: 'center', color: 'var(--text-primary)' }}>{item.cantidad}</span>
                        <button 
                          className="qty-btn"
                          style={{ padding: '2px', minWidth: '18px', height: '18px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-glass)', cursor: 'pointer', color: 'var(--text-primary)' }}
                          onClick={() => addToCart({
                            producto_codigo: item.producto_codigo,
                            producto_descripcion: item.producto_descripcion,
                            precio_final: item.precio_unitario,
                            es_oferta: item.es_oferta,
                            oferta_id: item.oferta_id,
                            descuento_porcentaje: item.descuento_porcentaje,
                            oferta_titulo: item.oferta_titulo
                          }, item.cantidad + 1)}
                        >
                          <Plus size={10} />
                        </button>
                        <span style={{ fontSize: '0.75rem', color: item.es_oferta ? '#10b981' : 'var(--text-muted)', marginLeft: '4px' }}>
                          x {formatCurrency(item.precio_unitario)} <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>(c/IVA)</span>
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                      {formatCurrency(item.subtotal)}
                    </span>
                    <button 
                      onClick={() => removeFromCart(item.producto_codigo)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', transition: 'var(--transition-smooth)' }}
                      title="Quitar"
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Banner Dinámico de Política Comercial */}
            {politicaComercial && (
              <div style={{
                borderRadius: '8px',
                padding: '0.65rem 0.85rem',
                fontSize: '0.8rem',
                lineHeight: '1.35',
                background: politicaEval.bloqueadoPorSaldo
                  ? 'rgba(239, 68, 68, 0.12)'
                  : (politicaEval.aplica ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)'),
                border: `1px solid ${politicaEval.bloqueadoPorSaldo
                  ? 'rgba(239, 68, 68, 0.35)'
                  : (politicaEval.aplica ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)')}`,
                color: politicaEval.bloqueadoPorSaldo
                  ? '#f87171'
                  : (politicaEval.aplica ? '#34d399' : '#fbbf24'),
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.5rem'
              }}>
                <span style={{ fontSize: '1rem', lineHeight: '1' }}>
                  {politicaEval.bloqueadoPorSaldo ? '⛔' : (politicaEval.aplica ? '🎉' : '💡')}
                </span>
                <div style={{ flex: 1 }}>
                  {politicaEval.bloqueadoPorSaldo ? (
                    <div>
                      <strong style={{ display: 'block', marginBottom: '2px', color: '#f87171' }}>Bonificación retenida por saldo</strong>
                      <div>{politicaEval.mensaje}</div>
                    </div>
                  ) : politicaEval.aplica ? (
                    <div>
                      <strong>¡Bonificación del {politicaEval.porcentaje}% aplicada!</strong> ({politicaEval.etiqueta})
                      {politicaEval.proximoTramo && (
                        <div style={{ fontSize: '0.72rem', marginTop: '3px', opacity: 0.9 }}>
                          ↳ Faltan {formatCurrency(politicaEval.faltaParaProximo)} para el escalón del {politicaEval.proximoPorcentaje}%
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      Agregá <strong>{formatCurrency(politicaEval.faltaParaProximo)}</strong> más para acceder al <strong>{politicaEval.proximoPorcentaje}% de descuento</strong> por volumen.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Total */}
            <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {politicaEval.aplica && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <span>Subtotal:</span>
                    <span>{formatCurrency(politicaEval.subtotalBruto)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: '#34d399', fontWeight: 600 }}>
                    <span>Bonificación ({politicaEval.porcentaje}%):</span>
                    <span>-{formatCurrency(politicaEval.montoDescuento)}</span>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Total Estimado:</span>
                <span style={{ fontSize: '1.5rem', fontWeight: '800', color: politicaEval.aplica ? '#34d399' : 'var(--text-primary)' }}>
                  {formatCurrency(politicaEval.totalEstimado)}
                </span>
              </div>
            </div>

            {/* Confirmar botón */}
            <button
              onClick={() => setCurrentTab('pedidos')}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
            >
              <span>Definir Pedido</span>
            </button>
          </div>
        )}

      </div>

      {/* Carrito Flotante y Drawer Expandible en Mobile/Tablet */}
      {cart.length > 0 && (
        <>
          {/* Backdrop sombreado al expandir */}
          {showMobileCartSheet && (
            <div 
              className="mobile-cart-backdrop"
              onClick={() => setShowMobileCartSheet(false)}
            />
          )}

          {/* Contenedor del Drawer Inferior */}
          <div className={`mobile-cart-drawer-container ${showMobileCartSheet ? 'expanded' : ''}`}>
            {/* Panel de artículos expandido */}
            {showMobileCartSheet && (
              <div className="mobile-cart-drawer-body">
                <div className="mobile-cart-drawer-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ShoppingBag size={18} style={{ color: 'var(--accent)' }} />
                    <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                      Mi Pedido Actual
                    </h3>
                    <span className="b2b-count-badge" style={{ padding: '0.1rem 0.5rem', fontSize: '0.72rem' }}>
                      {cart.reduce((sum, item) => sum + item.cantidad, 0)} ítems
                    </span>
                  </div>
                  <button 
                    onClick={() => setShowMobileCartSheet(false)}
                    className="mobile-cart-drawer-close"
                    title="Cerrar"
                  >
                    <ChevronDown size={18} />
                  </button>
                </div>

                {/* Banner de Política Comercial en Drawer Móvil */}
                {politicaComercial && (
                  <div style={{
                    margin: '0.5rem 1rem 0',
                    borderRadius: '8px',
                    padding: '0.55rem 0.75rem',
                    fontSize: '0.78rem',
                    lineHeight: '1.3',
                    background: politicaEval.bloqueadoPorSaldo
                      ? 'rgba(239, 68, 68, 0.12)'
                      : (politicaEval.aplica ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)'),
                    border: `1px solid ${politicaEval.bloqueadoPorSaldo
                      ? 'rgba(239, 68, 68, 0.35)'
                      : (politicaEval.aplica ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)')}`,
                    color: politicaEval.bloqueadoPorSaldo
                      ? '#f87171'
                      : (politicaEval.aplica ? '#34d399' : '#fbbf24'),
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem'
                  }}>
                    <span>{politicaEval.bloqueadoPorSaldo ? '⛔' : (politicaEval.aplica ? '🎉' : '💡')}</span>
                    <div style={{ flex: 1 }}>
                      {politicaEval.bloqueadoPorSaldo ? (
                        <span><strong style={{ color: '#f87171' }}>Retenido por saldo:</strong> {politicaEval.motivo}</span>
                      ) : politicaEval.aplica ? (
                        <span><strong>¡{politicaEval.porcentaje}% OFF aplicado!</strong> ({politicaEval.etiqueta})</span>
                      ) : (
                        <span>Faltan <strong>{formatCurrency(politicaEval.faltaParaProximo)}</strong> para el {politicaEval.proximoPorcentaje}% OFF</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="mobile-cart-drawer-items">
                  {cart.map(item => (
                    <div key={item.producto_codigo} className={`mobile-cart-drawer-item ${item.es_oferta ? 'b2b-cart-item-oferta' : ''}`}>
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', marginBottom: '0.35rem' }}>
                          <p 
                            className={item.es_oferta ? 'b2b-cart-title-oferta' : ''}
                            style={{ 
                              margin: 0, 
                              fontSize: '0.88rem', 
                              fontWeight: item.es_oferta ? '700' : '600', 
                              color: 'var(--text-primary)', 
                              whiteSpace: 'nowrap', 
                              overflow: 'hidden', 
                              textOverflow: 'ellipsis' 
                            }}
                          >
                            {item.producto_descripcion}
                          </p>
                          {item.es_oferta && (
                            <span className="b2b-cart-oferta-badge" title={`Oferta: ${item.oferta_titulo || 'Promoción activa'}`}>
                              🔥 {item.descuento_porcentaje}% OFF
                            </span>
                          )}
                          {item.is_kit_item && (
                            <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700, background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '1px 5px', borderRadius: '4px' }}>
                              📦 Kit Insumos ({item.kit_parent})
                            </span>
                          )}
                        </div>
                        {item.is_kit_item ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.78rem', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '4px', padding: '1px 6px', fontWeight: '700' }}>
                              {item.cantidad} u.
                            </span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                              x {formatCurrency(item.precio_unitario)}
                            </span>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div className="quantity-controls" style={{ padding: '2px' }}>
                              <button 
                                className="qty-btn"
                                style={{ width: '24px', height: '24px' }}
                                onClick={() => addToCart({
                                  producto_codigo: item.producto_codigo,
                                  producto_descripcion: item.producto_descripcion,
                                  precio_final: item.precio_unitario,
                                  es_oferta: item.es_oferta,
                                  oferta_id: item.oferta_id,
                                  descuento_porcentaje: item.descuento_porcentaje,
                                  oferta_titulo: item.oferta_titulo
                                }, item.cantidad - 1)}
                                title="Disminuir"
                              >
                                <Minus size={11} />
                              </button>
                              <span className="qty-value" style={{ minWidth: '18px', fontSize: '0.82rem' }}>{item.cantidad}</span>
                              <button 
                                className="qty-btn"
                                style={{ width: '24px', height: '24px' }}
                                onClick={() => addToCart({
                                  producto_codigo: item.producto_codigo,
                                  producto_descripcion: item.producto_descripcion,
                                  precio_final: item.precio_unitario,
                                  es_oferta: item.es_oferta,
                                  oferta_id: item.oferta_id,
                                  descuento_porcentaje: item.descuento_porcentaje,
                                  oferta_titulo: item.oferta_titulo
                                }, item.cantidad + 1)}
                                title="Aumentar"
                              >
                                <Plus size={11} />
                              </button>
                            </div>
                            <span style={{ fontSize: '0.78rem', color: item.es_oferta ? '#10b981' : 'var(--text-muted)' }}>
                              x {formatCurrency(item.precio_unitario)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                          {formatCurrency(item.subtotal)}
                        </span>
                        <button 
                          onClick={() => removeFromCart(item.producto_codigo)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                          title="Eliminar artículo"
                        >
                          <Trash2 size={15} style={{ color: 'var(--danger)' }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Barra Flotante Siempre Visible */}
            <div 
              className="mobile-cart-floating-bar"
              onClick={() => setShowMobileCartSheet(!showMobileCartSheet)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ position: 'relative' }}>
                  <ShoppingBag size={20} style={{ color: 'var(--accent)' }} />
                  <span 
                    style={{ 
                      position: 'absolute', 
                      top: '-8px', 
                      right: '-8px', 
                      background: 'var(--accent)', 
                      color: 'white', 
                      borderRadius: '50%', 
                      width: '18px', 
                      height: '18px', 
                      fontSize: '0.65rem', 
                      fontWeight: 'bold', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center' 
                    }}
                  >
                    {cart.reduce((sum, item) => sum + item.cantidad, 0)}
                  </span>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: '500' }}>
                    {showMobileCartSheet ? 'Tocá para cerrar lista' : 'Tocá para ver pedido'}
                  </p>
                  <p style={{ margin: 0, fontSize: '1rem', fontWeight: '800', color: politicaEval.aplica ? '#34d399' : 'var(--text-primary)' }}>
                    {formatCurrency(politicaEval.totalEstimado)}
                    {politicaEval.aplica && <span style={{ fontSize: '0.68rem', color: '#34d399', marginLeft: '4px' }}>({politicaEval.porcentaje}% OFF)</span>}
                  </p>
                </div>
              </div>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentTab('pedidos');
                }}
                className="btn-primary"
                style={{
                  borderRadius: '999px',
                  padding: '0.45rem 1.15rem',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  background: 'var(--accent)',
                  border: 'none',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                Revisar Orden
              </button>
            </div>
          </div>
        </>
      )}

      {/* Visor Sobrio de Inspección Visual de Partida en Depósito */}
      <InspeccionPartidaModal
        isOpen={Boolean(modalPartidaCtx)}
        onClose={() => setModalPartidaCtx(null)}
        product={modalPartidaCtx?.product}
        infoPartida={modalPartidaCtx?.infoPartida}
        currentQty={
          modalPartidaCtx?.product
            ? (cart.find(item => (item.producto_codigo || '').trim() === (modalPartidaCtx.product.producto_codigo || '').trim())?.cantidad || 0)
            : 0
        }
        onChangeQty={(newQty) => {
          if (modalPartidaCtx?.productPayloadToAdd) {
            addToCart(modalPartidaCtx.productPayloadToAdd, Math.max(0, newQty));
          }
        }}
        displayPrecioBulto={modalPartidaCtx?.displayPrecioBulto}
        displayPrecioKilo={modalPartidaCtx?.displayPrecioKilo}
        esModoNeto={modalPartidaCtx?.esModoNeto}
        mostrarPrecios={true}
        ofertaActiva={modalPartidaCtx?.ofertaActiva}
        descOfertaPct={modalPartidaCtx?.descOfertaPct}
        formatCurrency={formatCurrency}
      />

      {/* Visor de Ingredientes Comerciales (Línea 3 Mixes y Línea 6 Granolas) */}
      <DesgloseIngredientesModal
        isOpen={Boolean(modalIngredientesCtx)}
        onClose={() => setModalIngredientesCtx(null)}
        product={modalIngredientesCtx?.product}
        infoIngredientes={modalIngredientesCtx?.infoIngredientes}
        currentQty={
          modalIngredientesCtx?.product
            ? (cart.find(item => (item.producto_codigo || '').trim() === (modalIngredientesCtx.product.producto_codigo || '').trim())?.cantidad || 0)
            : 0
        }
        onChangeQty={(newQty) => {
          if (modalIngredientesCtx?.productPayloadToAdd) {
            addToCart(modalIngredientesCtx.productPayloadToAdd, Math.max(0, newQty));
          }
        }}
      />
    </div>
  );
}
