import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { supabase } from './supabaseClient';
import { sincronizarDirectorioCloud } from './utils/clientesB2B';
import { registrarAccesoTelemetria } from './utils/telemetria';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import ActivarCuenta from './pages/ActivarCuenta';
import Home from './pages/Home';
import Articulos from './pages/Articulos';
import Pedidos from './pages/Pedidos';
import { Loader2, Menu, Home as HomeIcon, BookOpen, ClipboardList, Receipt, Truck, Banknote, Settings, MessageSquare, LogOut, Smartphone, Wrench } from 'lucide-react';
import Swal from 'sweetalert2';
import VincularDispositivoModal from './components/VincularDispositivoModal';

const Onboarding = lazy(() => import('./pages/Onboarding'));
const CuentaCorriente = lazy(() => import('./pages/CuentaCorriente'));
const PagosEfectivo = lazy(() => import('./pages/PagosEfectivo'));
const Retiros = lazy(() => import('./pages/Retiros'));
const RecepcionPedido = lazy(() => import('./pages/RecepcionPedido'));
const CheckinPublico = lazy(() => import('./pages/CheckinPublico'));
const EnsobradoPublico = lazy(() => import('./pages/EnsobradoPublico'));
const PrePedidoPublico = lazy(() => import('./pages/PrePedidoPublico'));
const ServiciosColaborador = lazy(() => import('./pages/ServiciosColaborador'));

export default function App() {
  const mountPerfRef = useRef(performance.now());
  const authPerfRef = useRef(0);
  const [session, setSession] = useState(null);
  const [metrics, setMetrics] = useState({
    assetsMs: 0,
    authMs: 0,
    profileMs: 0,
    totalMs: 0
  });
  const [showTelemetryDetails, setShowTelemetryDetails] = useState(false);
  
  // 🚀 Instant Cold Start: Leer perfil guardado en localStorage para renderizar en 0ms
  const [profile, setProfile] = useState(() => {
    try {
      const cached = localStorage.getItem('b2b_cached_profile');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  const [loadingSession, setLoadingSession] = useState(() => {
    try {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      const pathname = window.location.pathname || '';

      const hasAuthParamsInUrl = hash.includes('access_token') || 
                                 hash.includes('refresh_token') || 
                                 hash.includes('type=') || 
                                 search.includes('code=') ||
                                 search.includes('token=') ||
                                 pathname.includes('/activar') ||
                                 pathname.includes('/onboarding') ||
                                 pathname.includes('/checkin') ||
                                 hash.includes('/activar') ||
                                 hash.includes('/onboarding') ||
                                 hash.includes('/checkin');

      // 🚀 Si hay un token de acceso espejo (magiclink), invitación o activación en la URL, ESPERAR a Supabase Auth
      if (hasAuthParamsInUrl) {
        return true;
      }

      const hasCachedProfile = !!localStorage.getItem('b2b_cached_profile');
      const hasAuthToken = Object.keys(localStorage).some(k => k.includes('auth-token') || k.includes('sb-'));

      if (!hasCachedProfile && !hasAuthToken) {
        return false;
      }
      return !hasCachedProfile;
    } catch {
      return true;
    }
  });

  const [currentTab, setCurrentTab] = useState('home');
  const [cart, setCart] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [canToggleIva, setCanToggleIva] = useState(false);
  const [openIvaModalTrigger, setOpenIvaModalTrigger] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showVincularModal, setShowVincularModal] = useState(false);
  const mobileMenuRef = useRef(null);

  // Alertas proactivas de pedidos activos y pre-pedidos pendientes
  const [tramitesAlerts, setTramitesAlerts] = useState({
    pedidosActivosCount: 0,
    prepedidosPendientesCount: 0
  });

  const fetchTramitesAlerts = async () => {
    if (!profile?.cliente_id) return;
    try {
      // 1. Pedidos activos (no entregados ni cancelados)
      const { data: pData } = await supabase
        .from('clientes_b2b_pedidos_cabecera')
        .select('id, estado')
        .eq('cliente_id', profile.cliente_id)
        .not('estado', 'in', '("Cancelado","CANCELLED","Eliminado","Entregado")');

      // 2. Pre-pedidos de colaborador pendientes
      const { data: prepData } = await supabase
        .from('clientes_b2b_prepedidos')
        .select('id')
        .eq('cliente_id', profile.cliente_id)
        .eq('estado', 'pendiente_revision');

      setTramitesAlerts({
        pedidosActivosCount: pData ? pData.length : 0,
        prepedidosPendientesCount: prepData ? prepData.length : 0
      });
    } catch (e) {
      console.warn('Advertencia al consultar alertas de trámites:', e);
    }
  };

  useEffect(() => {
    if (profile?.cliente_id) {
      fetchTramitesAlerts();
      const interval = setInterval(fetchTramitesAlerts, 20000);
      return () => clearInterval(interval);
    }
  }, [profile?.cliente_id, currentTab]);

  const totalAlerts = tramitesAlerts.pedidosActivosCount + tramitesAlerts.prepedidosPendientesCount + (cart.length > 0 ? 1 : 0);

  // Diagnostic timer for cold start + Precarga de directorio de clientes Cloud
  useEffect(() => {
    console.time('⏱️ [PWA_COLD_START]');
    sincronizarDirectorioCloud(supabase).catch(() => {});
  }, []);

  // Cerrar menu movil al hacer clic afuera
  useEffect(() => {
    function handleClickOutside(event) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target)) {
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getRoutePath = () => {
    const hash = window.location.hash || '';
    if (hash.startsWith('#/')) {
      return hash.slice(1).split('?')[0];
    }
    const pathname = window.location.pathname || '';
    if (pathname.includes('/pre-pedido')) {
      return '/pre-pedido';
    }
    const search = window.location.search || '';
    if (search) {
      try {
        const params = new URLSearchParams(search);
        if (params.get('revisar')) {
          return '/pre-pedido';
        }
        const urlToken = params.get('token') || params.get('t');
        if (urlToken && /^[a-f0-9]{6,64}$/i.test(urlToken.trim())) {
          return '/onboarding';
        }
      } catch (e) {}
    }
    return pathname;
  };

  const [path, setPath] = useState(getRoutePath());

  // PWA beforeinstallprompt listener
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      window.deferredPrompt = e;
      console.log('📌 [B2B-PORTAL] Evento beforeinstallprompt capturado y guardado en window.deferredPrompt');
      window.dispatchEvent(new Event('b2b-pwa-prompt-ready'));
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  // Sync route status with history buttons (back/forward) and hash changes
  useEffect(() => {
    const handleRouteChange = () => {
      setPath(getRoutePath());
    };
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('hashchange', handleRouteChange);
    };
  }, []);

  const navigateTo = (newPath) => {
    if (!newPath || newPath === '/' || newPath === '/login') {
      window.history.pushState({}, '', '/');
      setPath('/');
      return;
    }
    const cleanRoute = newPath.startsWith('#/')
      ? newPath
      : `#/${newPath.replace(/^[#/]+/, '')}`;
    window.location.hash = cleanRoute;
    setPath('/' + cleanRoute.slice(2).split('?')[0]);
  };

  const addToCart = (product, quantity) => {
    const cleanCode = (product.producto_codigo || '').trim();
    const desc = (product.producto_descripcion || cleanCode).trim();
    if (quantity > 0) {
      registrarAccesoTelemetria(`🛒 Carrito: ${desc} (${cleanCode}) — Cant: ${quantity}`, profile, { dedupeMs: 1200 });
    } else {
      registrarAccesoTelemetria(`🗑️ Quitó del carrito: ${desc} (${cleanCode})`, profile, { dedupeMs: 1200 });
    }

    setCart(prev => {
      const idx = prev.findIndex(item => (item.producto_codigo || '').trim() === cleanCode);
      const unitPrice = parseFloat(product.precio_final ?? product.precio_unitario ?? 0);

      if (idx > -1) {
        if (quantity <= 0) {
          // Si se elimina el padre, se eliminan también automáticamente sus ítems de kit vinculados
          return prev.filter(item => (item.producto_codigo || '').trim() !== cleanCode && item.kit_parent !== cleanCode);
        }
        const newCart = [...prev];
        const prevQty = newCart[idx].cantidad;
        newCart[idx].cantidad = quantity;
        newCart[idx].subtotal = quantity * (unitPrice > 0 ? unitPrice : (newCart[idx].precio_unitario || 0));

        // Si el artículo padre tiene insumos de kit vinculados, escalar sus cantidades proporcionalmente
        if (prevQty > 0 && prevQty !== quantity) {
          const ratio = quantity / prevQty;
          newCart.forEach(item => {
            if (item.kit_parent === cleanCode) {
              item.cantidad = Math.round(item.cantidad * ratio * 100) / 100;
              item.subtotal = Math.round(item.cantidad * item.precio_unitario * 100) / 100;
            }
          });
        }
        return newCart;
      } else {
        if (quantity <= 0) return prev;
        const newItems = [{
          producto_codigo: cleanCode,
          producto_descripcion: product.producto_descripcion,
          cantidad: quantity,
          precio_unitario: unitPrice,
          subtotal: quantity * unitPrice
        }];

        // Si se agregó con kit activado
        if (Array.isArray(product.kit_items) && product.kit_items.length > 0) {
          product.kit_items.forEach(k => {
            const kQty = Math.round(quantity * parseFloat(k.cantidad_ratio) * 100) / 100;
            const kPrice = parseFloat(k.precio_unitario);
            newItems.push({
              producto_codigo: String(k.ingrediente_codigo || k.ingrediente_id),
              producto_descripcion: `${k.descripcion} (Kit Insumos)`,
              cantidad: kQty,
              precio_unitario: kPrice,
              subtotal: Math.round(kQty * kPrice * 100) / 100,
              kit_parent: cleanCode,
              is_kit_item: true
            });
          });
        }
        return [...prev, ...newItems];
      }
    });
  };

  const removeFromCart = (productCodigo) => {
    const cleanCode = (productCodigo || '').trim();
    registrarAccesoTelemetria(`🗑️ Quitó del carrito: ${cleanCode}`, profile, { dedupeMs: 1200 });
    setCart(prev => prev.filter(item => (item.producto_codigo || '').trim() !== cleanCode && item.kit_parent !== cleanCode));
  };

  const toggleKitInCart = (parentCodigo, isChecked, kitList = []) => {
    const cleanParent = (parentCodigo || '').trim();
    setCart(prev => {
      const parent = prev.find(item => (item.producto_codigo || '').trim() === cleanParent);
      if (!isChecked) {
        // Remover hijos del kit
        return prev.filter(item => item.kit_parent !== cleanParent);
      }
      if (!parent || parent.cantidad <= 0) return prev;

      // Limpiar existentes antes de inyectar
      const filtered = prev.filter(item => item.kit_parent !== cleanParent);
      const newKitItems = (kitList || []).map(k => {
        const kQty = Math.round(parent.cantidad * parseFloat(k.cantidad_ratio) * 100) / 100;
        const kPrice = parseFloat(k.precio_unitario);
        return {
          producto_codigo: String(k.ingrediente_codigo || k.ingrediente_id),
          producto_descripcion: `${k.descripcion} (Kit Insumos)`,
          cantidad: kQty,
          precio_unitario: kPrice,
          subtotal: Math.round(kQty * kPrice * 100) / 100,
          kit_parent: cleanParent,
          is_kit_item: true
        };
      });
      return [...filtered, ...newKitItems];
    });
  };

  const clearCart = () => {
    setCart([]);
  };

  // Detectar parámetros de Deep Link en la URL al montar
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    const docId = params.get('doc_id');

    if (action === 'view-doc' && docId) {
      console.log('📌 [B2B-PORTAL] Deep Link detectado en URL:', { action, docId });
      localStorage.setItem('pending_action', JSON.stringify({ action, doc_id: docId }));
      // Limpiar URL para una navegación limpia
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Detectar si el usuario ingresó por enlace de vinculación rápida de dispositivo (Magic Link)
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    if (hash.includes('type=magiclink') || hash.includes('access_token=') || search.includes('type=magiclink')) {
      console.log('📱 [B2B-PORTAL] Ingreso detectado por enlace de vinculación de dispositivo');
      sessionStorage.setItem('b2b_device_paired', 'true');
    }
  }, []);

  // Verificar y ejecutar acciones pendientes cuando la sesión esté lista
  useEffect(() => {
    if (session && profile) {
      const stored = localStorage.getItem('pending_action');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.action === 'view-doc' && parsed.doc_id) {
            console.log('🚀 [B2B-PORTAL] Ejecutando Deep Link pendiente para doc_id:', parsed.doc_id);
            setPendingAction(parsed);
            setCurrentTab('cc');
          }
        } catch (e) {
          console.error('Error al procesar pending_action de localStorage:', e);
        }
        localStorage.removeItem('pending_action');
      }
    }
  }, [session, profile]);

  // Registrar navegación entre pestañas del Portal B2B
  const prevTabRef = useRef(null);
  useEffect(() => {
    if (!session || !profile) return;
    if (prevTabRef.current === currentTab) return;
    const isInitialHome = prevTabRef.current === null && currentTab === 'home';
    prevTabRef.current = currentTab;

    if (isInitialHome) {
      registrarAccesoTelemetria('🏠 Sección: Inicio Portal B2B', profile, { dedupeMs: 15000 });
      return;
    }
    const labels = {
      home: '🏠 Sección: Inicio Portal B2B',
      pedidos: '📋 Sección: Mi Pedido y Carrito',
      retiros: '🚚 Sección: Devoluciones y Retiros',
      servicios_colaborador: '🛠️ Sección: Mis Servicios y Tarifas'
    };
    if (labels[currentTab]) {
      registrarAccesoTelemetria(labels[currentTab], profile, { dedupeMs: 4000 });
    }
  }, [currentTab, session, profile?.cliente_id]);

  useEffect(() => {
    // Escuchar cambios de autenticación (se dispara automáticamente con INITIAL_SESSION al iniciar)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authPerfRef.current = performance.now();
      const authDuration = Math.round(authPerfRef.current - mountPerfRef.current);
      setMetrics(prev => ({
        ...prev,
        authMs: authDuration
      }));

      setSession(session);
      if (session) {
        fetchProfileAndClaims(session, _event);
      } else {
        if (_event === 'SIGNED_OUT') {
          setProfile(null);
          localStorage.removeItem('b2b_cached_profile');
        }
        setLoadingSession(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfileAndClaims = async (currSession, authEvent = 'INITIAL_SESSION') => {
    const user = currSession.user;
    const profileStart = performance.now();
    
    // Intentar leer las claims directamente del JWT (inyectadas por el Auth Hook)
    const jwtClienteId = user.app_metadata?.cliente_id || user.user_metadata?.cliente_id;
    const jwtRol = user.app_metadata?.rol || user.user_metadata?.rol;
    const jwtPermisos = user.app_metadata?.permisos || user.user_metadata?.permisos || [];
    const jwtListas = user.app_metadata?.listas_precios || user.user_metadata?.listas_precios || [];

    let prof = null;

    if (jwtClienteId) {
      prof = {
        id: user.id,
        email: user.email,
        cliente_id: jwtClienteId,
        rol: jwtRol || 'Dueno',
        permisos: jwtPermisos,
        listas_precios: jwtListas,
        nombre_completo: user.user_metadata?.nombre_completo || '',
        nombre_empresa: user.user_metadata?.nombre_empresa || '',
        ver_stock: user.app_metadata?.ver_stock || false
      };

      // Consultar en caliente clientes_b2b_perfiles para asegurar permisos y ver_stock actualizados
      try {
        const { data: dbProf } = await supabase
          .from('clientes_b2b_perfiles')
          .select('*')
          .eq('cliente_id', jwtClienteId)
          .maybeSingle();

        if (dbProf) {
          if (Array.isArray(dbProf.permisos)) {
            prof.permisos = dbProf.permisos;
            // La fuente de la verdad para ver_stock es la inclusión en el array permisos
            prof.ver_stock = dbProf.permisos.includes('ver_stock');
          } else if (dbProf.ver_stock !== undefined) {
            prof.ver_stock = Boolean(dbProf.ver_stock);
          } else {
            prof.ver_stock = false;
          }
          if (dbProf.nombre_completo) prof.nombre_completo = dbProf.nombre_completo;
          if (dbProf.nombre_empresa) prof.nombre_empresa = dbProf.nombre_empresa;
          prof.habilitar_kits_produccion = Boolean(dbProf.habilitar_kits_produccion) || 
            (Array.isArray(dbProf.permisos) && dbProf.permisos.includes('habilitar_kits_produccion')) || 
            dbProf.cliente_id === 'CB-0006';
        }

        // Asegurar que las listas de precios estén cargadas en caliente si aún no figuran en el JWT
        if (!Array.isArray(prof.listas_precios) || prof.listas_precios.length === 0) {
          const { data: dbLists } = await supabase
            .from('clientes_b2b_perfiles_listas')
            .select('lista_id, fecha_inicio');
          if (Array.isArray(dbLists) && dbLists.length > 0) {
            const hasRealLists = dbLists.some(l => l.fecha_inicio === null);
            const filteredLists = hasRealLists
              ? dbLists.filter(l => !(l.lista_id === 1 && l.fecha_inicio !== null))
              : dbLists;
            prof.listas_precios = filteredLists.map(l => l.lista_id);
          }
        }
      } catch (errDb) {
        console.warn('⚠️ [B2B-PROFILE] Error consultando perfil en caliente:', errDb);
      }
    } else {
      // Fallback: Si no están en el JWT (ej: primer login o hook no disparado aún), 
      // hacemos consulta directa a la base de datos de Supabase.
      try {
        const { data: dbProfile } = await supabase
          .from('clientes_b2b_perfiles')
          .select('*')
          .single();

        const { data: dbLists } = await supabase
          .from('clientes_b2b_perfiles_listas')
          .select('lista_id');

        prof = {
          ...dbProfile,
          email: user.email,
          listas_precios: (dbLists || []).map(l => l.lista_id),
          habilitar_kits_produccion: Boolean(dbProfile?.habilitar_kits_produccion) || 
            (Array.isArray(dbProfile?.permisos) && dbProfile.permisos.includes('habilitar_kits_produccion')) || 
            dbProfile?.cliente_id === 'CB-0006'
        };
      } catch (err) {
        console.warn('Advertencia al cargar perfil localmente:', err.message);
        prof = {
          id: user.id,
          email: user.email,
          nombre_completo: user.user_metadata?.nombre_completo || user.email,
          nombre_empresa: 'Cliente Portal B2B',
          listas_precios: []
        };
      }
    }

    // Priorizar email real del usuario autenticado o su razón social
    const realEmail = user.email || user.user_metadata?.email;
    const realNombre = (user.user_metadata?.nombre_empresa && user.user_metadata.nombre_empresa !== 'Cliente Portal B2B') 
      ? user.user_metadata.nombre_empresa 
      : (user.user_metadata?.nombre_completo || realEmail || (prof.cliente_id ? `Cliente ${prof.cliente_id}` : 'Cliente PWA'));

    const clienteNombreStr = realNombre;
    setProfile(prev => {
      try {
        if (prev && JSON.stringify(prev) === JSON.stringify(prof)) return prev;
      } catch {}
      return prof;
    });
    
    try { 
      localStorage.setItem('b2b_cached_profile', JSON.stringify(prof));
      localStorage.setItem('b2b_cliente_nombre', clienteNombreStr);
      localStorage.setItem('b2b_user_email', realEmail || '');
    } catch {}
    
    setLoadingSession(false);

    // 📱 Notificación de bienvenida y sincronización de sesión si se ingresó mediante vinculación rápida
    try {
      if (sessionStorage.getItem('b2b_device_paired') === 'true') {
        sessionStorage.removeItem('b2b_device_paired');
        if (window.location.hash.includes('access_token')) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        Swal.fire({
          title: '¡Dispositivo vinculado con éxito!',
          html: `Bienvenido, <b>${clienteNombreStr}</b>.<br><small style="color:var(--text-muted)">Sesión contable sincronizada correctamente en este equipo.</small>`,
          icon: 'success',
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 5000,
          timerProgressBar: true,
          background: 'hsl(222, 47%, 11%)',
          color: 'var(--text-primary)',
          iconColor: 'var(--success)'
        });
      }
    } catch (eToast) {
      console.warn('Advertencia toast vinculación:', eToast);
    }

    // ⚡ Registrar presencia real de usuario autenticado (evitando falsos pings por TOKEN_REFRESHED en segundo plano)
    try {
      const isBackgroundRefresh = authEvent === 'TOKEN_REFRESHED' || document.visibilityState === 'hidden';
      if (!isBackgroundRefresh) {
        registrarAccesoTelemetria('Sesión Activa PWA', realNombre, { dedupeMs: 120000 });
      }
    } catch (e) {}

    const profileDuration = Math.round(performance.now() - (profileStart || authPerfRef.current));
    const navStart = window.__PWA_NAV_START__ || Date.now();
    setMetrics(prev => ({
      ...prev,
      profileMs: profileDuration,
      totalMs: Date.now() - navStart
    }));
  };

  // 🚀 RUTAS PÚBLICAS ULTRA-RÁPIDAS (Sin esperar verificación de sesión)
  const currentHash = window.location.hash || '';
  const currentPathname = window.location.pathname || '';
  const isEnsobradoRoute = path.startsWith('/ensobrado/') || 
                          path.startsWith('ensobrado/') || 
                          path.startsWith('/ensobrado') || 
                          currentHash.includes('/ensobrado/') || 
                          currentHash.includes('#ensobrado/') ||
                          currentPathname.includes('/ensobrado/');

  if (isEnsobradoRoute) {
    return (
      <Suspense fallback={
        <div className="spinner-container" style={{ minHeight: '100vh', width: '100vw' }}>
          <Loader2 className="spinner" />
          <p style={{ color: 'var(--text-secondary)' }}>Cargando asistente de ensobrado...</p>
        </div>
      }>
        <EnsobradoPublico path={currentHash || currentPathname || path} />
      </Suspense>
    );
  }

  const isCheckinRoute = path.startsWith('/checkin/') || 
                        path.startsWith('checkin/') || 
                        path.startsWith('/checkin') || 
                        currentHash.includes('/checkin/') ||
                        currentPathname.includes('/checkin/');

  if (isCheckinRoute) {
    return (
      <Suspense fallback={
        <div className="spinner-container" style={{ minHeight: '100vh', width: '100vw' }}>
          <Loader2 className="spinner" />
          <p style={{ color: 'var(--text-secondary)' }}>Cargando asistente de retiro...</p>
        </div>
      }>
        <CheckinPublico path={path} />
      </Suspense>
    );
  }

  const isPrePedidoRoute = path.startsWith('/pre-pedido') || 
                          path.startsWith('pre-pedido') || 
                          currentHash.includes('pre-pedido') || 
                          currentPathname.includes('/pre-pedido');

  if (isPrePedidoRoute) {
    return (
      <Suspense fallback={
        <div className="spinner-container" style={{ minHeight: '100vh', width: '100vw' }}>
          <Loader2 className="spinner" />
          <p style={{ color: 'var(--text-secondary)' }}>Cargando lista de reposición...</p>
        </div>
      }>
        <PrePedidoPublico path={currentHash || currentPathname || path} />
      </Suspense>
    );
  }

  if (loadingSession) {
    return (
      <div className="spinner-container" style={{ minHeight: '100vh', width: '100vw' }}>
        <Loader2 className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Verificando sesión contable...</p>
      </div>
    );
  }

  // Lightweight routing logic for Onboarding and Account Activation
  if (path === '/onboarding' || path.startsWith('/onboarding')) {
    return <Onboarding onNavigate={navigateTo} />;
  }

  if (path === '/activar' || path.startsWith('/activar')) {
    return <ActivarCuenta onNavigate={navigateTo} />;
  }

  if (path.startsWith('/recepcion/') || path.startsWith('recepcion/')) {
    return <RecepcionPedido path={path} onNavigate={navigateTo} />;
  }

  if (!session) {
    return <Login onNavigate={navigateTo} />;
  }

  return (
    <div className="app-container">
      {/* Mobile Top Header (visible solo en celulares/tablets fuera de la Home) */}
      {currentTab !== 'home' && (
        <header className="mobile-header" ref={mobileMenuRef}>
          <div style={{ display: 'flex', alignItems: 'center', width: '32px' }}>
            <img 
              src="/isotipo_L_LAMDA.png?v=5" 
              alt="L" 
              className="mobile-header-logo" 
              onClick={() => setCurrentTab('home')} 
              style={{ maxHeight: '26px', maxWidth: '26px', cursor: 'pointer', objectFit: 'contain' }}
            />
          </div>

          <span className="mobile-header-title" style={{ fontWeight: '750', fontSize: '1.15rem', color: 'var(--text-primary)', textAlign: 'center', flex: 1, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}>
            {canToggleIva && currentTab === 'articulos' && (
              <button 
                onClick={() => setOpenIvaModalTrigger(prev => prev + 1)}
                className="b2b-mobile-header-gear-btn"
                title="Configurar modalidad de precios (Con IVA / Sin IVA)"
                aria-label="Configurar IVA"
              >
                <Settings size={16} />
              </button>
            )}
            <span>
              {currentTab === 'articulos' ? 'Artículos' : (currentTab === 'pedidos' ? 'Mi Pedido' : (currentTab === 'cc' ? 'Cta. Corriente' : (currentTab === 'retiros' ? 'Devoluciones' : '')))}
            </span>
          </span>

          <div style={{ position: 'relative', width: '32px', display: 'flex', justifyContent: 'flex-end' }}>
            <button 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-glass)',
                borderRadius: '6px',
                padding: '0.4rem 0.5rem',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'var(--transition-smooth)'
              }}
            >
              <Menu size={18} />
            </button>
            
            {mobileMenuOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 0.5rem)',
                right: 0,
                background: 'var(--bg-sidebar)',
                border: '1px solid var(--border-glass)',
                borderRadius: '8px',
                padding: '0.4rem',
                zIndex: 1000,
                width: '180px',
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.2rem'
              }}>
                <button 
                  onClick={() => { setCurrentTab('home'); setMobileMenuOpen(false); }} 
                  className={`mobile-menu-item ${currentTab === 'home' ? 'active' : ''}`}
                >
                  <HomeIcon size={14} />
                  <span>Inicio</span>
                </button>
                <button 
                  onClick={() => { setCurrentTab('articulos'); setMobileMenuOpen(false); }} 
                  className={`mobile-menu-item ${currentTab === 'articulos' ? 'active' : ''}`}
                >
                  <BookOpen size={14} />
                  <span>Artículos</span>
                </button>
                <button 
                  onClick={() => { setCurrentTab('pedidos'); setMobileMenuOpen(false); }} 
                  className={`mobile-menu-item ${currentTab === 'pedidos' ? 'active' : ''}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ClipboardList size={14} />
                    <span>Mi Pedido</span>
                  </div>
                  {totalAlerts > 0 && (
                    <span className="b2b-nav-badge" style={{ fontSize: '0.68rem', minWidth: '18px', height: '18px' }}>
                      {totalAlerts}
                    </span>
                  )}
                </button>
                <button 
                  onClick={() => { setCurrentTab('cc'); setMobileMenuOpen(false); }} 
                  className={`mobile-menu-item ${currentTab === 'cc' ? 'active' : ''}`}
                >
                  <Receipt size={14} />
                  <span>Cta. Corriente</span>
                </button>
                <button 
                  onClick={() => { setCurrentTab('pagos_efectivo'); setMobileMenuOpen(false); }} 
                  className={`mobile-menu-item ${currentTab === 'pagos_efectivo' ? 'active' : ''}`}
                >
                  <Banknote size={14} />
                  <span>Aviso de Ensobrado (Efectivo)</span>
                </button>
                <button 
                  onClick={() => { setCurrentTab('retiros'); setMobileMenuOpen(false); }} 
                  className={`mobile-menu-item ${currentTab === 'retiros' ? 'active' : ''}`}
                >
                  <Truck size={14} />
                  <span>Devoluciones</span>
                </button>
                {(profile?.permisos?.includes('servicios_colaborador') || profile?.cliente_id === 'CB-0006') && (
                  <button 
                    onClick={() => { setCurrentTab('servicios_colaborador'); setMobileMenuOpen(false); }} 
                    className={`mobile-menu-item ${currentTab === 'servicios_colaborador' ? 'active' : ''}`}
                    style={{ color: '#fbbf24' }}
                  >
                    <Wrench size={14} />
                    <span>Mis Servicios y Tarifas</span>
                  </button>
                )}
                <button 
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setShowVincularModal(true);
                  }} 
                  className="mobile-menu-item"
                  style={{ color: 'var(--text-primary)', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '4px', paddingTop: '8px' }}
                >
                  <Smartphone size={14} style={{ color: 'var(--accent)' }} />
                  <span>Vincular otro equipo</span>
                </button>
                <button 
                  onClick={async () => {
                    setMobileMenuOpen(false);
                    localStorage.removeItem('b2b_cached_profile');
                    await supabase.auth.signOut();
                  }} 
                  className="mobile-menu-item"
                  style={{ color: '#ef4444' }}
                >
                  <LogOut size={14} />
                  <span>Cerrar Sesión</span>
                </button>
              </div>
            )}
          </div>
        </header>
      )}

      <Sidebar 
        profile={profile} 
        currentTab={currentTab} 
        setCurrentTab={setCurrentTab} 
        totalAlerts={totalAlerts}
        onOpenVincularModal={() => setShowVincularModal(true)}
      />
      
      <main className="main-content">
        <Suspense fallback={
          <div className="spinner-container">
            <Loader2 className="spinner" />
            <p style={{ color: 'var(--text-secondary)' }}>Cargando módulo...</p>
          </div>
        }>
          {currentTab === 'home' && (
            <Home 
              setCurrentTab={setCurrentTab} 
              profile={profile} 
              tramitesAlerts={tramitesAlerts}
              cart={cart}
              totalAlerts={totalAlerts}
              onOpenVincularModal={() => setShowVincularModal(true)}
            />
          )}
          {currentTab === 'articulos' && (
            <Articulos 
              profile={profile} 
              cart={cart}
              addToCart={addToCart}
              removeFromCart={removeFromCart}
              toggleKitInCart={toggleKitInCart}
              clearCart={clearCart}
              setCurrentTab={setCurrentTab}
              onCanToggleIvaChanged={setCanToggleIva}
              openIvaModalTrigger={openIvaModalTrigger}
            />
          )}
          {currentTab === 'pedidos' && (
            <Pedidos 
              profile={profile}
              cart={cart}
              addToCart={addToCart}
              removeFromCart={removeFromCart}
              clearCart={clearCart}
              setCurrentTab={setCurrentTab}
            />
          )}
          {currentTab === 'cc' && (
            <CuentaCorriente 
              profile={profile} 
              highlightDocId={pendingAction?.doc_id} 
              onClearHighlight={() => setPendingAction(null)} 
            />
          )}
          {currentTab === 'pagos_efectivo' && (
            <PagosEfectivo 
              profile={profile}
              onNavigateToCC={() => setCurrentTab('cc')}
              onNavigateToHome={() => setCurrentTab('home')}
            />
          )}
          {currentTab === 'retiros' && (
            <Retiros 
              profile={profile} 
            />
          )}
          {currentTab === 'servicios_colaborador' && (
            <ServiciosColaborador 
              profile={profile} 
              setCurrentTab={setCurrentTab}
            />
          )}
        </Suspense>
      </main>

      {/* Botón Flotante de WhatsApp para Atención Comercial Directa */}
      <a
        href="https://wa.me/5492216615746?text=Hola!%20Quisiera%20hacer%20una%20consulta%20desde%20el%20Portal%20B2B"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => registrarAccesoTelemetria('💬 Clic en Botón WhatsApp de Consulta Comercial', profile)}
        title="Enviar consulta por WhatsApp al 221 661-5746"
        style={{
          position: 'fixed',
          bottom: '22px',
          right: '22px',
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #25D366 0%, #128C7E 100%)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 6px 24px rgba(37, 211, 102, 0.4)',
          zIndex: 999,
          transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
          textDecoration: 'none'
        }}
        className="whatsapp-float-btn"
      >
        <MessageSquare size={26} />
      </a>
      <style>{`
        .whatsapp-float-btn:hover {
          transform: scale(1.1);
          box-shadow: 0 8px 30px rgba(37, 211, 102, 0.6);
        }
      `}</style>

      {/* Modal de Vinculación Rápida de Dispositivo (QR + WhatsApp) */}
      <VincularDispositivoModal 
        isOpen={showVincularModal}
        onClose={() => setShowVincularModal(false)}
        profile={profile}
        session={session}
      />
    </div>
  );
}
