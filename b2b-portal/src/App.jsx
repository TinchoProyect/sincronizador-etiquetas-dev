import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import ActivarCuenta from './pages/ActivarCuenta';
import Home from './pages/Home';
import Catalogo from './pages/Catalogo';
import CuentaCorriente from './pages/CuentaCorriente';
import Pedidos from './pages/Pedidos';
import { Loader2, Menu, Home as HomeIcon, BookOpen, ClipboardList, Receipt } from 'lucide-react';

export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [currentTab, setCurrentTab] = useState('home');
  const [cart, setCart] = useState([]);
  const [pendingAction, setPendingAction] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef(null);

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
    const hash = window.location.hash;
    if (hash.startsWith('#/')) {
      return hash.slice(1).split('?')[0];
    }
    return window.location.pathname;
  };

  const [path, setPath] = useState(getRoutePath());

  // PWA beforeinstallprompt listener
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      window.deferredPrompt = e;
      console.log('📌 [B2B-PORTAL] Evento beforeinstallprompt capturado y guardado en window.deferredPrompt');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  // Sync route status with history buttons (back/forward)
  useEffect(() => {
    const handlePopState = () => {
      setPath(getRoutePath());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (newPath) => {
    if (newPath.startsWith('#/')) {
      window.location.hash = newPath;
    } else {
      window.history.pushState({}, '', newPath);
    }
    setPath(newPath.replace('#', ''));
  };

  const addToCart = (product, quantity) => {
    setCart(prev => {
      const idx = prev.findIndex(item => item.producto_codigo === product.producto_codigo);
      if (idx > -1) {
        if (quantity <= 0) {
          return prev.filter(item => item.producto_codigo !== product.producto_codigo);
        }
        const newCart = [...prev];
        newCart[idx].cantidad = quantity;
        newCart[idx].subtotal = quantity * parseFloat(product.precio_final);
        return newCart;
      } else {
        if (quantity <= 0) return prev;
        return [...prev, {
          producto_codigo: product.producto_codigo,
          producto_descripcion: product.producto_descripcion,
          cantidad: quantity,
          precio_unitario: parseFloat(product.precio_final),
          subtotal: quantity * parseFloat(product.precio_final)
        }];
      }
    });
  };

  const removeFromCart = (productCodigo) => {
    setCart(prev => prev.filter(item => item.producto_codigo !== productCodigo));
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

  useEffect(() => {
    // 1. Obtener sesión inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        fetchProfileAndClaims(session);
      } else {
        setLoadingSession(false);
      }
    });

    // 2. Suscribirse a cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        fetchProfileAndClaims(session);
      } else {
        setProfile(null);
        setLoadingSession(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfileAndClaims = async (currSession) => {
    const user = currSession.user;
    
    // Intentar leer las claims directamente del JWT (inyectadas por el Auth Hook)
    const jwtClienteId = user.app_metadata?.cliente_id || user.user_metadata?.cliente_id;
    const jwtRol = user.app_metadata?.rol || user.user_metadata?.rol;
    const jwtPermisos = user.app_metadata?.permisos || user.user_metadata?.permisos || [];
    const jwtListas = user.app_metadata?.listas_precios || user.user_metadata?.listas_precios || [];

    if (jwtClienteId) {
      setProfile({
        id: user.id,
        email: user.email,
        cliente_id: jwtClienteId,
        rol: jwtRol || 'Dueno',
        permisos: jwtPermisos,
        listas_precios: jwtListas,
        nombre_completo: user.user_metadata?.nombre_completo || '',
        nombre_empresa: user.user_metadata?.nombre_empresa || ''
      });
      setLoadingSession(false);
      return;
    }

    // Fallback: Si no están en el JWT (ej: primer login o hook no disparado aún), 
    // hacemos consulta directa a la base de datos de Supabase.
    try {
      const { data: dbProfile, error: profileErr } = await supabase
        .from('clientes_b2b_perfiles')
        .select('*')
        .single();

      if (profileErr) throw profileErr;

      const { data: dbLists, error: listsErr } = await supabase
        .from('clientes_b2b_perfiles_listas')
        .select('lista_id');

      if (listsErr) throw listsErr;

      setProfile({
        ...dbProfile,
        listas_precios: dbLists.map(l => l.lista_id)
      });
    } catch (err) {
      console.warn('Advertencia al cargar perfil localmente:', err.message);
      // Fallback mínimo con datos del usuario auth
      setProfile({
        id: user.id,
        email: user.email,
        nombre_completo: user.user_metadata?.nombre_completo || user.email,
        nombre_empresa: 'Cliente Registrado',
        listas_precios: []
      });
    } finally {
      setLoadingSession(false);
    }
  };

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

  if (!session) {
    return <Login onNavigate={navigateTo} />;
  }

  return (
    <div className="app-container">
      {/* Mobile Top Header (visible solo en celulares/tablets fuera de la Home) */}
      {currentTab !== 'home' && (
        <header className="mobile-header" ref={mobileMenuRef}>
          <img 
            src="/logo_LAMDA.png" 
            alt="LAMDA Logo" 
            className="mobile-header-logo" 
            onClick={() => setCurrentTab('home')} 
            style={{ maxHeight: '28px', cursor: 'pointer' }}
          />
          
          <div style={{ position: 'relative' }}>
            <button 
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-glass)',
                borderRadius: '6px',
                padding: '0.4rem 0.6rem',
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
                  onClick={() => { setCurrentTab('catalogo'); setMobileMenuOpen(false); }} 
                  className={`mobile-menu-item ${currentTab === 'catalogo' ? 'active' : ''}`}
                >
                  <BookOpen size={14} />
                  <span>Catálogo</span>
                </button>
                <button 
                  onClick={() => { setCurrentTab('pedidos'); setMobileMenuOpen(false); }} 
                  className={`mobile-menu-item ${currentTab === 'pedidos' ? 'active' : ''}`}
                >
                  <ClipboardList size={14} />
                  <span>Mi Pedido</span>
                </button>
                <button 
                  onClick={() => { setCurrentTab('cc'); setMobileMenuOpen(false); }} 
                  className={`mobile-menu-item ${currentTab === 'cc' ? 'active' : ''}`}
                >
                  <Receipt size={14} />
                  <span>Cta. Corriente</span>
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
      />
      
      <main className="main-content">
        {currentTab === 'home' && (
          <Home 
            setCurrentTab={setCurrentTab} 
            profile={profile} 
          />
        )}
        {currentTab === 'catalogo' && (
          <Catalogo 
            profile={profile} 
            cart={cart}
            addToCart={addToCart}
            removeFromCart={removeFromCart}
            clearCart={clearCart}
          />
        )}
        {currentTab === 'pedidos' && (
          <Pedidos 
            profile={profile}
          />
        )}
        {currentTab === 'cc' && (
          <CuentaCorriente 
            profile={profile} 
            highlightDocId={pendingAction?.doc_id} 
            onClearHighlight={() => setPendingAction(null)} 
          />
        )}
      </main>
    </div>
  );
}
