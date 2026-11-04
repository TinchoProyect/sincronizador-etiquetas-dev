import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Smartphone, X, Download, Share, Home as HomeIcon, BookOpen, ClipboardList, Receipt, Truck, Banknote, CheckCircle2, RotateCcw, Wrench, Flame, CreditCard, ShieldCheck } from 'lucide-react';
import InfoComercialModal from '../components/InfoComercialModal';
import { fetchInfoComercialCliente } from '../utils/infoComercialB2B';
import { registrarAccesoTelemetria } from '../utils/telemetria';

export default function Home({ setCurrentTab, profile, tramitesAlerts = { pedidosActivosCount: 0, prepedidosPendientesCount: 0 }, cart = [], totalAlerts = 0, onOpenVincularModal }) {
  const [showPwaModal, setShowPwaModal] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [hasPrompt, setHasPrompt] = useState(false);
  const [isStandaloneApp, setIsStandaloneApp] = useState(false);
  const [shortcutDownloaded, setShortcutDownloaded] = useState(false);
  const [showChromeTips, setShowChromeTips] = useState(false);

  // Estado dinámico para Información y Condiciones Comerciales (Ofertas, Pagos, Asistencia)
  const [infoComercial, setInfoComercial] = useState(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoModalTab, setInfoModalTab] = useState('promos');

  useEffect(() => {
    if (profile?.cliente_id) {
      fetchInfoComercialCliente(profile).then(data => {
        if (data) setInfoComercial(data);
      });
    }
  }, [profile?.cliente_id]);

  const handleOpenInfoModal = (tab = 'promos') => {
    setInfoModalTab(tab);
    setShowInfoModal(true);
    const labelTab = tab === 'promos' ? 'Promos y Bonificaciones' : (tab === 'pagos' ? 'Plazos y Medios de Pago' : 'Asistencia Comercial');
    registrarAccesoTelemetria(`📢 Consultó Condiciones Comerciales: ${labelTab}`, profile);
  };

  useEffect(() => {
    // 1. Limpieza de residuos de localStorage antiguo que pudieran haber quedado grabados
    localStorage.removeItem('pwa_installed');

    // 2. Detección real de modo Standalone (Ventana de App instalada en ejecución)
    const standalone = (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      (document.referrer && document.referrer.includes('android-app://'))
    );
    setIsStandaloneApp(standalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const iosDevice = /iphone|ipad|ipod/.test(userAgent) && !window.MSStream;
    setIsIos(iosDevice);

    const desktopDevice = !/android|iphone|ipad|ipod|mobile/.test(userAgent);
    setIsDesktop(desktopDevice);

    if (window.deferredPrompt) {
      setHasPrompt(true);
    }

    const handlePromptReady = () => {
      console.log('⚡ [Home] Evento b2b-pwa-prompt-ready recibido. Prompt disponible.');
      setHasPrompt(true);
    };
    window.addEventListener('b2b-pwa-prompt-ready', handlePromptReady);

    const handleAppInstalled = () => {
      console.log('📌 [Home] Evento appinstalled detectado');
      setShowPwaModal(false);
    };
    window.addEventListener('appinstalled', handleAppInstalled);

    const justActivated = sessionStorage.getItem('just_activated') === 'true';
    if (justActivated) {
      localStorage.removeItem('pwa_install_dismissed');
    }
    const isDismissed = localStorage.getItem('pwa_install_dismissed') === 'true';

    // Abrir automáticamente SOLO en primera conexión móvil si recién se activa o no fue descartado y no está en modo standalone
    if (!standalone && !desktopDevice && (justActivated || !isDismissed)) {
      const timer = setTimeout(() => {
        setHasPrompt(!!window.deferredPrompt);
        setShowPwaModal(true);
      }, justActivated ? 600 : 1600);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('b2b-pwa-prompt-ready', handlePromptReady);
        window.removeEventListener('appinstalled', handleAppInstalled);
      };
    }

    return () => {
      window.removeEventListener('b2b-pwa-prompt-ready', handlePromptReady);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (window.deferredPrompt) {
      try {
        window.deferredPrompt.prompt();
        const { outcome } = await window.deferredPrompt.userChoice;
        console.log(`📌 [PWA] Elección de instalación del usuario: ${outcome}`);
        if (outcome === 'accepted') {
          sessionStorage.removeItem('just_activated');
          setShowPwaModal(false);
        }
        window.deferredPrompt = null;
        setHasPrompt(false);
      } catch (err) {
        console.warn('Error al invocar prompt de instalación:', err);
      }
    }
  };

  const handleDesktopShortcutDownload = async () => {
    if (window.deferredPrompt) {
      try {
        window.deferredPrompt.prompt();
        const { outcome } = await window.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          sessionStorage.removeItem('just_activated');
          setShowPwaModal(false);
        }
        window.deferredPrompt = null;
        setHasPrompt(false);
        return;
      } catch (err) {
        console.warn('Error al invocar prompt:', err);
      }
    }

    // Generar y descargar acceso directo de Windows (.url) con 1 clic
    try {
      const portalUrl = window.location.origin;
      const fileContent = `[InternetShortcut]\r\nURL=${portalUrl}/\r\nIconFile=${portalUrl}/favicon.ico\r\nIconIndex=0\r\n`;
      const blob = new Blob([fileContent], { type: 'application/internet-shortcut;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'LAMDA - Portal B2B.url';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShortcutDownloaded(true);
    } catch (err) {
      console.error('Error al generar acceso directo:', err);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa_install_dismissed', 'true');
    sessionStorage.removeItem('just_activated');
    setShowPwaModal(false);
    setShortcutDownloaded(false);
    setShowChromeTips(false);
  };

  const handleNavigation = (tabId) => {
    setCurrentTab(tabId);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', justifyContent: 'flex-start', alignItems: 'center', position: 'relative', paddingBottom: '2.5rem' }}>
      
      {/* Contenedor Principal Despejado */}
      <div style={{ 
        width: '100%', 
        maxWidth: '480px', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        textAlign: 'center',
        padding: '1.25rem 1rem',
        animation: 'fadeIn 0.6s ease-out'
      }}>
        
        {/* Logotipo en alta definición */}
        <div style={{ marginBottom: '1.5rem' }}>
          <img 
            src="/logo_LAMDA.png?v=4" 
            alt="LAMDA Logo" 
            style={{ 
              maxHeight: '60px', 
              maxWidth: '100%', 
              height: 'auto', 
              filter: 'drop-shadow(0 0 15px rgba(255,255,255,0.05))'
            }} 
          />
        </div>

        {/* Bajada de Texto Institucional */}
        <div style={{ marginBottom: totalAlerts > 0 ? '1rem' : '1.5rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.25rem', letterSpacing: '-0.01em' }}>
            Portal de autogestión comercial
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Seleccione la sección para operar.
          </p>
        </div>

        {/* Banner de Alerta de Pedidos y Trámites Activos */}
        {totalAlerts > 0 && (
          <div 
            onClick={() => handleNavigation('pedidos')}
            className="home-alert-tramites-card"
            title="Ir a gestionar tus pedidos activos"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '1.35rem' }}>⚠️</span>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f8fafc' }}>
                  Tenés {totalAlerts} trámite{totalAlerts > 1 ? 's' : ''} de pedido activo{totalAlerts > 1 ? 's' : ''}
                </div>
                <div style={{ fontSize: '0.73rem', color: '#cbd5e1', marginTop: '1px' }}>
                  {tramitesAlerts.prepedidosPendientesCount > 0 && `${tramitesAlerts.prepedidosPendientesCount} lista(s) de colaborador recibida(s) • `}
                  {tramitesAlerts.pedidosActivosCount > 0 && `${tramitesAlerts.pedidosActivosCount} pedido(s) en trámite • `}
                  {cart.length > 0 && `Borrador en carrito (${cart.length} ítems)`}
                </div>
              </div>
            </div>
            <div style={{
              background: '#f59e0b',
              color: '#0f172a',
              fontWeight: 800,
              fontSize: '0.74rem',
              padding: '0.35rem 0.65rem',
              borderRadius: '8px',
              whiteSpace: 'nowrap'
            }}>
              Revisar ➔
            </div>
          </div>
        )}

        {/* Grilla de Fichas (2x2 + Ficha Pagos Efectivo) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.75rem',
          width: '100%',
          maxWidth: '420px'
        }}>
          {/* Ficha 1: Artículos */}
          <div 
            onClick={() => handleNavigation('articulos')}
            className="home-tile-card"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: '14px',
              padding: '0.85rem 0.65rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.45rem',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 4px 15px rgba(0,0,0,0.25)'
            }}
          >
            <div style={{ background: 'rgba(99, 102, 241, 0.15)', border: '1px solid rgba(99, 102, 241, 0.3)', padding: '7px', borderRadius: '10px', color: '#818cf8', display: 'flex' }}>
              <BookOpen size={18} />
            </div>
            <div>
              <span style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--text-primary)', display: 'block', marginBottom: '1px' }}>
                Artículos
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                Catálogo y precios
              </span>
            </div>
          </div>

          {/* Ficha 2: Mi Pedido con Badge y Detección de Activos */}
          <div 
            onClick={() => handleNavigation('pedidos')}
            className="home-tile-card"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: totalAlerts > 0 ? '1.5px solid rgba(245, 158, 11, 0.5)' : '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: '14px',
              padding: '0.85rem 0.65rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.45rem',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(10px)',
              boxShadow: totalAlerts > 0 ? '0 4px 20px rgba(245, 158, 11, 0.25)' : '0 4px 15px rgba(0,0,0,0.25)',
              position: 'relative'
            }}
          >
            {totalAlerts > 0 && (
              <span style={{
                position: 'absolute',
                top: '-7px',
                right: '-7px',
                background: '#f59e0b',
                color: '#0f172a',
                fontSize: '0.68rem',
                fontWeight: 900,
                padding: '2px 7px',
                borderRadius: '999px',
                boxShadow: '0 0 10px rgba(245, 158, 11, 0.6)',
                animation: 'b2bPulseAlert 2s infinite'
              }}>
                {totalAlerts} activo{totalAlerts > 1 ? 's' : ''}
              </span>
            )}
            <div style={{ background: totalAlerts > 0 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.15)', border: totalAlerts > 0 ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(16, 185, 129, 0.3)', padding: '7px', borderRadius: '10px', color: totalAlerts > 0 ? '#fbbf24' : '#34d399', display: 'flex' }}>
              <ClipboardList size={18} />
            </div>
            <div>
              <span style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--text-primary)', display: 'block', marginBottom: '1px' }}>
                Mi Pedido
              </span>
              <span style={{ fontSize: '0.7rem', color: totalAlerts > 0 ? '#fbbf24' : 'var(--text-secondary)', fontWeight: totalAlerts > 0 ? 700 : 400 }}>
                {totalAlerts > 0 ? `⚠️ ${totalAlerts} en trámite` : 'Borrador y pedidos'}
              </span>
            </div>
          </div>

          {/* Ficha 3: Cuenta Corriente */}
          <div 
            onClick={() => handleNavigation('cc')}
            className="home-tile-card"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: '14px',
              padding: '0.85rem 0.65rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.45rem',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 4px 15px rgba(0,0,0,0.25)'
            }}
          >
            <div style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', padding: '7px', borderRadius: '10px', color: '#fbbf24', display: 'flex' }}>
              <Receipt size={18} />
            </div>
            <div>
              <span style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--text-primary)', display: 'block', marginBottom: '1px' }}>
                Cuenta Corriente
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                Saldos y facturas
              </span>
            </div>
          </div>

          {/* Ficha 4: Devoluciones */}
          <div 
            onClick={() => handleNavigation('retiros')}
            className="home-tile-card"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: '14px',
              padding: '0.85rem 0.65rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.45rem',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 4px 15px rgba(0,0,0,0.25)'
            }}
          >
            <div style={{ background: 'rgba(236, 72, 153, 0.15)', border: '1px solid rgba(236, 72, 153, 0.3)', padding: '7px', borderRadius: '10px', color: '#f472b6', display: 'flex' }}>
              <Truck size={18} />
            </div>
            <div>
              <span style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--text-primary)', display: 'block', marginBottom: '1px' }}>
                Devoluciones
              </span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                Cambios y reclamos
              </span>
            </div>
          </div>

          {/* Ficha 5: Pagos en Efectivo (Span 2 Compacta) */}
          <div 
            onClick={() => handleNavigation('pagos_efectivo')}
            className="home-tile-card"
            style={{
              gridColumn: 'span 2',
              background: 'linear-gradient(135deg, rgba(142, 71, 133, 0.12), rgba(255, 255, 255, 0.03))',
              border: '1px solid rgba(142, 71, 133, 0.35)',
              borderRadius: '14px',
              padding: '0.75rem 1rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 4px 15px rgba(142, 71, 133, 0.15)'
            }}
          >
            <div style={{ background: 'rgba(142, 71, 133, 0.25)', border: '1px solid rgba(142, 71, 133, 0.5)', padding: '7px', borderRadius: '10px', color: '#e879f9', display: 'flex' }}>
              <Banknote size={20} />
            </div>
            <div style={{ textAlign: 'left' }}>
              <span style={{ fontWeight: '700', fontSize: '0.92rem', color: 'var(--text-primary)', display: 'block' }}>
                Aviso de Ensobrado
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                (Efectivo) • Conteo y sellado
              </span>
            </div>
          </div>

          {/* Ficha 6 Exclusiva: Servicios de Colaborador (Matias) */}
          {(profile?.permisos?.includes('servicios_colaborador') || profile?.cliente_id === 'CB-0006') && (
            <div 
              onClick={() => handleNavigation('servicios_colaborador')}
              className="home-tile-card"
              style={{
                gridColumn: 'span 2',
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(16, 185, 129, 0.08))',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                borderRadius: '14px',
                padding: '0.85rem 1rem',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                transition: 'all 0.2s ease',
                backdropFilter: 'blur(10px)',
                boxShadow: '0 4px 20px rgba(245, 158, 11, 0.2)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ background: 'rgba(245, 158, 11, 0.25)', border: '1px solid rgba(245, 158, 11, 0.5)', padding: '8px', borderRadius: '10px', color: '#fbbf24', display: 'flex' }}>
                  <Wrench size={20} />
                </div>
                <div style={{ textAlign: 'left' }}>
                  <span style={{ fontWeight: '700', fontSize: '0.92rem', color: '#fbbf24', display: 'block' }}>
                    Mis Servicios y Tarifario
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    Jornadas de trabajo, tarifas activas y carros terminados
                  </span>
                </div>
              </div>
              <div style={{
                background: 'rgba(245, 158, 11, 0.2)',
                color: '#fbbf24',
                fontWeight: 800,
                fontSize: '0.74rem',
                padding: '0.35rem 0.65rem',
                borderRadius: '8px',
                whiteSpace: 'nowrap'
              }}>
                Ver ➔
              </div>
            </div>
          )}
        </div>

        {/* Sección de Segundo Orden: Información y Condiciones Comerciales (Ofertas, Pagos, Asistencia) */}
        <div style={{
          width: '100%',
          maxWidth: '420px',
          marginTop: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.55rem'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 0.35rem',
            marginBottom: '0.1rem'
          }}>
            <span style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.6px'
            }}>
              {((infoComercial?.promos && infoComercial.promos.length > 0) || !!infoComercial?.politica_comercial)
                ? 'Condiciones Comerciales y Beneficios'
                : 'Condiciones y Canales de Pago'}
            </span>
            {infoComercial?.promos?.length > 0 && (
              <span style={{
                fontSize: '0.65rem',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                padding: '1px 6px',
                borderRadius: '999px',
                fontWeight: 700
              }}>
                🔥 {infoComercial.promos.length} Oferta{infoComercial.promos.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Ficha 1: Ofertas y Promociones (Solo si tiene promociones o bonificación por volumen activa) */}
          {((infoComercial?.promos && infoComercial.promos.length > 0) || !!infoComercial?.politica_comercial) && (
            <div 
              onClick={() => handleOpenInfoModal('promos')}
              className="home-tile-card"
              style={{
                background: 'rgba(255, 255, 255, 0.025)',
                border: infoComercial?.promos?.length > 0 ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '0.65rem 0.85rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.2s ease',
                backdropFilter: 'blur(8px)',
                boxShadow: infoComercial?.promos?.length > 0 ? '0 2px 10px rgba(245, 158, 11, 0.1)' : 'none'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.35)', padding: '6px', borderRadius: '8px', color: '#fbbf24', display: 'flex' }}>
                  <Flame size={16} />
                </div>
                <div style={{ textAlign: 'left' }}>
                  <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)', display: 'block' }}>
                    Ofertas y Promociones Activas
                  </span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                    {infoComercial?.politica_comercial && infoComercial?.promos?.length > 0
                      ? 'Oportunidades de compra y bonificación por volumen'
                      : infoComercial?.politica_comercial
                        ? 'Bonificación comercial por volumen en compras'
                        : 'Oportunidades y ofertas especiales en artículos'}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                {infoComercial?.promos?.length > 0 ? (
                  <span style={{ background: '#f59e0b', color: '#0f172a', fontWeight: 900, fontSize: '0.66rem', padding: '2px 6px', borderRadius: '6px' }}>
                    {infoComercial.promos.length === 1 ? '1 OFERTA' : `${infoComercial.promos.length} OFERTAS`}
                  </span>
                ) : infoComercial?.politica_comercial ? (
                  <span style={{ background: 'linear-gradient(135deg, #8b5cf6, #ec4899)', color: '#fff', fontWeight: 900, fontSize: '0.66rem', padding: '2px 6px', borderRadius: '6px' }}>
                    {infoComercial.politica_comercial.tramos?.[0]?.descuento_porcentaje ? `${parseFloat(infoComercial.politica_comercial.tramos[0].descuento_porcentaje)}% OFF` : 'BONIF.'}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Ver ➔</span>
                )}
              </div>
            </div>
          )}

          {/* Ficha 2: Formas de Pago Habilitadas */}
          <div 
            onClick={() => handleOpenInfoModal('pagos')}
            className="home-tile-card"
            style={{
              background: 'rgba(255, 255, 255, 0.025)',
              border: '1px solid rgba(59, 130, 246, 0.25)',
              borderRadius: '12px',
              padding: '0.65rem 0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(8px)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.35)', padding: '6px', borderRadius: '8px', color: '#60a5fa', display: 'flex' }}>
                <CreditCard size={16} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)', display: 'block' }}>
                  Formas de Pago Habilitadas
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  Transferencia Galicia, Ensobrado y Cajeros 24hs
                </span>
              </div>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Ver ➔</span>
          </div>

          {/* Ficha 3: Servicio de Asistencia Financiera */}
          <div 
            onClick={() => handleOpenInfoModal('intereses')}
            className="home-tile-card"
            style={{
              background: 'rgba(255, 255, 255, 0.025)',
              border: '1px solid rgba(168, 85, 247, 0.25)',
              borderRadius: '12px',
              padding: '0.65rem 0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.2s ease',
              backdropFilter: 'blur(8px)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ background: 'rgba(168, 85, 247, 0.15)', border: '1px solid rgba(168, 85, 247, 0.35)', padding: '6px', borderRadius: '8px', color: '#c084fc', display: 'flex' }}>
                <ShieldCheck size={16} />
              </div>
              <div style={{ textAlign: 'left' }}>
                <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)', display: 'block' }}>
                  Servicio de Asistencia Financiera
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  Esquema constructivo de 4 ventanas
                </span>
              </div>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Ver ➔</span>
          </div>
        </div>

        {/* Indicador Sutil / Botón de Acceso Directo */}
        <div style={{ marginTop: '1.35rem', width: '100%', display: 'flex', justifyContent: 'center' }}>
          {isStandaloneApp ? (
            <button
              onClick={() => setShowPwaModal(true)}
              style={{
                background: 'rgba(34, 197, 94, 0.08)',
                border: '1px solid rgba(34, 197, 94, 0.28)',
                borderRadius: '999px',
                padding: '0.45rem 1.15rem',
                color: '#4ade80',
                fontSize: '0.78rem',
                fontWeight: '600',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                cursor: 'pointer',
                transition: 'all 0.25s ease',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(34, 197, 94, 0.16)';
                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.5)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(34, 197, 94, 0.08)';
                e.currentTarget.style.borderColor = 'rgba(34, 197, 94, 0.28)';
              }}
              title="Estás operando desde la aplicación instalada"
            >
              <CheckCircle2 size={15} style={{ color: '#22c55e' }} />
              <span>Aplicación en uso</span>
            </button>
          ) : (
            <button
              onClick={() => {
                setHasPrompt(!!window.deferredPrompt);
                setShowPwaModal(true);
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '999px',
                padding: '0.45rem 1.15rem',
                color: 'var(--text-secondary)',
                fontSize: '0.78rem',
                fontWeight: '600',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                cursor: 'pointer',
                transition: 'all 0.25s ease',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(142, 71, 133, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(142, 71, 133, 0.4)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
              title="Instalar acceso directo en tu dispositivo"
            >
              <Smartphone size={15} style={{ color: 'var(--accent)' }} />
              <span>Instalar acceso directo en tu dispositivo</span>
            </button>
          )}
        </div>

        {/* Acceso a Vinculación Rápida de Dispositivos */}
        {onOpenVincularModal && (
          <div style={{ marginTop: '0.65rem', width: '100%', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={onOpenVincularModal}
              style={{
                background: 'rgba(142, 71, 133, 0.08)',
                border: '1px solid rgba(142, 71, 133, 0.28)',
                borderRadius: '999px',
                padding: '0.42rem 1.15rem',
                color: 'var(--text-secondary)',
                fontSize: '0.78rem',
                fontWeight: '600',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                cursor: 'pointer',
                transition: 'all 0.25s ease',
                backdropFilter: 'blur(8px)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'rgba(142, 71, 133, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(142, 71, 133, 0.55)';
                e.currentTarget.style.color = 'var(--text-primary)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'rgba(142, 71, 133, 0.08)';
                e.currentTarget.style.borderColor = 'rgba(142, 71, 133, 0.28)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
              title="Vincular PC o celular mediante QR / WhatsApp"
            >
              <Smartphone size={14} style={{ color: 'var(--accent)' }} />
              <span>Vincular otro dispositivo (PC / Celular)</span>
            </button>
          </div>
        )}

      </div>

      {/* Estilos hover locales */}
      <style>{`
        .home-tile-card:hover {
          transform: translateY(-2px);
          border-color: var(--accent) !important;
          background: rgba(255, 255, 255, 0.07) !important;
          box-shadow: 0 6px 20px rgba(142, 71, 133, 0.25) !important;
        }
        .home-tile-card:active {
          transform: translateY(0);
        }
      `}</style>

      {/* Modal Oficial de Instalación / Estado de Acceso Directo (PWA) */}
      {showPwaModal && (
        <div style={{ 
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(3, 7, 18, 0.82)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1.25rem',
          animation: 'modalFadeIn 0.3s ease-out'
        }}>
          
          <div style={{
            background: 'linear-gradient(145deg, #111827 0%, #0b0f19 100%)',
            border: `1px solid ${isStandaloneApp ? 'rgba(34, 197, 94, 0.35)' : 'rgba(142, 71, 133, 0.35)'}`,
            borderRadius: '20px',
            width: '100%',
            maxWidth: '420px',
            padding: '1.85rem 1.6rem',
            position: 'relative',
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center'
          }}>
            
            {/* Botón Cerrar */}
            <button 
              onClick={handleDismiss}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'var(--transition-smooth)',
                padding: '0.25rem',
                borderRadius: '6px'
              }}
              onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
              aria-label="Cerrar modal"
            >
              <X size={20} />
            </button>

            {/* CASO A: ESTÁ EN MODO STANDALONE (Corriendo como App instalada) */}
            {isStandaloneApp ? (
              <>
                <div style={{ position: 'relative', marginBottom: '1rem' }}>
                  <div style={{ 
                    background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.2) 0%, rgba(34, 197, 94, 0.05) 100%)', 
                    border: '1.5px solid rgba(34, 197, 94, 0.4)',
                    borderRadius: '22px', 
                    padding: '0.85rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    boxShadow: '0 0 30px rgba(34, 197, 94, 0.25)'
                  }}>
                    <img 
                      src="/icon-192.png" 
                      alt="Logo LAMDA" 
                      style={{ width: '48px', height: '48px', borderRadius: '12px', objectFit: 'contain' }}
                    />
                  </div>
                  <div style={{
                    position: 'absolute',
                    bottom: '-4px',
                    right: '-4px',
                    background: '#22c55e',
                    borderRadius: '50%',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                    border: '2px solid #111827'
                  }}>
                    <CheckCircle2 size={16} color="#ffffff" />
                  </div>
                </div>

                <h3 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.35rem', letterSpacing: '-0.01em' }}>
                  Aplicación en Uso
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: '1.45', marginBottom: '1.5rem', padding: '0 0.5rem' }}>
                  Estás operando desde el acceso directo instalado de <strong>LAMDA</strong> a pantalla completa con máxima rapidez y fluidez.
                </p>

                <div style={{ width: '100%' }}>
                  <button
                    onClick={() => setShowPwaModal(false)}
                    className="btn-primary"
                    style={{ 
                      width: '100%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      gap: '0.5rem',
                      padding: '0.85rem',
                      fontSize: '0.92rem',
                      fontWeight: '700',
                      borderRadius: '12px'
                    }}
                  >
                    <span>Continuar operando</span>
                  </button>
                </div>
              </>
            ) : (
              /* CASO B: EN NAVEGADOR (Puede instalar, reinstalar o ver guía) */
              <>
                <div style={{ 
                  background: 'linear-gradient(135deg, rgba(142, 71, 133, 0.2) 0%, rgba(142, 71, 133, 0.05) 100%)', 
                  border: '1.5px solid rgba(142, 71, 133, 0.4)',
                  borderRadius: '22px', 
                  padding: '0.85rem', 
                  marginBottom: '1rem',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  boxShadow: '0 0 30px rgba(142, 71, 133, 0.3)'
                }}>
                  <img 
                    src="/icon-192.png" 
                    alt="Logo LAMDA" 
                    style={{ width: '48px', height: '48px', borderRadius: '12px', objectFit: 'contain' }}
                  />
                </div>

                <h3 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.35rem', letterSpacing: '-0.01em' }}>
                  Instalá el Acceso Directo
                </h3>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: '1.45', marginBottom: '1.5rem', padding: '0 0.5rem' }}>
                  Agregá el portal con el logo de <strong>LAMDA</strong> en la pantalla de inicio o escritorio de tu dispositivo para ingresar en 1 toque.
                </p>

                {/* Contenido Dinámico según Dispositivo */}
                {hasPrompt ? (
                  /* Navegadores con soporte de prompt nativo directo */
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <button
                      onClick={handleInstallClick}
                      className="btn-primary"
                      style={{ 
                        width: '100%', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        gap: '0.5rem',
                        padding: '0.85rem',
                        fontSize: '0.92rem',
                        fontWeight: '700',
                        borderRadius: '12px'
                      }}
                    >
                      <Download size={19} />
                      <span>Instalar en este Dispositivo</span>
                    </button>
                  </div>
                ) : isDesktop ? (
                  /* Computadora de Escritorio / Notebook (Chrome / Edge) */
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    <button
                      onClick={handleDesktopShortcutDownload}
                      className="btn-primary"
                      style={{ 
                        width: '100%', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        gap: '0.5rem',
                        padding: '0.85rem',
                        fontSize: '0.92rem',
                        fontWeight: '700',
                        borderRadius: '12px'
                      }}
                    >
                      <RotateCcw size={18} />
                      <span>Reinstalar Acceso Directo en PC</span>
                    </button>

                    {shortcutDownloaded && (
                      <div style={{
                        background: 'rgba(34, 197, 94, 0.12)',
                        border: '1px solid rgba(34, 197, 94, 0.35)',
                        borderRadius: '12px',
                        padding: '0.75rem 0.9rem',
                        fontSize: '0.8rem',
                        color: '#4ade80',
                        lineHeight: '1.4',
                        textAlign: 'left'
                      }}>
                        ✅ <strong>¡Acceso directo generado con éxito!</strong><br />
                        <span style={{ fontSize: '0.74rem', color: '#cbd5e1' }}>
                          Revisá la carpeta de Descargas de tu PC y arrastralo al Escritorio para entrar siempre en 1 clic.
                        </span>
                      </div>
                    )}

                    <button
                      onClick={() => setShowChromeTips(!showChromeTips)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '0.76rem',
                        cursor: 'pointer',
                        padding: '0.2rem',
                        textDecoration: 'underline'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                      onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                    >
                      {showChromeTips ? 'Ocultar opciones avanzadas' : '¿Preferís fijarlo desde el menú de Chrome?'}
                    </button>

                    {showChromeTips && (
                      <div style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '12px',
                        padding: '0.75rem 1rem',
                        textAlign: 'left',
                        fontSize: '0.76rem',
                        color: 'var(--text-secondary)',
                        lineHeight: '1.4'
                      }}>
                        Hacé clic en el icono <strong>Instalar ⊕</strong> en la barra de direcciones de Chrome, o en los <strong>3 puntos (⋮)</strong> ➔ Guardar y compartir ➔ Crear acceso directo.
                      </div>
                    )}
                  </div>
                ) : isIos ? (
                  /* iPhone / iPad (iOS Safari) */
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '14px',
                    padding: '1rem 1.15rem',
                    width: '100%',
                    textAlign: 'left'
                  }}>
                    <p style={{ fontSize: '0.84rem', color: 'var(--text-primary)', fontWeight: '700', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      Pasos en iPhone / iPad (Safari):
                    </p>
                    <ol style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '1.15rem', margin: 0, display: 'flex', flexDirection: 'column', gap: '0.45rem', lineHeight: '1.4' }}>
                      <li>Tocá el botón de <strong>Compartir</strong> <Share size={14} style={{ display: 'inline', verticalAlign: 'middle', margin: '0 2px', color: 'var(--accent)' }} /> al pie de la pantalla en Safari.</li>
                      <li>Deslizá hacia abajo y seleccioná <strong>"Agregar a inicio"</strong> (o <em>"Add to Home Screen"</em>).</li>
                      <li>Tocá <strong>"Agregar"</strong> arriba a la derecha y ¡listo!</li>
                    </ol>
                  </div>
                ) : (
                  /* Otros navegadores móviles */
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '14px',
                    padding: '1rem 1.15rem',
                    width: '100%',
                    textAlign: 'left'
                  }}>
                    <p style={{ fontSize: '0.84rem', color: 'var(--text-primary)', fontWeight: '700', marginBottom: '0.4rem' }}>
                      Cómo instalar el icono:
                    </p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.45', margin: 0 }}>
                      Tocá el menú de <strong>3 puntos</strong> de tu navegador (en la esquina superior o inferior) y seleccioná <strong>"Instalar aplicación"</strong> o <strong>"Agregar a la pantalla principal"</strong>.
                    </p>
                  </div>
                )}

                {/* Enlace para continuar sin instalar */}
                <button
                  onClick={handleDismiss}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    fontSize: '0.8rem',
                    marginTop: '1.25rem',
                    cursor: 'pointer',
                    transition: 'var(--transition-smooth)',
                    textDecoration: 'underline'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                  onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  Continuar en el navegador
                </button>
              </>
            )}

          </div>

        </div>
      )}

      {/* Modal Integral de Información Comercial (Promos, Pagos, Asistencia Financiera) */}
      <InfoComercialModal
        isOpen={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        data={infoComercial}
        initialTab={infoModalTab}
        profile={profile}
        onNavigateToTab={setCurrentTab}
      />

      {/* Animación del Modal */}
      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; transform: scale(0.94); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
