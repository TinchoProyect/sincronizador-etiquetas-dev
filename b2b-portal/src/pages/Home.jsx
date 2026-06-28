import React, { useState, useEffect } from 'react';
import { BookOpen, ClipboardList, Receipt, Smartphone, X, Download, Share } from 'lucide-react';

export default function Home({ setCurrentTab, profile }) {
  const [showPwaModal, setShowPwaModal] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [hasPrompt, setHasPrompt] = useState(false);

  useEffect(() => {
    // 1. Detectar si ya está en modo PWA (standalone) para no molestar al usuario
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    
    // 2. Detectar si el usuario ya descartó el aviso
    const isDismissed = localStorage.getItem('pwa_install_dismissed') === 'true';

    if (!isStandalone && !isDismissed) {
      // Breve retraso para priorizar la carga visual inicial
      const timer = setTimeout(() => {
        // Detectar si es iOS
        const userAgent = window.navigator.userAgent.toLowerCase();
        const iosDevice = /iphone|ipad|ipod/.test(userAgent);
        setIsIos(iosDevice);

        // Verificar si tenemos el prompt guardado
        const promptAvailable = !!window.deferredPrompt;
        setHasPrompt(promptAvailable);

        // Mostrar modal si aplica
        setShowPwaModal(true);
      }, 1500);

      return () => clearTimeout(timer);
    }
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '80vh', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
      
      {/* Contenedor Principal Despejado */}
      <div style={{ 
        width: '100%', 
        maxWidth: '900px', 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        textAlign: 'center',
        padding: '2rem 1.5rem',
        animation: 'fadeIn 0.8s ease-out'
      }}>
        
        {/* Logotipo Destacado */}
        <div style={{ marginBottom: '2.5rem', transform: 'scale(1)', transition: 'transform 0.5s ease' }}>
          <img 
            src="/logo_LAMDA.png" 
            alt="LAMDA Logo" 
            style={{ 
              maxHeight: '85px', 
              maxWidth: '100%', 
              height: 'auto', 
              filter: 'drop-shadow(0 0 15px var(--accent-glow))' 
            }} 
          />
        </div>

        {/* Mensaje Informativo Mínimo */}
        <div style={{ marginBottom: '3.5rem' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.5rem', letterSpacing: '-0.02em' }}>
            Portal de Autogestión Comercial
          </h1>
          <p style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', maxWidth: '500px', margin: '0 auto', lineHeight: '1.6' }}>
            Seleccione la sección con la que desea operar a continuación.
          </p>
        </div>

        {/* Sistema de Navegación en Tarjetas Elegantes */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
          gap: '1.5rem', 
          width: '100%',
          marginTop: '1rem'
        }}>
          
          {/* Tarjeta Catálogo */}
          <div 
            onClick={() => setCurrentTab('catalogo')}
            className="home-nav-card"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-lg)',
              padding: '2rem 1.5rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              transition: 'var(--transition-smooth)',
              boxShadow: '0 4px 30px rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(8px)'
            }}
          >
            <div style={{ background: 'rgba(142, 71, 133, 0.1)', color: 'var(--accent)', borderRadius: '50%', padding: '1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BookOpen size={28} />
            </div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Catálogo de Artículos</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>Explorá productos, precios vigentes y stock consolidado en tiempo real.</p>
          </div>

          {/* Tarjeta Pedidos */}
          <div 
            onClick={() => setCurrentTab('pedidos')}
            className="home-nav-card"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-lg)',
              padding: '2rem 1.5rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              transition: 'var(--transition-smooth)',
              boxShadow: '0 4px 30px rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(8px)'
            }}
          >
            <div style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', borderRadius: '50%', padding: '1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ClipboardList size={28} />
            </div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Mis Pedidos</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>Realizá pedidos de mercadería y realizá el seguimiento de tus despachos.</p>
          </div>

          {/* Tarjeta Cuenta Corriente */}
          <div 
            onClick={() => setCurrentTab('cc')}
            className="home-nav-card"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-lg)',
              padding: '2rem 1.5rem',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              transition: 'var(--transition-smooth)',
              boxShadow: '0 4px 30px rgba(0, 0, 0, 0.4)',
              backdropFilter: 'blur(8px)'
            }}
          >
            <div style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'hsl(217, 91%, 60%)', borderRadius: '50%', padding: '1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Receipt size={28} />
            </div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Cuenta Corriente</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>Consultá tus saldos, descargá comprobantes oficiales en PDF y revisá movimientos.</p>
          </div>

        </div>

      </div>

      {/* CSS in JS para efectos hover de las tarjetas */}
      <style>{`
        .home-nav-card {
          position: relative;
          overflow: hidden;
        }
        .home-nav-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          border-radius: var(--radius-lg);
          background: linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.08) 100%);
          opacity: 0;
          transition: var(--transition-smooth);
          pointer-events: none;
        }
        .home-nav-card:hover {
          transform: translateY(-5px);
          border-color: var(--accent);
          box-shadow: 0 10px 40px rgba(142, 71, 133, 0.15) !important;
        }
        .home-nav-card:hover::before {
          opacity: 1;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(15px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Modal Inteligente para Acceso Directo (PWA) */}
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
            <h3 style={{ fontSize: '1.35rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
              Instalá la App de LAMDA
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '1.75rem' }}>
              Agregá el portal a la pantalla de inicio de tu celular para acceder de forma directa y operar de manera fluida en la calle.
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
                <span>Instalar Directamente</span>
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
                Hacé clic en el menú de <strong>3 puntos</strong> de tu navegador en la esquina superior/inferior y seleccioná la opción <strong>"Instalar aplicación"</strong> o <strong>"Agregar a la pantalla de inicio"</strong>.
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
              Continuar en el navegador
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
