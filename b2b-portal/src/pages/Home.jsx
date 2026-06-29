import React, { useState, useEffect, useRef } from 'react';
import { Smartphone, X, Download, Share, ChevronDown, Home as HomeIcon, BookOpen, ClipboardList, Receipt } from 'lucide-react';

export default function Home({ setCurrentTab, profile }) {
  const [showPwaModal, setShowPwaModal] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [hasPrompt, setHasPrompt] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    // 1. Detectar si ya está en modo PWA (standalone)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    
    // 2. Detectar si el usuario acaba de activar la cuenta (forzar modal en onboarding)
    const justActivated = sessionStorage.getItem('just_activated') === 'true';
    if (justActivated) {
      sessionStorage.removeItem('just_activated');
      localStorage.removeItem('pwa_install_dismissed');
    }

    // 3. Detectar si el usuario ya descartó el aviso
    const isDismissed = localStorage.getItem('pwa_install_dismissed') === 'true';

    if (!isStandalone && (justActivated || !isDismissed)) {
      const timer = setTimeout(() => {
        const userAgent = window.navigator.userAgent.toLowerCase();
        const iosDevice = /iphone|ipad|ipod/.test(userAgent);
        setIsIos(iosDevice);

        const promptAvailable = !!window.deferredPrompt;
        setHasPrompt(promptAvailable);

        setShowPwaModal(true);
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, []);

  // Cerrar menú al hacer clic afuera
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInstallClick = async () => {
    const promptEvent = window.deferredPrompt;
    if (promptEvent) {
      promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      console.log(`[PWA] Elección de instalación del usuario: ${outcome}`);
      window.deferredPrompt = null;
      setHasPrompt(false);
      setShowPwaModal(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa_install_dismissed', 'true');
    setShowPwaModal(false);
  };

  const handleNavigation = (tabId) => {
    setMenuOpen(false);
    setCurrentTab(tabId);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '80vh', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
      
      {/* Contenedor Principal Despejado */}
      <div style={{ 
        width: '100%', 
        maxWidth: '600px', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        textAlign: 'center',
        padding: '2rem 1.5rem',
        animation: 'fadeIn 0.8s ease-out'
      }}>
        
        {/* Encabezado: Logotipo completo en alta definición */}
        <div style={{ marginBottom: '2.5rem' }}>
          <img 
            src="/logo_LAMDA.png" 
            alt="LAMDA Logo" 
            style={{ 
              maxHeight: '75px', 
              maxWidth: '100%', 
              height: 'auto', 
              filter: 'drop-shadow(0 0 15px rgba(255,255,255,0.05))'
            }} 
          />
        </div>

        {/* Bajada de Texto Institucional Seca */}
        <div style={{ marginBottom: '3rem' }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.5rem', letterSpacing: '-0.01em' }}>
            Portal de autogestión comercial
          </h1>
          <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
            Seleccione la sección con la que desea operar.
          </p>
        </div>

        {/* Menú de Opciones Compacto Estilizado */}
        <div ref={menuRef} style={{ position: 'relative', width: '100%', maxWidth: '280px' }}>
          
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              width: '100%',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-md)',
              padding: '0.85rem 1.25rem',
              color: 'var(--text-primary)',
              fontSize: '0.95rem',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
              backdropFilter: 'blur(10px)',
              transition: 'var(--transition-smooth)'
            }}
            className="menu-select-btn"
          >
            <span>Operar Sistema</span>
            <ChevronDown size={18} style={{ transform: menuOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.3s ease' }} />
          </button>

          {menuOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 0.5rem)',
              left: 0,
              right: 0,
              background: 'var(--bg-sidebar)',
              border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-md)',
              padding: '0.5rem',
              zIndex: 100,
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(20px)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
              animation: 'menuDropdownIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
              
              <button 
                onClick={() => handleNavigation('home')}
                className="dropdown-item-pwa"
              >
                <HomeIcon size={16} />
                <span>Inicio</span>
              </button>

              <button 
                onClick={() => handleNavigation('catalogo')}
                className="dropdown-item-pwa"
              >
                <BookOpen size={16} />
                <span>Catálogo</span>
              </button>

              <button 
                onClick={() => handleNavigation('pedidos')}
                className="dropdown-item-pwa"
              >
                <ClipboardList size={16} />
                <span>Mi Pedido</span>
              </button>

              <button 
                onClick={() => handleNavigation('cc')}
                className="dropdown-item-pwa"
              >
                <Receipt size={16} />
                <span>Cuenta Corriente</span>
              </button>

            </div>
          )}

        </div>

      </div>

      {/* Estilos locales para el menú desplegable */}
      <style>{`
        .menu-select-btn:hover {
          border-color: var(--accent);
          box-shadow: 0 4px 25px rgba(142, 71, 133, 0.15);
        }
        .dropdown-item-pwa {
          width: 100%;
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.75rem 1rem;
          color: var(--text-secondary);
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          alignItems: center;
          gap: 0.75rem;
          textAlign: left;
          transition: var(--transition-smooth);
        }
        .dropdown-item-pwa:hover {
          background: rgba(142, 71, 133, 0.12);
          color: var(--text-primary);
          padding-left: 1.25rem;
        }
        @keyframes menuDropdownIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Modal de Bienvenida para Acceso Directo (PWA) */}
      {showPwaModal && (
        <div style={{ 
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(3, 7, 18, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '1.5rem',
          animation: 'modalFadeIn 0.3s ease'
        }}>
          
          <div style={{
            background: 'var(--bg-sidebar)',
            border: '1px solid var(--border-glass)',
            borderRadius: 'var(--radius-lg)',
            width: '100%',
            maxWidth: '430px',
            padding: '2rem 1.75rem',
            position: 'relative',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
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
                padding: '0.25rem'
              }}
              onMouseOver={(e) => e.target.style.color = 'var(--text-primary)'}
              onMouseOut={(e) => e.target.style.color = 'var(--text-muted)'}
            >
              <X size={20} />
            </button>

            {/* Icono de Celular */}
            <div style={{ 
              background: 'rgba(142, 71, 133, 0.1)', 
              color: 'var(--accent)', 
              borderRadius: '50%', 
              padding: '1rem', 
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 25px rgba(142, 71, 133, 0.25)'
            }}>
              <Smartphone size={32} />
            </div>

            {/* Título & Mensaje */}
            <h3 style={{ fontSize: '1.6rem', fontWeight: '800', color: 'var(--text-primary)', marginBottom: '0.85rem', lineHeight: '1.3', letterSpacing: '-0.02em' }}>
              ¿Querés agregar un acceso directo en tu celular?
            </h3>
            <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '1.85rem' }}>
              Esto agregará el acceso directo al portal de LAMDA en tu pantalla de inicio para operar de forma rápida y sin demoras.
            </p>

            {/* Contenido Dinámico según Dispositivo */}
            {hasPrompt ? (
              /* Android / Chrome Desktop */
              <button
                onClick={handleInstallClick}
                className="btn-primary"
                style={{ 
                  width: '100%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  gap: '0.5rem',
                  padding: '0.85rem'
                }}
              >
                <Download size={18} />
                <span>Agregar a Pantalla de Inicio</span>
              </button>
            ) : isIos ? (
              /* iOS Safari */
              <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px dashed var(--border-glass)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                width: '100%',
                textAlign: 'left'
              }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '600', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  Pasos para iPhone / iPad:
                </p>
                <ol style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <li>Presioná el botón de <strong>Compartir</strong> <Share size={14} style={{ display: 'inline', verticalAlign: 'middle', margin: '0 2px' }} /> al pie de la pantalla en Safari.</li>
                  <li>Desplazá el menú hacia abajo y seleccioná la opción <strong>Agregar a inicio</strong>.</li>
                  <li>Presioná <strong>Agregar</strong> arriba a la derecha.</li>
                </ol>
              </div>
            ) : (
              /* Navegadores Generales sin API Prompt activa */
              <div style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px dashed var(--border-glass)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                width: '100%',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                lineHeight: '1.4'
              }}>
                Hacé clic en el menú de <strong>3 puntos</strong> de tu navegador en la esquina superior/inferior y seleccioná la opción <strong>"Agregar a la pantalla de inicio"</strong>.
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
              onMouseOver={(e) => e.target.style.color = 'var(--text-secondary)'}
              onMouseOut={(e) => e.target.style.color = 'var(--text-muted)'}
            >
              Continuar sin agregar
            </button>

          </div>

        </div>
      )}

      {/* Animación del Modal */}
      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>

    </div>
  );
}
