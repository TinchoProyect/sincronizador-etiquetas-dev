import React from 'react';
import { BookOpen, Receipt, ClipboardList, LogOut, User, Layers, Home } from 'lucide-react';
import { supabase } from '../supabaseClient';

export default function Sidebar({ profile, currentTab, setCurrentTab }) {
  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const menuItems = [
    { id: 'home', label: 'Inicio', icon: Home },
    { id: 'catalogo', label: 'Catálogo', icon: BookOpen },
    { id: 'pedidos', label: 'Mis Pedidos', icon: ClipboardList },
    { id: 'cc', label: 'Cuenta Corriente', icon: Receipt }
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
            {profile.listas_precios && profile.listas_precios.length > 0 && (
              <div className="client-detail" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem', marginTop: '0.75rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <Layers size={14} /> Listas de Precios Activas:
                </span>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                  {profile.listas_precios.map(listId => (
                    <span 
                      key={listId} 
                      style={{ 
                        background: 'rgba(59, 130, 246, 0.15)', 
                        color: 'var(--accent)', 
                        padding: '0.1rem 0.4rem', 
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: '600'
                      }}
                    >
                      L-{listId}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <nav className="nav-menu">
          {menuItems.map(item => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`nav-item ${isActive ? 'active' : ''}`}
                style={{ background: 'none', width: '100%', border: '1px solid transparent', textAlign: 'left', font: 'inherit' }}
              >
                <Icon size={20} />
                <span>{item.label}</span>
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
        <button className="btn-logout" onClick={handleLogout}>
          <LogOut size={18} />
          <span>Cerrar Sesión</span>
        </button>
      </div>
    </aside>
  );
}
