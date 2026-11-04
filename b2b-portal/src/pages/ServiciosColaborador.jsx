import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Clock, 
  Calendar, 
  DollarSign, 
  Wrench, 
  Package, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight, 
  Play, 
  RefreshCw, 
  Search, 
  Edit3, 
  TrendingUp, 
  Layers, 
  Info, 
  ShieldCheck, 
  ExternalLink, 
  ChevronRight, 
  Activity,
  History,
  Check
} from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../supabaseClient';

const API_BASE_URL = import.meta.env.DEV 
  ? (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005') 
  : '';

export default function ServiciosColaborador({ profile, setCurrentTab }) {
  const [activeSubTab, setActiveSubTab] = useState('jornadas'); // 'jornadas' | 'tarifario' | 'produccion'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dashboardData, setDashboardData] = useState(null);
  const [error, setError] = useState(null);

  // Filtro de búsqueda en tarifas de rendimiento
  const [searchRend, setSearchRend] = useState('');
  
  // Cronómetro en vivo para jornada en curso
  const [liveElapsed, setLiveElapsed] = useState({ hs: 0, min: 0, sec: 0, totalHours: 0 });

  // Función para formatear moneda ARS
  const formatMoney = (val) => {
    const num = parseFloat(val) || 0;
    return `$ ${num.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Función para formatear fechas
  const formatDate = (isoStr) => {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return isoStr;
    }
  };

  const formatDateTime = (isoStr) => {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('es-AR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch {
      return isoStr;
    }
  };

  // Cargar Dashboard (HTTP con fallback a Cloud Dispatcher)
  const cargarDashboard = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    const clienteId = profile?.cliente_id || 'CB-0006';

    try {
      let dataFinal = null;

      // 1. Intento por HTTP directo (LAN / Local)
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE_URL}/api/b2b/colaborador/dashboard?clienteId=${encodeURIComponent(clienteId)}`, {
          headers,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const resJson = await res.json();
          if (resJson.success && resJson.data) {
            dataFinal = resJson.data;
          }
        }
      } catch (httpErr) {
        console.warn('⚠️ [ServiciosColaborador] HTTP directo no respondió, recurriendo a Cloud Dispatcher:', httpErr.message);
      }

      // 2. Fallback a Cloud Dispatcher en Supabase (telemetria_accesos)
      if (!dataFinal) {
        const reqId = Math.random().toString(36).substring(2, 9);
        const reqType = `COLAB-REQ-${reqId}-${clienteId}`;

        const { error: insErr } = await supabase.from('telemetria_accesos').insert([{
          cliente_nombre: profile?.nombre_empresa || profile?.nombre_completo || 'Colaborador B2B',
          dispositivo: 'Dashboard Servicios',
          latencia_ms: 1,
          tipo_acceso: reqType
        }]);

        if (insErr) throw new Error('No se pudo enviar la solicitud al servidor Cloud: ' + insErr.message);

        // Sondeo cada 1.2 segundos (máximo 15s)
        const doneType = `COLAB-RES-${reqId}-DONE`;
        const errType = `COLAB-RES-${reqId}-ERROR`;
        const startTime = Date.now();

        while (Date.now() - startTime < 15000) {
          await new Promise(r => setTimeout(r, 1200));
          const { data: rows } = await supabase
            .from('telemetria_accesos')
            .select('*')
            .in('tipo_acceso', [doneType, errType])
            .order('id', { ascending: false })
            .limit(1);

          if (rows && rows.length > 0) {
            const row = rows[0];
            if (row.tipo_acceso === errType) {
              throw new Error(row.dispositivo || 'El servidor reportó un error al consultar datos.');
            }
            try {
              dataFinal = JSON.parse(row.dispositivo);
              break;
            } catch (pErr) {
              console.error('Error parseando JSON de respuesta:', pErr);
            }
          }
        }
      }

      if (!dataFinal) {
        throw new Error('Tiempo de espera agotado al consultar la información del colaborador.');
      }

      setDashboardData(dataFinal);
    } catch (err) {
      console.error('❌ [ServiciosColaborador] Error cargando datos:', err);
      setError(err.message || 'No se pudo cargar la información de servicios.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    cargarDashboard();
  }, [profile?.cliente_id]);

  // Actualizador de cronómetro en vivo para jornada en curso
  useEffect(() => {
    const enCurso = dashboardData?.jornadas?.en_curso;
    if (!enCurso || !enCurso.fecha_ingreso) return;

    const timer = setInterval(() => {
      const start = new Date(enCurso.fecha_ingreso).getTime();
      const now = Date.now();
      const diffSec = Math.max(0, Math.floor((now - start) / 1000));

      const hs = Math.floor(diffSec / 3600);
      const min = Math.floor((diffSec % 3600) / 60);
      const sec = diffSec % 60;
      const totalHours = diffSec / 3600;

      setLiveElapsed({ hs, min, sec, totalHours });
    }, 1000);

    return () => clearInterval(timer);
  }, [dashboardData?.jornadas?.en_curso]);

  // Handler para actualizar Tarifa Horaria
  const handleEditarTarifaHora = async () => {
    const tarifaActual = dashboardData?.tarifas?.hora_activa?.valor_hora || 7000;
    
    const { value: nuevoValorStr } = await Swal.fire({
      title: 'Actualizar Tarifa Horaria',
      html: `
        <div style="text-align: left; font-size: 0.9rem; color: #cbd5e1; margin-bottom: 1rem;">
          <p style="margin-bottom: 0.5rem;">Definí el nuevo valor de la tarifa por hora de trabajo:</p>
          <div style="background: rgba(255,255,255,0.05); padding: 0.6rem; border-radius: 8px; margin-bottom: 0.5rem;">
            <strong>Tarifa actual activa:</strong> ${formatMoney(tarifaActual)} / hora
          </div>
        </div>
      `,
      input: 'number',
      inputValue: tarifaActual,
      inputAttributes: {
        min: 1,
        step: 100,
        placeholder: 'Ej: 8000'
      },
      showCancelButton: true,
      confirmButtonText: 'Guardar Tarifa',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#f59e0b',
      background: '#1e293b',
      color: '#f8fafc',
      customClass: {
        popup: 'b2b-swal-modal'
      },
      inputValidator: (value) => {
        if (!value || isNaN(value) || parseFloat(value) <= 0) {
          return 'Ingresá un monto válido mayor a 0';
        }
      }
    });

    if (!nuevoValorStr) return;
    const nuevoValor = parseFloat(nuevoValorStr);

    const resultConfirm = await Swal.fire({
      title: '¿Confirmar actualización?',
      html: `La tarifa por hora pasará a ser de <strong>${formatMoney(nuevoValor)}</strong> de forma inmediata.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, confirmar',
      cancelButtonText: 'Revisar',
      confirmButtonColor: '#f59e0b',
      background: '#1e293b',
      color: '#f8fafc'
    });

    if (!resultConfirm.isConfirmed) return;

    Swal.fire({
      title: 'Actualizando tarifa...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
      background: '#1e293b',
      color: '#f8fafc'
    });

    try {
      const clienteId = profile?.cliente_id || 'CB-0006';
      let exito = false;

      // 1. Intento por HTTP directo
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE_URL}/api/b2b/colaborador/actualizar-tarifa-hora`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ clienteId, valor_hora: nuevoValor })
        });
        if (res.ok) {
          const resJson = await res.json();
          if (resJson.success) exito = true;
        }
      } catch (httpErr) {
        console.warn('⚠️ [TarifaHora] HTTP falló, usando Cloud Dispatcher:', httpErr.message);
      }

      // 2. Fallback a Cloud Dispatcher
      if (!exito) {
        const reqId = Math.random().toString(36).substring(2, 9);
        const reqType = `COLAB-UPDATE-${reqId}-${clienteId}`;

        await supabase.from('telemetria_accesos').insert([{
          cliente_nombre: profile?.nombre_empresa || 'Colaborador B2B',
          dispositivo: JSON.stringify({ tipo: 'HORA', valor: nuevoValor }),
          latencia_ms: 1,
          tipo_acceso: reqType
        }]);

        // Sondeo
        const doneType = `COLAB-UPDATE-${reqId}-DONE`;
        const errType = `COLAB-UPDATE-${reqId}-ERROR`;
        const startTime = Date.now();

        while (Date.now() - startTime < 15000) {
          await new Promise(r => setTimeout(r, 1200));
          const { data: rows } = await supabase
            .from('telemetria_accesos')
            .select('*')
            .in('tipo_acceso', [doneType, errType])
            .order('id', { ascending: false })
            .limit(1);

          if (rows && rows.length > 0) {
            if (rows[0].tipo_acceso === errType) {
              throw new Error(rows[0].dispositivo || 'Error al actualizar tarifa');
            }
            exito = true;
            break;
          }
        }
      }

      if (!exito) throw new Error('Tiempo de espera agotado al sincronizar la nueva tarifa.');

      await Swal.fire({
        icon: 'success',
        title: '¡Tarifa Actualizada!',
        text: `La nueva tarifa de ${formatMoney(nuevoValor)}/hora fue guardada correctamente.`,
        confirmButtonColor: '#10b981',
        background: '#1e293b',
        color: '#f8fafc'
      });

      await cargarDashboard(true);

    } catch (err) {
      console.error('Error al actualizar tarifa horaria:', err);
      Swal.fire({
        icon: 'error',
        title: 'Error al actualizar',
        text: err.message || 'No se pudo guardar la tarifa.',
        confirmButtonColor: '#ef4444',
        background: '#1e293b',
        color: '#f8fafc'
      });
    }
  };

  // Handler para actualizar Tarifa de Rendimiento
  const handleEditarTarifaRendimiento = async (item) => {
    const { value: nuevoValorStr } = await Swal.fire({
      title: 'Editar Tarifa de Rendimiento',
      html: `
        <div style="text-align: left; font-size: 0.9rem; color: #cbd5e1; margin-bottom: 1rem;">
          <p style="font-weight: 700; color: #f59e0b; margin-bottom: 0.25rem;">
            [${item.articulo_numero}] ${item.articulo_descripcion}
          </p>
          <div style="background: rgba(255,255,255,0.05); padding: 0.6rem; border-radius: 8px; margin-top: 0.5rem;">
            <strong>Tarifa actual:</strong> ${formatMoney(item.valor_por_unidad)} por ${item.unidad_medida || 'unidad'}
          </div>
        </div>
      `,
      input: 'number',
      inputValue: item.valor_por_unidad,
      inputAttributes: {
        min: 1,
        step: 50,
        placeholder: 'Ej: 3800'
      },
      showCancelButton: true,
      confirmButtonText: 'Guardar Tarifa',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#f59e0b',
      background: '#1e293b',
      color: '#f8fafc',
      inputValidator: (value) => {
        if (!value || isNaN(value) || parseFloat(value) <= 0) {
          return 'Ingresá un monto válido mayor a 0';
        }
      }
    });

    if (!nuevoValorStr) return;
    const nuevoValor = parseFloat(nuevoValorStr);

    Swal.fire({
      title: 'Actualizando tarifa...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading(),
      background: '#1e293b',
      color: '#f8fafc'
    });

    try {
      const clienteId = profile?.cliente_id || 'CB-0006';
      let exito = false;

      // 1. Intento por HTTP directo
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${API_BASE_URL}/api/b2b/colaborador/actualizar-tarifa-rendimiento`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ 
            clienteId, 
            articulo_numero: item.articulo_numero,
            valor_por_unidad: nuevoValor,
            unidad_medida: item.unidad_medida || 'kg'
          })
        });
        if (res.ok) {
          const resJson = await res.json();
          if (resJson.success) exito = true;
        }
      } catch (httpErr) {
        console.warn('⚠️ [TarifaRend] HTTP falló, usando Cloud Dispatcher:', httpErr.message);
      }

      // 2. Fallback a Cloud Dispatcher
      if (!exito) {
        const reqId = Math.random().toString(36).substring(2, 9);
        const reqType = `COLAB-UPDATE-${reqId}-${clienteId}`;

        await supabase.from('telemetria_accesos').insert([{
          cliente_nombre: profile?.nombre_empresa || 'Colaborador B2B',
          dispositivo: JSON.stringify({ 
            tipo: 'RENDIMIENTO', 
            articulo_numero: item.articulo_numero,
            valor: nuevoValor,
            unidad_medida: item.unidad_medida || 'kg'
          }),
          latencia_ms: 1,
          tipo_acceso: reqType
        }]);

        // Sondeo
        const doneType = `COLAB-UPDATE-${reqId}-DONE`;
        const errType = `COLAB-UPDATE-${reqId}-ERROR`;
        const startTime = Date.now();

        while (Date.now() - startTime < 15000) {
          await new Promise(r => setTimeout(r, 1200));
          const { data: rows } = await supabase
            .from('telemetria_accesos')
            .select('*')
            .in('tipo_acceso', [doneType, errType])
            .order('id', { ascending: false })
            .limit(1);

          if (rows && rows.length > 0) {
            if (rows[0].tipo_acceso === errType) {
              throw new Error(rows[0].dispositivo || 'Error al actualizar tarifa');
            }
            exito = true;
            break;
          }
        }
      }

      if (!exito) throw new Error('Tiempo de espera agotado al sincronizar la tarifa.');

      await Swal.fire({
        icon: 'success',
        title: '¡Tarifa Actualizada!',
        text: `Tarifa para ${item.articulo_descripcion} fijada en ${formatMoney(nuevoValor)} / ${item.unidad_medida}.`,
        confirmButtonColor: '#10b981',
        background: '#1e293b',
        color: '#f8fafc'
      });

      await cargarDashboard(true);

    } catch (err) {
      console.error('Error al actualizar tarifa de rendimiento:', err);
      Swal.fire({
        icon: 'error',
        title: 'Error al actualizar',
        text: err.message || 'No se pudo guardar la tarifa.',
        confirmButtonColor: '#ef4444',
        background: '#1e293b',
        color: '#f8fafc'
      });
    }
  };

  // Filtrado de tarifas de rendimiento
  const tarifasRendFiltradas = useMemo(() => {
    const list = dashboardData?.tarifas?.rendimiento || [];
    if (!searchRend.trim()) return list;
    const term = searchRend.toLowerCase();
    return list.filter(t => 
      (t.articulo_numero && t.articulo_numero.toLowerCase().includes(term)) ||
      (t.articulo_descripcion && t.articulo_descripcion.toLowerCase().includes(term))
    );
  }, [dashboardData?.tarifas?.rendimiento, searchRend]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem' }}>
        <RefreshCw className="spinner" size={36} style={{ color: '#f59e0b' }} />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>Cargando panel exclusivo de colaborador...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem 1rem', maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '16px', padding: '2rem' }}>
          <AlertTriangle size={48} style={{ color: '#ef4444', margin: '0 auto 1rem' }} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.5rem', color: '#f87171' }}>Error al Cargar Servicios</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>{error}</p>
          <button 
            onClick={() => cargarDashboard()} 
            style={{
              background: '#f59e0b',
              color: '#0f172a',
              fontWeight: '700',
              padding: '0.6rem 1.25rem',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Reintentar Conexión
          </button>
        </div>
      </div>
    );
  }

  const { colaborador, tarifas, jornadas, producciones_externas } = dashboardData || {};
  const enCurso = jornadas?.en_curso;
  const pendientes = jornadas?.pendientes || [];
  const liquidadas = jornadas?.liquidadas || [];
  const resumen = jornadas?.resumen || {};
  const tarifaHoraActiva = tarifas?.hora_activa;

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '3rem' }}>
      
      {/* Header Principal con Identificación y Refresco */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        flexWrap: 'wrap', 
        gap: '1rem',
        marginBottom: '1.5rem',
        paddingBottom: '1rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div style={{ 
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(217, 119, 6, 0.15))', 
              border: '1px solid rgba(245, 158, 11, 0.4)', 
              borderRadius: '10px', 
              padding: '8px', 
              color: '#fbbf24',
              display: 'flex' 
            }}>
              <Wrench size={22} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0 }}>
                Mis Servicios y Tarifario
              </h1>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                Panel exclusivo de prestador y colaborador • <strong style={{ color: '#fbbf24' }}>{colaborador?.razon_social || 'Matías'}</strong>
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => cargarDashboard(true)}
            disabled={refreshing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px',
              padding: '0.5rem 0.85rem',
              color: 'var(--text-primary)',
              fontSize: '0.82rem',
              fontWeight: '600',
              cursor: refreshing ? 'not-allowed' : 'pointer'
            }}
          >
            <RefreshCw size={14} className={refreshing ? 'spinner' : ''} style={{ color: '#fbbf24' }} />
            <span>{refreshing ? 'Actualizando...' : 'Actualizar Datos'}</span>
          </button>
        </div>
      </div>

      {/* Widget de Jornada En Curso (Si está trabajando en vivo en el depósito) */}
      {enCurso && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.08))',
          border: '1.5px solid rgba(16, 185, 129, 0.4)',
          borderRadius: '16px',
          padding: '1.25rem 1.5rem',
          marginBottom: '1.5rem',
          boxShadow: '0 8px 30px rgba(16, 185, 129, 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{
              width: '46px',
              height: '46px',
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.25)',
              border: '2px solid #34d399',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#34d399',
              boxShadow: '0 0 15px rgba(52, 211, 153, 0.5)',
              animation: 'b2bPulseAlert 2s infinite'
            }}>
              <Activity size={24} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ 
                  background: '#10b981', 
                  color: '#022c22', 
                  fontSize: '0.7rem', 
                  fontWeight: '900', 
                  padding: '2px 8px', 
                  borderRadius: '999px',
                  textTransform: 'uppercase'
                }}>
                  En Vivo
                </span>
                <span style={{ fontSize: '0.85rem', color: '#a7f3d0' }}>Jornada de Trabajo en Depósito</span>
              </div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#ffffff', marginTop: '0.2rem' }}>
                Ingreso: {formatDateTime(enCurso.fecha_ingreso)}
              </h3>
              {enCurso.observacion_ingreso && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Nota: {enCurso.observacion_ingreso}
                </p>
              )}
            </div>
          </div>

          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '1.5rem',
            background: 'rgba(0,0,0,0.25)',
            padding: '0.75rem 1.25rem',
            borderRadius: '12px',
            border: '1px solid rgba(16, 185, 129, 0.3)'
          }}>
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: '#a7f3d0', textTransform: 'uppercase', display: 'block' }}>
                Tiempo Transcurrido
              </span>
              <span style={{ fontSize: '1.35rem', fontWeight: '800', color: '#ffffff', fontFamily: 'monospace' }}>
                {String(liveElapsed.hs).padStart(2, '0')}:{String(liveElapsed.min).padStart(2, '0')}:{String(liveElapsed.sec).padStart(2, '0')}
              </span>
            </div>
            <div style={{ width: '1px', height: '36px', background: 'rgba(255,255,255,0.1)' }} />
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.7rem', color: '#a7f3d0', textTransform: 'uppercase', display: 'block' }}>
                Acumulado Estimado
              </span>
              <span style={{ fontSize: '1.35rem', fontWeight: '800', color: '#34d399' }}>
                {formatMoney(liveElapsed.totalHours * (parseFloat(enCurso.valor_hora_aplicado) || tarifaHoraActiva?.valor_hora || 7000))}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tarjetas KPI de Resumen */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        {/* KPI 1: Pendiente de Liquidación */}
        <div style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '14px',
          padding: '1.25rem',
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#fbbf24', textTransform: 'uppercase' }}>
              Monto a Liquidar
            </span>
            <div style={{ background: 'rgba(245, 158, 11, 0.2)', padding: '6px', borderRadius: '8px', color: '#fbbf24' }}>
              <DollarSign size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#ffffff' }}>
            {formatMoney(resumen.total_monto_pendiente)}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            {resumen.total_horas_pendientes} horas en {resumen.cantidad_pendientes} jornada{resumen.cantidad_pendientes === 1 ? '' : 's'} pendientes
          </div>
        </div>

        {/* KPI 2: Tarifa Horaria Activa */}
        <div style={{
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '14px',
          padding: '1.25rem',
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#60a5fa', textTransform: 'uppercase' }}>
              Tarifa Activa
            </span>
            <div style={{ background: 'rgba(59, 130, 246, 0.2)', padding: '6px', borderRadius: '8px', color: '#60a5fa' }}>
              <Clock size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#ffffff' }}>
            {formatMoney(tarifaHoraActiva?.valor_hora || 7000)} <span style={{ fontSize: '0.85rem', fontWeight: '500', color: '#93c5fd' }}>/ hr</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.35rem' }}>
            <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
              Vigente desde: {formatDate(tarifaHoraActiva?.fecha_desde || tarifaHoraActiva?.creado_en)}
            </span>
            <button
              onClick={handleEditarTarifaHora}
              style={{
                background: 'rgba(59, 130, 246, 0.2)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                borderRadius: '6px',
                color: '#93c5fd',
                fontSize: '0.72rem',
                fontWeight: '700',
                padding: '2px 8px',
                cursor: 'pointer'
              }}
            >
              Cambiar
            </button>
          </div>
        </div>

        {/* KPI 3: Liquidado en el Mes */}
        <div style={{
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '14px',
          padding: '1.25rem',
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#34d399', textTransform: 'uppercase' }}>
              Liquidado este Mes
            </span>
            <div style={{ background: 'rgba(16, 185, 129, 0.2)', padding: '6px', borderRadius: '8px', color: '#34d399' }}>
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#ffffff' }}>
            {formatMoney(resumen.total_monto_mes)}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            {resumen.total_horas_mes} horas ya acreditadas en Cta. Corriente
          </div>
        </div>

        {/* KPI 4: Tarifas de Rendimiento */}
        <div style={{
          background: 'rgba(142, 71, 133, 0.1)',
          border: '1px solid rgba(142, 71, 133, 0.3)',
          borderRadius: '14px',
          padding: '1.25rem',
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: '600', color: '#e879f9', textTransform: 'uppercase' }}>
              Tarifas x Elaboración
            </span>
            <div style={{ background: 'rgba(142, 71, 133, 0.25)', padding: '6px', borderRadius: '8px', color: '#e879f9' }}>
              <Layers size={16} />
            </div>
          </div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: '#ffffff' }}>
            {tarifas?.rendimiento?.length || 0} <span style={{ fontSize: '0.85rem', fontWeight: '500', color: '#f0abfc' }}>artículos</span>
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            Barritas, granas y fraccionados activos
          </div>
        </div>
      </div>

      {/* Navegación por Sub-Pestañas */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        marginBottom: '1.5rem',
        overflowX: 'auto',
        paddingBottom: '2px'
      }}>
        <button
          onClick={() => setActiveSubTab('jornadas')}
          style={{
            background: activeSubTab === 'jornadas' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'jornadas' ? '2px solid #f59e0b' : '2px solid transparent',
            color: activeSubTab === 'jornadas' ? '#fbbf24' : 'var(--text-secondary)',
            fontWeight: '700',
            fontSize: '0.9rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            whiteSpace: 'nowrap',
            transition: 'all 0.2s ease'
          }}
        >
          <Clock size={16} />
          <span>Jornadas y Horarios</span>
          {pendientes.length > 0 && (
            <span style={{
              background: '#f59e0b',
              color: '#0f172a',
              fontSize: '0.68rem',
              fontWeight: '900',
              padding: '1px 6px',
              borderRadius: '999px'
            }}>
              {pendientes.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('tarifario')}
          style={{
            background: activeSubTab === 'tarifario' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'tarifario' ? '2px solid #f59e0b' : '2px solid transparent',
            color: activeSubTab === 'tarifario' ? '#fbbf24' : 'var(--text-secondary)',
            fontWeight: '700',
            fontSize: '0.9rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            whiteSpace: 'nowrap',
            transition: 'all 0.2s ease'
          }}
        >
          <DollarSign size={16} />
          <span>Tarifario Activo</span>
        </button>

        <button
          onClick={() => setActiveSubTab('produccion')}
          style={{
            background: activeSubTab === 'produccion' ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'produccion' ? '2px solid #f59e0b' : '2px solid transparent',
            color: activeSubTab === 'produccion' ? '#fbbf24' : 'var(--text-secondary)',
            fontWeight: '700',
            fontSize: '0.9rem',
            padding: '0.75rem 1.25rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            whiteSpace: 'nowrap',
            transition: 'all 0.2s ease'
          }}
        >
          <Package size={16} />
          <span>Producción Externa (Carros)</span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* SUB-PESTAÑA 1: JORNADAS Y HORARIOS                             */}
      {/* ============================================================== */}
      {activeSubTab === 'jornadas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* SECCIÓN A: JORNADAS PENDIENTES DE LIQUIDACIÓN */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>⏳ Jornadas Pendientes de Liquidación</span>
                  <span style={{ fontSize: '0.75rem', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', padding: '2px 8px', borderRadius: '999px' }}>
                    {pendientes.length} pendientes
                  </span>
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Jornadas finalizadas en depósito pendientes de impacto en cuenta corriente.
                </p>
              </div>

              {pendientes.length > 0 && (
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>Total por cobrar</span>
                  <span style={{ fontSize: '1.15rem', fontWeight: '800', color: '#fbbf24' }}>
                    {formatMoney(resumen.total_monto_pendiente)}
                  </span>
                </div>
              )}
            </div>

            {pendientes.length === 0 ? (
              <div style={{ 
                background: 'rgba(255,255,255,0.02)', 
                border: '1px dashed rgba(255,255,255,0.1)', 
                borderRadius: '12px', 
                padding: '2rem', 
                textAlign: 'center',
                color: 'var(--text-secondary)'
              }}>
                <CheckCircle2 size={32} style={{ color: '#10b981', margin: '0 auto 0.5rem' }} />
                <p style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)' }}>¡Al día!</p>
                <p style={{ fontSize: '0.8rem' }}>No tenés jornadas pendientes de liquidación en este momento.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {pendientes.map((j) => (
                  <div
                    key={j.id}
                    style={{
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '12px',
                      padding: '1rem 1.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.75rem',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{
                        background: 'rgba(245, 158, 11, 0.15)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: '10px',
                        padding: '10px',
                        color: '#fbbf24'
                      }}>
                        <Clock size={20} />
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: '700', fontSize: '0.95rem', color: '#ffffff' }}>
                            {formatDate(j.fecha_ingreso)}
                          </span>
                          <span style={{ 
                            background: 'rgba(245, 158, 11, 0.15)', 
                            color: '#fbbf24', 
                            fontSize: '0.7rem', 
                            fontWeight: '700', 
                            padding: '1px 6px', 
                            borderRadius: '4px' 
                          }}>
                            Pendiente
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                          Ingreso: {formatDateTime(j.fecha_ingreso).split(' ')[1] || '-'} • Egreso: {formatDateTime(j.fecha_egreso).split(' ')[1] || '-'}
                        </div>
                        {(j.observacion_ingreso || j.observacion_egreso) && (
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem', fontStyle: 'italic' }}>
                            {j.observacion_ingreso && `Ingreso: ${j.observacion_ingreso} `}
                            {j.observacion_egreso && `• Egreso: ${j.observacion_egreso}`}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', textAlign: 'right' }}>
                      <div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block' }}>Horas</span>
                        <span style={{ fontSize: '1.05rem', fontWeight: '700', color: '#ffffff' }}>
                          {j.horas_totales} hs
                        </span>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block' }}>
                          @ {formatMoney(j.valor_hora_aplicado)}/h
                        </span>
                      </div>
                      <div style={{ minWidth: '100px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block' }}>Subtotal</span>
                        <span style={{ fontSize: '1.2rem', fontWeight: '800', color: '#fbbf24' }}>
                          {formatMoney(j.monto_total)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SECCIÓN B: HISTORIAL DE JORNADAS LIQUIDADAS */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>📜 Historial de Jornadas Liquidadas</span>
                  <span style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)', padding: '2px 8px', borderRadius: '999px' }}>
                    {liquidadas.length} registros
                  </span>
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  Jornadas ya liquidadas e imputadas a tu Cuenta Corriente como Crédito de Horas.
                </p>
              </div>

              <button
                onClick={() => setCurrentTab('cc')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  padding: '0.4rem 0.75rem',
                  color: 'var(--text-secondary)',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                <span>Ver Cta. Corriente</span>
                <ExternalLink size={13} />
              </button>
            </div>

            {liquidadas.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No hay jornadas liquidadas registradas.</p>
            ) : (
              <div style={{
                background: 'rgba(15, 23, 42, 0.45)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '12px',
                overflow: 'hidden'
              }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Fecha</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Horario</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Horas</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Tarifa/h</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Monto Acreditado</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Liquidada</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Cta. Corriente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liquidadas.map((j) => (
                        <tr key={j.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#ffffff' }}>
                            {formatDate(j.fecha_ingreso)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>
                            {formatDateTime(j.fecha_ingreso).split(' ')[1] || '-'} a {formatDateTime(j.fecha_egreso).split(' ')[1] || '-'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: '700', color: '#ffffff' }}>
                            {j.horas_totales} hs
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {formatMoney(j.valor_hora_aplicado)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: '700', color: '#34d399' }}>
                            {formatMoney(j.monto_total)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            {formatDate(j.liquidada_en || j.fecha_egreso)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                            <button
                              onClick={() => setCurrentTab('cc')}
                              style={{
                                background: 'rgba(16, 185, 129, 0.1)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                borderRadius: '6px',
                                color: '#34d399',
                                fontSize: '0.72rem',
                                fontWeight: '700',
                                padding: '3px 8px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem'
                              }}
                            >
                              <span>Ver en CC</span>
                              <ChevronRight size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* SUB-PESTAÑA 2: TARIFARIO ACTIVO                                */}
      {/* ============================================================== */}
      {activeSubTab === 'tarifario' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* SECCIÓN 1: TARIFA HORARIA */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.8))',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px',
            padding: '1.5rem',
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <Clock size={18} style={{ color: '#60a5fa' }} />
                  <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#ffffff', margin: 0 }}>
                    Tarifa Horaria de Trabajo General
                  </h3>
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                  Aplica para jornadas en depósito, taller y mantenimiento general.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', display: 'block', textTransform: 'uppercase' }}>
                    Tarifa Vigente
                  </span>
                  <span style={{ fontSize: '1.75rem', fontWeight: '900', color: '#60a5fa' }}>
                    {formatMoney(tarifaHoraActiva?.valor_hora || 7000)}
                    <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#93c5fd' }}> / hora</span>
                  </span>
                </div>

                <button
                  onClick={handleEditarTarifaHora}
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.65rem 1.15rem',
                    color: '#0f172a',
                    fontWeight: '800',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 15px rgba(245, 158, 11, 0.3)'
                  }}
                >
                  <Edit3 size={15} />
                  <span>Actualizar Tarifa</span>
                </button>
              </div>
            </div>

            {/* Histórico Desplegable de Tarifas Horarias */}
            {tarifas?.historico_horas && tarifas.historico_horas.length > 1 && (
              <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.5rem' }}>
                  <History size={13} /> Historial de Variación de Tarifa Horaria:
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {tarifas.historico_horas.map((th) => (
                    <div 
                      key={th.id}
                      style={{
                        background: th.activo ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255,255,255,0.03)',
                        border: th.activo ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255,255,255,0.06)',
                        borderRadius: '8px',
                        padding: '0.35rem 0.65rem',
                        fontSize: '0.75rem',
                        color: th.activo ? '#93c5fd' : 'var(--text-secondary)'
                      }}
                    >
                      <strong style={{ color: th.activo ? '#ffffff' : 'inherit' }}>{formatMoney(th.valor_hora)}/h</strong>
                      <span style={{ marginLeft: '0.35rem', fontSize: '0.7rem' }}>
                        ({formatDate(th.fecha_desde)} - {th.fecha_hasta ? formatDate(th.fecha_hasta) : 'Actual'})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* SECCIÓN 2: TARIFAS DE RENDIMIENTO POR ARTÍCULO / PRODUCCIÓN */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Layers size={18} style={{ color: '#e879f9' }} />
                  <span>Tarifario por Rendimiento y Fraccionamiento</span>
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0 0' }}>
                  Tarifas pactadas por elaboración de barritas, granas horneadas y fraccionamiento externo.
                </p>
              </div>

              {/* Buscador de artículos */}
              <div style={{ position: 'relative', width: '280px' }}>
                <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Buscar artículo o código..."
                  value={searchRend}
                  onChange={(e) => setSearchRend(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    padding: '0.5rem 0.75rem 0.5rem 2.2rem',
                    color: '#ffffff',
                    fontSize: '0.82rem',
                    outline: 'none'
                  }}
                />
              </div>
            </div>

            {tarifasRendFiltradas.length === 0 ? (
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '2rem', textAlign: 'center', borderRadius: '12px', color: 'var(--text-secondary)' }}>
                No se encontraron artículos que coincidan con la búsqueda.
              </div>
            ) : (
              <div style={{
                background: 'rgba(15, 23, 42, 0.45)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '14px',
                overflow: 'hidden'
              }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
                        <th style={{ padding: '0.75rem 1rem' }}>Código</th>
                        <th style={{ padding: '0.75rem 1rem' }}>Artículo Elaborado / Descripción</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Unidad</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Tarifa Asignada</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Estado</th>
                        <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tarifasRendFiltradas.map((item) => (
                        <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span style={{ 
                              background: 'rgba(142, 71, 133, 0.15)', 
                              color: '#e879f9', 
                              padding: '2px 6px', 
                              borderRadius: '4px',
                              fontFamily: 'monospace',
                              fontWeight: '700',
                              fontSize: '0.8rem'
                            }}>
                              {item.articulo_numero}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#ffffff' }}>
                            {item.articulo_descripcion}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                            {item.unidad_medida || 'kg'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: '800', color: '#fbbf24', fontSize: '0.95rem' }}>
                            {formatMoney(item.valor_por_unidad)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                            <span style={{ 
                              background: item.activo ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.05)', 
                              color: item.activo ? '#34d399' : 'var(--text-muted)', 
                              fontSize: '0.7rem', 
                              fontWeight: '700', 
                              padding: '2px 6px', 
                              borderRadius: '4px' 
                            }}>
                              {item.activo ? 'Activa' : 'Histórica'}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                            <button
                              onClick={() => handleEditarTarifaRendimiento(item)}
                              style={{
                                background: 'rgba(245, 158, 11, 0.15)',
                                border: '1px solid rgba(245, 158, 11, 0.35)',
                                borderRadius: '6px',
                                color: '#fbbf24',
                                fontSize: '0.75rem',
                                fontWeight: '700',
                                padding: '4px 10px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem'
                              }}
                            >
                              <Edit3 size={13} />
                              <span>Editar</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* SUB-PESTAÑA 3: PRODUCCIÓN EXTERNA (CARROS)                     */}
      {/* ============================================================== */}
      {activeSubTab === 'produccion' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Package size={18} style={{ color: '#38bdf8' }} />
                <span>Historial de Producción Externa (Carros)</span>
              </h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0 0' }}>
                Registro de kilos procesados, rendimiento y mermas en planta externa.
              </p>
            </div>
            
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Últimos {producciones_externas?.length || 0} carros registrados
            </span>
          </div>

          {!producciones_externas || producciones_externas.length === 0 ? (
            <div style={{ 
              background: 'rgba(255,255,255,0.02)', 
              border: '1px dashed rgba(255,255,255,0.1)', 
              borderRadius: '12px', 
              padding: '2.5rem', 
              textAlign: 'center',
              color: 'var(--text-secondary)'
            }}>
              <Package size={36} style={{ color: '#38bdf8', margin: '0 auto 0.5rem', opacity: 0.7 }} />
              <p style={{ fontSize: '0.9rem', fontWeight: '600', color: 'var(--text-primary)' }}>Sin producciones recientes</p>
              <p style={{ fontSize: '0.8rem' }}>No se registran carros de producción externa elaborados recientemente.</p>
            </div>
          ) : (
            <div style={{
              background: 'rgba(15, 23, 42, 0.45)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '14px',
              overflow: 'hidden'
            }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'var(--text-secondary)' }}>
                      <th style={{ padding: '0.75rem 1rem' }}>Carro #</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Fecha</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Insumo Base / Padre</th>
                      <th style={{ padding: '0.75rem 1rem' }}>Producto Obtenido</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Kg Entrada</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Kg Obtenidos</th>
                      <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Merma %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {producciones_externas.map((prod) => {
                      const mermaNum = parseFloat(prod.porcentaje_merma) || 0;
                      const mermaColor = mermaNum > 5 ? '#f59e0b' : '#34d399';

                      return (
                        <tr key={prod.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '0.75rem 1rem' }}>
                            <span style={{ 
                              background: 'rgba(56, 189, 248, 0.15)', 
                              color: '#38bdf8', 
                              padding: '2px 8px', 
                              borderRadius: '4px',
                              fontFamily: 'monospace',
                              fontWeight: '700'
                            }}>
                              #{prod.carro_id || prod.id}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>
                            {formatDate(prod.fecha_registro)}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', color: '#ffffff' }}>
                            {prod.articulo_padre_descripcion}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', fontWeight: '600', color: '#ffffff' }}>
                            {prod.articulo_fraccionado_descripcion}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {prod.kilos_entrada ? `${Number(prod.kilos_entrada).toFixed(2)} kg` : '-'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: '700', color: '#34d399' }}>
                            {prod.kilos_producidos || prod.kilos_salida ? `${Number(prod.kilos_producidos || prod.kilos_salida).toFixed(2)} kg` : '-'}
                          </td>
                          <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                            <span style={{ 
                              background: `${mermaColor}20`, 
                              color: mermaColor, 
                              padding: '2px 8px', 
                              borderRadius: '999px',
                              fontWeight: '700',
                              fontSize: '0.75rem'
                            }}>
                              {mermaNum > 0 ? `${mermaNum.toFixed(1)}%` : '0%'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
