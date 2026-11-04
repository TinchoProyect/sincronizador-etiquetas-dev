import React from 'react';
import { BookOpen, Receipt, ClipboardList, LogOut, User, Layers, Home, Truck, Banknote, Smartphone, Wrench } from 'lucide-react';
import { supabase } from '../supabaseClient';

export default function Sidebar({ profile, currentTab, setCurrentTab, totalAlerts = 0, onOpenVincularModal }) {
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const isColaborador = profile?.permisos?.includes('servicios_colaborador') || profile?.cliente_id === 'CB-0006';

  const menuItems = [
    { id: 'home', label: 'Inicio', icon: Home },
    { id: 'articulos', label: 'Artículos', icon: BookOpen },
    { id: 'pedidos', label: 'Mis Pedidos', icon: ClipboardList },
    { id: 'cc', label: 'Cuenta Corriente', icon: Receipt },
    { id: 'pagos_efectivo', label: 'Aviso de Ensobrado (Efectivo)', icon: Banknote },
    { id: 'retiros', label: 'Devoluciones', icon: Truck },
    ...(isColaborador ? [{ id: 'servicios_colaborador', label: 'Mis Servicios y Tarifas', icon: Wrench }] : [])
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '2rem' }}>
          <img src="/logo_LAMDA.png?v=4" alt="LAMDA Logo" style={{ maxHeight: '36px', maxWidth: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }} />
        </div>

        {profile && (
          <div className="sidebar-client-info">
            <h2 className="client-name">{profile.nombre_empresa || 'Empresa de Prueba'}</h2>
            <div className="client-detail">
              <span>CUIT:</span>
              <span>{profile.cuit || 'N/D'}</span>
            </div>
            <div className="client-detail">
              <span>Rol:</span>
              <span style={{ textTransform: 'capitalize' }}>{profile.rol || 'Cliente'}</span>
            </div>
          </div>
        )}

        <nav className="nav-menu">
          {menuItems.map(item => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            const hasAlerts = item.id === 'pedidos' && totalAlerts > 0;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`nav-item ${isActive ? 'active' : ''}`}
                style={{ background: 'none', width: '100%', border: '1px solid transparent', textAlign: 'left', font: 'inherit', display: 'flex', alignItems: 'center', gap: '0.75rem' }}
              >
                <Icon size={20} />
                <span>{item.label}</span>
                {hasAlerts && (
                  <span className="b2b-nav-badge">
                    {totalAlerts}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="sidebar-footer">
        {profile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', padding: '0 0.5rem' }}>
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '50%', padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <User size={16} className="text-secondary" />
            </div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <p style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-primary)' }}>
                {profile.nombre_completo || 'Usuario'}
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {profile.email}
              </p>
            </div>
          </div>
        )}
        {onOpenVincularModal && (
          <button 
            type="button"
            className="btn-vincular-dispositivo" 
            onClick={onOpenVincularModal}
            style={{
              width: '100%',
              background: 'rgba(142, 71, 133, 0.12)',
              border: '1px solid rgba(142, 71, 133, 0.3)',
              borderRadius: '10px',
              padding: '0.6rem 0.75rem',
              color: 'var(--text-primary)',
              fontSize: '0.82rem',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              cursor: 'pointer',
              marginBottom: '0.65rem',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(142, 71, 133, 0.25)';
              e.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(142, 71, 133, 0.12)';
              e.currentTarget.style.borderColor = 'rgba(142, 71, 133, 0.3)';
            }}
            title="Vincular celular o computadora mediante QR o WhatsApp"
          >
            <Smartphone size={16} style={{ color: 'var(--accent)' }} />
            <span>Vincular otro equipo</span>
          </button>
        )}
        <button className="btn-logout" onClick={handleLogout}>
          <LogOut size={18} />
          <span>Cerrar Sesión</span>
        </button>
      </div>
    </aside>
  );
}
