import React, { useState, useEffect } from 'react';
import { supabaseAnonimaPublica } from '../supabaseClient';
import { CheckCircle2, User, Phone, CheckSquare, Square, Package, Loader2, ArrowRight, ArrowLeft, Eye, EyeOff, AlertTriangle, Camera, Check, X, Truck } from 'lucide-react';
import Swal from 'sweetalert2';

export default function RecepcionPedido({ path, onNavigate }) {
  // Extraer token o UUID de la ruta con regex ultra-robusta (insensible a trailing slashes, params o wrappers)
  const rawPath = path || window.location.hash || window.location.pathname || '';
  const tokenSegment = (rawPath.split('/recepcion/')[1] || '').split('?')[0].split('#')[0].split('/')[0].trim();
  const uuidMatch = rawPath.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  const initialUuid = uuidMatch ? uuidMatch[0] : (tokenSegment || '');

  const [loading, setLoading] = useState(true);
  const [pedido, setPedido] = useState(null);
  const [items, setItems] = useState([]);
  const [checkedItems, setCheckedItems] = useState({});
  const [receptoresFrecuentes, setReceptoresFrecuentes] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modoCargarNuevo, setModoCargarNuevo] = useState(false);
  
  // Datos del firmante
  const [nombre, setNombre] = useState('');
  const [apellido, setApellido] = useState('');
  const [telefono, setTelefono] = useState('');

  const aplicarMascaraTelefono = (val) => {
    if (!val) return '';
    const clean = val.replace(/\D/g, '').slice(0, 10);
    if (clean.length === 0) return '';
    if (clean.length <= 2) return `(${clean}`;
    if (clean.length <= 6) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  };
  
  // Control de flujo (pantallas)
  const [step, setStep] = useState(1); // 1: Datos de Recepción, 2: Checklist
  const [showCodes, setShowCodes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // FASE 3: Estado del Semáforo y Reporte de Novedades
  const [modoAuditoria, setModoAuditoria] = useState(false);
  const [cantidadesReales, setCantidadesReales] = useState({});
  const [motivosDiscrepancia, setMotivosDiscrepancia] = useState({});
  const [comentariosItems, setComentariosItems] = useState({});
  const [fotoReclamo1, setFotoReclamo1] = useState(null);
  const [fotoReclamo2, setFotoReclamo2] = useState(null);
  const [comentariosGlobales, setComentariosGlobales] = useState('');

  useEffect(() => {
    if (initialUuid) {
      cargarPedidoCompleto();
    } else {
      setLoading(false);
    }
  }, [initialUuid]);

  const cargarPedidoCompleto = async () => {
    try {
      setLoading(true);

      let targetUuid = initialUuid;

      // Si targetUuid no es un UUID de 36 caracteres (ej. token corto msf... o ID local 8234633)
      const esUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i.test(targetUuid);
      if (!esUUID && targetUuid) {
        try {
          const resSearchSupa = await supabaseAnonimaPublica
            .from('clientes_b2b_pedidos_cabecera')
            .select('id')
            .ilike('observaciones', `%${targetUuid}%`);

          if (resSearchSupa.data && resSearchSupa.data.length > 0) {
            targetUuid = resSearchSupa.data[0].id;
          }
        } catch (resolveErr) {
          console.warn('⚠️ No se pudo resolver token alternativo en Supabase:', resolveErr.message);
        }
      }

      if (!targetUuid) {
        setPedido(null);
        setLoading(false);
        return;
      }
      
      // Ejecutar consultas críticas en paralelo para máxima velocidad
      const [resCabecera, resLineas] = await Promise.all([
        supabaseAnonimaPublica
          .from('clientes_b2b_pedidos_cabecera')
          .select('*')
          .eq('id', targetUuid),
        supabaseAnonimaPublica
          .from('clientes_b2b_pedidos_items')
          .select('*')
          .eq('pedido_id', targetUuid)
      ]);

      if (resCabecera.error) throw resCabecera.error;
      if (resLineas.error) throw resLineas.error;

      const cabecera = Array.isArray(resCabecera.data) ? resCabecera.data[0] : resCabecera.data;
      const lineas = resLineas.data || [];

      if (!cabecera) {
        setPedido(null);
        setLoading(false);
        return;
      }
      
      setPedido(cabecera);
      setItems(lineas);

      // Inicializar checklist de items
      const initialChecked = {};
      lineas.forEach(item => {
        initialChecked[item.id] = false;
      });
      setCheckedItems(initialChecked);

      // Cargar receptores frecuentes del cliente
      if (cabecera && cabecera.cliente_id) {
        const { data: historial, error: errHistorial } = await supabaseAnonimaPublica
          .from('clientes_b2b_pedidos_cabecera')
          .select('recibido_por_nombre, recibido_por_apellido, recibido_por_telefono, recibido_fecha')
          .eq('cliente_id', cabecera.cliente_id)
          .not('recibido_por_nombre', 'is', null)
          .neq('recibido_por_nombre', 'Chofer (QR)')
          .order('recibido_fecha', { ascending: false })
          .limit(50);

        if (!errHistorial && historial) {
          const unicos = [];
          const vistos = new Set();
          historial.forEach(h => {
            const nom = (h.recibido_por_nombre || '').trim();
            const ape = (h.recibido_por_apellido || '').trim();
            const key = `${nom.toLowerCase()}_${ape.toLowerCase()}`;
            if (nom && !vistos.has(key)) {
              vistos.add(key);
              unicos.push({
                nombre: nom,
                apellido: ape,
                telefono: (h.recibido_por_telefono || '').trim()
              });
            }
          });
          setReceptoresFrecuentes(unicos);
          if (unicos.length > 0) {
            setSelectedIndex(0);
            setNombre(unicos[0].nombre || '');
            setApellido(unicos[0].apellido || '');
            setTelefono(unicos[0].telefono || '');
          }
        }
      }

    } catch (err) {
      console.error('Error al cargar pedido:', err);
      Swal.fire({
        title: 'Error de Lectura',
        text: 'No se pudo cargar la información del remito o el código QR es inválido.',
        icon: 'error',
        confirmButtonColor: '#3b82f6'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleItem = (itemId) => {
    setCheckedItems(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  };

  const handleNextStep = (e) => {
    e.preventDefault();
    if (!nombre.trim()) {
      Swal.fire('Atención', 'El Nombre de quien recibe es obligatorio.', 'warning');
      return;
    }
    setStep(2); // Pasar al checklist
  };

  const procesarImagenB2B = (file, maxDimension = 1000) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function (event) {
        const img = new Image();
        img.onload = function () {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxDimension) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = reject;
        img.src = event.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoUpload = async (file, photoNumber) => {
    if (!file) return;
    try {
      Swal.fire({
        title: 'Procesando imagen...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });
      const base64Img = await procesarImagenB2B(file, 1000);
      if (photoNumber === 1) {
        setFotoReclamo1(base64Img);
      } else {
        setFotoReclamo2(base64Img);
      }
      Swal.close();
    } catch (err) {
      console.error('Error al procesar foto:', err);
      Swal.close();
      Swal.fire('Error', 'No se pudo procesar la foto seleccionada.', 'error');
    }
  };

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      const targetId = pedido?.id || initialUuid;
      const { error } = await supabaseAnonimaPublica
        .from('clientes_b2b_pedidos_cabecera')
        .update({
          estado: 'Entregado',
          recibido_por_nombre: nombre.trim(),
          recibido_por_apellido: apellido.trim() || null,
          recibido_por_telefono: telefono.trim() || null,
          recibido_fecha: new Date().toISOString()
        })
        .eq('id', targetId);

      if (error) throw error;

      // Registrar evento de auditoría/telemetría sobre HTTPS en Supabase
      try {
        await supabaseAnonimaPublica.from('telemetria_accesos').insert([{
          cliente_nombre: `Receptor QR: ${nombre.trim()} ${apellido.trim() || ''}`,
          dispositivo: navigator.userAgent.includes('Android') ? 'Android Mobile' : (navigator.userAgent.includes('iPhone') ? 'iOS iPhone' : 'Navegador Web Desktop'),
          latencia_ms: 2,
          tipo_acceso: `Recepción QR OK (${pedido?.cliente_nombre || 'Cliente B2B'})`
        }]);
      } catch (e) {}

      await Swal.fire({
        title: '¡Recepción Registrada!',
        text: `El pedido fue marcado como Recibido por ${nombre.trim()} exitosamente.`,
        icon: 'success',
        confirmButtonText: 'Aceptar',
        confirmButtonColor: '#10b981'
      });

      // Recargar datos para mostrar pantalla final de éxito
      await cargarPedidoCompleto();

    } catch (err) {
      console.error('Error al confirmar recepción:', err);
      Swal.fire('Error', 'No se pudo registrar la recepción del pedido.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAuditoriaSubmit = async () => {
    try {
      setIsSubmitting(true);
      
      const itemsConReclamo = items.filter(item => {
        const cantReal = cantidadesReales[item.id] !== undefined ? cantidadesReales[item.id] : item.cantidad;
        return parseFloat(cantReal) < parseFloat(item.cantidad);
      });
      
      if (itemsConReclamo.length === 0) {
        Swal.fire('Atención', 'No ha reportado ninguna novedad en las cantidades de los artículos.', 'warning');
        setIsSubmitting(false);
        return;
      }
      
      for (const item of itemsConReclamo) {
        const motivo = motivosDiscrepancia[item.id];
        if (!motivo) {
          Swal.fire('Atención', `Por favor seleccione el motivo de la novedad para: ${item.producto_descripcion}`, 'warning');
          setIsSubmitting(false);
          return;
        }
      }

      const motivosUnicos = [...new Set(itemsConReclamo.map(item => motivosDiscrepancia[item.id]))];
      const motivoCabecera = motivosUnicos.join(', ');

      const targetId = pedido?.id || initialUuid;

      // 1. Actualizar cabecera en Supabase
      const { error: errorCabecera } = await supabaseAnonimaPublica
        .from('clientes_b2b_pedidos_cabecera')
        .update({
          estado: 'Reclamado',
          recibido_por_nombre: nombre.trim(),
          recibido_por_apellido: apellido.trim() || null,
          recibido_por_telefono: telefono.trim() || null,
          recibido_fecha: new Date().toISOString(),
          motivo_reclamo_recepcion: motivoCabecera,
          foto_reclamo_1: fotoReclamo1,
          foto_reclamo_2: fotoReclamo2,
          comentarios_recepcion: comentariosGlobales.trim() || null,
          reclamado_fecha: new Date().toISOString(),
          sync_estado: 'Pendiente' // Hace que el daemon local actualice
        })
        .eq('id', targetId);

      if (errorCabecera) throw errorCabecera;

      // 2. Actualizar ítems en Supabase
      for (const item of items) {
        const cantReal = cantidadesReales[item.id] !== undefined ? cantidadesReales[item.id] : item.cantidad;
        const tieneReclamo = parseFloat(cantReal) < parseFloat(item.cantidad);
        
        const { error: errorItem } = await supabaseAnonimaPublica
          .from('clientes_b2b_pedidos_items')
          .update({
            cantidad_recibida: parseFloat(cantReal),
            motivo_incidencia: tieneReclamo ? motivosDiscrepancia[item.id] : null,
            comentarios: tieneReclamo ? (comentariosItems[item.id] || null) : null
          })
          .eq('id', item.id);
          
        if (errorItem) throw errorItem;
      }

      await Swal.fire({
        title: '⚠️ Reporte Enviado',
        text: 'El reporte de recepción y novedades físicas ha sido enviado con éxito.',
        icon: 'warning',
        confirmButtonText: 'Entendido',
        confirmButtonColor: '#ea580c'
      });

      await cargarPedidoCompleto();

    } catch (err) {
      console.error('Error al registrar reclamo:', err);
      Swal.fire('Error', 'No se pudo enviar el reporte de novedades físicas.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh', 
        background: 'radial-gradient(circle at top, #1e293b 0%, #0f172a 100%)', 
        color: 'white', 
        fontFamily: 'system-ui, sans-serif',
        padding: '20px',
        boxSizing: 'border-box'
      }}>
        {/* Logo animado con pulso y resplandor */}
        <div style={{ 
          marginBottom: '35px', 
          animation: 'pulseGlow 2s ease-in-out infinite',
          display: 'flex',
          justifyContent: 'center'
        }}>
          <img src="/logo_LAMDA.png?v=4" alt="LAMDA Logo" style={{ maxHeight: '42px' }} />
        </div>

        {/* Barra de progreso de carga premium */}
        <div style={{ 
          width: '180px', 
          height: '3px', 
          background: 'rgba(255, 255, 255, 0.05)', 
          borderRadius: '10px', 
          position: 'relative', 
          overflow: 'hidden',
          marginBottom: '20px'
        }}>
          <div style={{ 
            height: '100%', 
            background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', 
            position: 'absolute', 
            borderRadius: '10px',
            animation: 'progressLine 1.6s ease-in-out infinite' 
          }} />
        </div>

        {/* Textos informativos de carga */}
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '0.95em', fontWeight: '600', color: '#f8fafc', animation: 'fadeInOut 1.5s ease-in-out infinite' }}>
            Buscando su remito digital...
          </p>
          <p style={{ margin: 0, fontSize: '0.78em', color: '#64748b' }}>
            Estableciendo conexión segura con la aduana cloud
          </p>
        </div>

        {/* Inyectar estilos CSS de animaciones en caliente */}
        <style>{`
          @keyframes pulseGlow {
            0% { transform: scale(1); filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.15)); }
            50% { transform: scale(1.04); filter: drop-shadow(0 0 25px rgba(59, 130, 246, 0.5)); }
            100% { transform: scale(1); filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.15)); }
          }
          @keyframes progressLine {
            0% { left: -30%; width: 25%; }
            50% { width: 35%; }
            100% { left: 110%; width: 20%; }
          }
          @keyframes fadeInOut {
            0% { opacity: 0.5; }
            50% { opacity: 1; }
            100% { opacity: 0.5; }
          }
        `}</style>
      </div>
    );
  }

  if (!pedido) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'radial-gradient(circle at top, #1e293b 0%, #0f172a 100%)', color: 'white', fontFamily: 'system-ui, sans-serif', padding: '20px', textAlign: 'center' }}>
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '50%', padding: '20px', marginBottom: '20px' }}>
          <Package style={{ width: '50px', height: '50px', color: '#ef4444' }} />
        </div>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '10px' }}>Remito No Encontrado</h2>
        <p style={{ color: '#94a3b8', maxWidth: '400px', lineHeight: '1.5' }}>El enlace del QR escaneado no coincide con ningún pedido activo en el sistema B2B.</p>
      </div>
    );
  }

  const yaEntregado = (pedido.recibido_por_nombre && pedido.recibido_por_nombre !== 'Chofer (QR)') || pedido.estado === 'Reclamado';

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at top, #1e293b 0%, #0f172a 100%)', color: 'white', fontFamily: 'system-ui, sans-serif', padding: '20px 10px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto', background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(16px)', borderRadius: '16px', padding: '24px 20px', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', boxSizing: 'border-box' }}>
        
        {/* Header Marca */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <img src="/logo_LAMDA.png?v=4" alt="LAMDA Logo" style={{ maxHeight: '32px' }} />
        </div>

        {/* -----------------------------------------------------------------
            PANTALLA FINAL: YA ENTREGADO
            ----------------------------------------------------------------- */}
        {yaEntregado ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            {/* DOBLE TRACK / HITO DE VALIDACION */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              {/* 1. Datos de Despacho Logístico (Chofer) */}
              {(pedido.entregado_chofer_nombre || pedido.recibido_por_nombre === 'Chofer (QR)') && (
                <div style={{ 
                  background: 'rgba(59, 130, 246, 0.08)', 
                  border: '1px solid rgba(59, 130, 246, 0.25)', 
                  borderRadius: '10px', 
                  padding: '12px 15px',
                  textAlign: 'left',
                  fontSize: '0.85em'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#60a5fa', fontWeight: 'bold', marginBottom: '4px' }}>
                    <Truck style={{ width: '16px', height: '16px' }} />
                    <span>[🚚 Despacho Logístico]</span>
                  </div>
                  <p style={{ margin: '2px 0', color: '#93c5fd' }}>
                    Estado: <strong>Entregado por Chofer</strong>
                  </p>
                  <p style={{ margin: '2px 0', fontSize: '0.9em', color: '#cbd5e1' }}>
                    Fecha: {new Date(pedido.entregado_chofer_fecha || pedido.recibido_fecha).toLocaleString('es-AR')}
                  </p>
                </div>
              )}

              {/* 2. Datos de Recepción Comercial (Cliente) */}
              <div style={{ 
                background: pedido.estado === 'Reclamado' ? 'rgba(234, 88, 12, 0.08)' : 'rgba(16, 185, 129, 0.08)', 
                border: pedido.estado === 'Reclamado' ? '1px solid rgba(234, 88, 12, 0.25)' : '1px solid rgba(16, 185, 129, 0.25)', 
                borderRadius: '10px', 
                padding: '12px 15px',
                textAlign: 'left',
                fontSize: '0.85em'
              }}>
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px', 
                  color: pedido.estado === 'Reclamado' ? '#f97316' : '#34d399', 
                  fontWeight: 'bold', 
                  marginBottom: '4px' 
                }}>
                  {pedido.estado === 'Reclamado' ? (
                    <AlertTriangle style={{ width: '16px', height: '16px' }} />
                  ) : (
                    <CheckCircle2 style={{ width: '16px', height: '16px' }} />
                  )}
                  <span>{pedido.estado === 'Reclamado' ? '[🏢 Recepción con Reclamo]' : '[🏢 Recepción Conforme]'}</span>
                </div>
                <p style={{ margin: '2px 0', color: pedido.estado === 'Reclamado' ? '#fed7aa' : '#a7f3d0' }}>
                  Recibido por: <strong>{pedido.recibido_por_nombre || 'Cliente'} {pedido.recibido_por_apellido || ''}</strong>
                </p>
                {pedido.recibido_por_telefono && (
                  <p style={{ margin: '2px 0', color: '#cbd5e1' }}>
                    Contacto: {pedido.recibido_por_telefono}
                  </p>
                )}
                <p style={{ margin: '2px 0', color: '#cbd5e1' }}>
                  Fecha: {new Date(pedido.recibido_fecha || pedido.reclamado_fecha).toLocaleString('es-AR')}
                </p>
                {pedido.comentarios_recepcion && (
                  <p style={{ margin: '6px 0 0 0', padding: '6px', background: 'rgba(0,0,0,0.15)', borderRadius: '4px', fontStyle: 'italic', fontSize: '0.95em', color: '#e2e8f0' }}>
                    "{pedido.comentarios_recepcion}"
                  </p>
                )}
              </div>
            </div>
            
            <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '15px', textAlign: 'left', fontSize: '0.9em', border: '1px solid rgba(255,255,255,0.04)' }}>
              <h5 style={{ margin: '0 0 10px 0', color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.8em', letterSpacing: '0.05em' }}>
                {pedido.estado === 'Reclamado' ? 'Detalle de Auditoría' : 'Resumen del pedido'}
              </h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {items.map(item => {
                  const qtyPrepared = parseFloat(item.cantidad);
                  const qtyReceived = item.cantidad_recibida !== null ? parseFloat(item.cantidad_recibida) : qtyPrepared;
                  const hasDiscrepancy = qtyReceived < qtyPrepared;
                  
                  return (
                    <div key={item.id} style={{ display: 'flex', flexDirection: 'column', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <span style={{ color: hasDiscrepancy ? '#f97316' : '#cbd5e1', fontWeight: hasDiscrepancy ? '500' : 'normal' }}>
                          {item.producto_descripcion}
                        </span>
                        <span style={{ fontWeight: 'bold', fontFamily: 'monospace', color: hasDiscrepancy ? '#f97316' : 'white' }}>
                          {hasDiscrepancy ? `${qtyReceived} de ${qtyPrepared} u.` : `${qtyPrepared} u.`}
                        </span>
                      </div>
                      {hasDiscrepancy && (
                        <div style={{ fontSize: '0.78em', color: '#fdba74', marginTop: '2px', display: 'flex', justifyContent: 'space-between' }}>
                          <span>Motivo: {item.motivo_incidencia}</span>
                          {item.comentarios && <span style={{ fontStyle: 'italic', color: '#cbd5e1' }}>"{item.comentarios}"</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mostrar miniaturas de fotos si es un reclamo y hay fotos guardadas */}
            {pedido.estado === 'Reclamado' && (pedido.foto_reclamo_1 || pedido.foto_reclamo_2) && (
              <div style={{ marginTop: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '10px', padding: '15px', border: '1px solid rgba(255,255,255,0.04)', textAlign: 'left' }}>
                <h5 style={{ margin: '0 0 10px 0', color: '#94a3b8', textTransform: 'uppercase', fontSize: '0.8em', letterSpacing: '0.05em' }}>Evidencia Fotográfica</h5>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {pedido.foto_reclamo_1 && (
                    <img src={pedido.foto_reclamo_1} alt="Foto Reclamo 1" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)' }} />
                  )}
                  {pedido.foto_reclamo_2 && (
                    <img src={pedido.foto_reclamo_2} alt="Foto Reclamo 2" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)' }} />
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {step === 1 && (
              <form onSubmit={handleNextStep}>
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                  <h3 style={{ margin: '0 0 6px 0', fontSize: '1.15rem', color: '#3b82f6' }}>Recepción de Mercadería</h3>
                  <p style={{ margin: 0, fontSize: '0.85em', color: '#94a3b8' }}>
                    {receptoresFrecuentes.length > 0 && !modoCargarNuevo 
                      ? 'Seleccione quién recibe de la lista de personas del cliente.'
                      : 'Ingrese los datos de la persona que recibe el pedido.'
                    }
                  </p>
                </div>

                {/* OPCIÓN A: Lista de Personas Registradas del Cliente */}
                {receptoresFrecuentes.length > 0 && !modoCargarNuevo ? (
                  <div style={{ marginBottom: '20px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '12px', padding: '16px' }}>
                    <label style={{ display: 'block', fontSize: '0.86em', color: '#60a5fa', fontWeight: 'bold', marginBottom: '8px' }}>
                      👤 Seleccionar persona registrada de este cliente:
                    </label>
                    <select
                      value={selectedIndex}
                      onChange={(e) => {
                        const idx = parseInt(e.target.value, 10);
                        if (isNaN(idx)) return;
                        setSelectedIndex(idx);
                        const rec = receptoresFrecuentes[idx];
                        if (rec) {
                          setNombre(rec.nombre || '');
                          setApellido(rec.apellido || '');
                          setTelefono(rec.telefono || '');
                        }
                      }}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '12px',
                        borderRadius: '8px',
                        background: '#0f172a',
                        color: 'white',
                        border: '1px solid rgba(59, 130, 246, 0.4)',
                        fontSize: '0.95em',
                        outline: 'none',
                        cursor: 'pointer',
                        marginBottom: '14px'
                      }}
                    >
                      {receptoresFrecuentes.map((rec, i) => (
                        <option key={i} value={i}>
                          {rec.nombre} {rec.apellido} {rec.telefono ? `— Cel: ${rec.telefono}` : ''}
                        </option>
                      ))}
                    </select>

                    {/* Ficha Resumen del Receptor Seleccionado */}
                    <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)', fontSize: '0.88em', marginBottom: '14px' }}>
                      <div style={{ color: '#e2e8f0', fontWeight: '600' }}>Receptor: {nombre} {apellido}</div>
                      {telefono && <div style={{ color: '#94a3b8', fontSize: '0.85em', marginTop: '2px' }}>📱 Celular: {telefono}</div>}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setModoCargarNuevo(true);
                        setNombre('');
                        setApellido('');
                        setTelefono('');
                      }}
                      style={{
                        width: '100%',
                        padding: '10px',
                        borderRadius: '8px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: '#94a3b8',
                        border: '1px dashed rgba(255,255,255,0.2)',
                        fontSize: '0.85em',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      ➕ ¿Persona no encontrada? Cargar persona nueva
                    </button>
                  </div>
                ) : (
                  /* OPCIÓN B: Formulario para Cargar Nueva Persona */
                  <>
                    {receptoresFrecuentes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setModoCargarNuevo(false);
                          if (receptoresFrecuentes[0]) {
                            setNombre(receptoresFrecuentes[0].nombre || '');
                            setApellido(receptoresFrecuentes[0].apellido || '');
                            setTelefono(receptoresFrecuentes[0].telefono || '');
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#60a5fa',
                          fontSize: '0.85em',
                          cursor: 'pointer',
                          marginBottom: '14px',
                          padding: 0,
                          fontWeight: 'bold',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        ← Seleccionar de la lista de personas registradas
                      </button>
                    )}

                    {/* Nombre (Obligatorio) */}
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', fontSize: '0.82em', color: '#94a3b8', marginBottom: '6px', fontWeight: 'bold' }}>
                        Nombre de quien recibe <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div style={{ position: 'relative' }}>
                        <User style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '16px', height: '16px', color: '#64748b' }} />
                        <input 
                          type="text"
                          required
                          placeholder="Ej: Luciana"
                          value={nombre}
                          onChange={e => setNombre(e.target.value)}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '12px 12px 12px 38px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(15, 23, 42, 0.6)',
                            color: 'white',
                            fontSize: '0.95em',
                            outline: 'none',
                            transition: 'border-color 0.2s'
                          }}
                        />
                      </div>
                    </div>

                    {/* Apellido (Opcional) */}
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', fontSize: '0.82em', color: '#94a3b8', marginBottom: '6px' }}>
                        Apellido (Opcional)
                      </label>
                      <input 
                        type="text"
                        placeholder="Ej: Pérez"
                        value={apellido}
                        onChange={e => setApellido(e.target.value)}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '12px 12px',
                          borderRadius: '8px',
                          border: '1px solid rgba(255,255,255,0.1)',
                          background: 'rgba(15, 23, 42, 0.6)',
                          color: 'white',
                          fontSize: '0.95em',
                          outline: 'none'
                        }}
                      />
                    </div>

                    {/* Celular (Opcional) */}
                    <div style={{ marginBottom: '25px' }}>
                      <label style={{ display: 'block', fontSize: '0.82em', color: '#94a3b8', marginBottom: '6px' }}>
                        Celular de Contacto (Opcional)
                      </label>
                      <div style={{ position: 'relative' }}>
                        <Phone style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', width: '16px', height: '16px', color: '#64748b' }} />
                        <input 
                          type="tel"
                          placeholder="Ej: (221) 661-5746"
                          value={telefono}
                          onChange={e => setTelefono(aplicarMascaraTelefono(e.target.value))}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '12px 12px 12px 38px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(15, 23, 42, 0.6)',
                            color: 'white',
                            fontSize: '0.95em',
                            outline: 'none'
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}

                <button 
                  type="submit"
                  style={{
                    width: '100%',
                    padding: '14px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    color: 'white',
                    border: 'none',
                    fontWeight: 'bold',
                    fontSize: '1em',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)',
                  }}
                >
                  Iniciar Control de Entrega
                  <ArrowRight style={{ width: '18px', height: '18px' }} />
                </button>
              </form>
            )}

            {/* -----------------------------------------------------------------
                PANTALLA 2: CHECKLIST DE ARTÍCULOS Y CONFIRMACIÓN
                ----------------------------------------------------------------- */}
            {step === 2 && (
              <div>
                {/* Cabecera control */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                  <button 
                    onClick={() => {
                      if (modoAuditoria) {
                        setModoAuditoria(false);
                      } else {
                        setStep(1);
                      }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <ArrowLeft style={{ width: '20px', height: '20px' }} />
                  </button>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: modoAuditoria ? '#ea580c' : '#10b981' }}>
                      {modoAuditoria ? 'Auditoría de Mercadería' : 'Verificar Mercadería'}
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.8em', color: '#94a3b8' }}>
                      Receptor: <strong style={{ color: 'white' }}>{nombre}</strong>
                    </p>
                  </div>
                </div>

                {!modoAuditoria ? (
                  /* --- TRACK 1: VÍA RÁPIDA O AUDITORÍA --- */
                  <div>
                    <div style={{ padding: '12px', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '8px', marginBottom: '20px', fontSize: '0.85em', color: '#93c5fd', lineHeight: '1.4' }}>
                      <strong>Instrucciones:</strong> Verifique que los bultos coincidan con la mercadería entregada. Si está todo correcto, use la Vía Rápida. Si falta algo o vino dañado, seleccione Reportar Novedad o Faltante.
                    </div>

                    {/* Lista simple de ítems para revisión rápida */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '25px' }}>
                      {items.map(item => (
                        <div 
                          key={item.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid rgba(255,255,255,0.04)',
                            borderRadius: '8px'
                          }}
                        >
                          <div>
                            <div style={{ fontSize: '0.9em', fontWeight: '500', color: 'white' }}>
                              {item.producto_descripcion}
                            </div>
                            <div style={{ fontSize: '0.75em', color: '#64748b', marginTop: '2px' }}>
                              Código: {item.producto_codigo}
                            </div>
                          </div>
                          <div style={{ fontSize: '1em', fontWeight: 'bold', color: '#e2e8f0', background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '6px', fontFamily: 'monospace' }}>
                            {parseFloat(item.cantidad)} u.
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* BOTONES DOBLE TRACK */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <button 
                        onClick={handleSubmit}
                        disabled={isSubmitting}
                        style={{
                          width: '100%',
                          padding: '14px',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          color: 'white',
                          border: 'none',
                          fontWeight: 'bold',
                          fontSize: '1em',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)',
                          transition: 'transform 0.1s, opacity 0.2s',
                        }}
                      >
                        {isSubmitting ? (
                          <Loader2 style={{ width: '18px', height: '18px', animation: 'spin 1.5s linear infinite' }} />
                        ) : (
                          <>
                            <CheckCircle2 style={{ width: '20px', height: '20px' }} />
                            Conforme - Todo OK (Vía Rápida)
                          </>
                        )}
                      </button>

                      <button 
                        onClick={() => {
                          // Inicializar cantidades reales al pasar a auditoría
                          const initCants = {};
                          items.forEach(it => {
                            initCants[it.id] = it.cantidad;
                          });
                          setCantidadesReales(initCants);
                          setModoAuditoria(true);
                        }}
                        disabled={isSubmitting}
                        style={{
                          width: '100%',
                          padding: '14px',
                          borderRadius: '8px',
                          background: 'rgba(234, 88, 12, 0.1)',
                          border: '1px solid #ea580c',
                          color: '#f97316',
                          fontWeight: 'bold',
                          fontSize: '1em',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          transition: 'all 0.2s'
                        }}
                      >
                        <AlertTriangle style={{ width: '18px', height: '18px' }} />
                        Reportar Novedad o Faltante
                      </button>
                    </div>
                  </div>
                ) : (
                  /* --- TRACK 2: PANEL DE AUDITORÍA (SEMÁFORO) --- */
                  <div>
                    <div style={{ padding: '12px', background: 'rgba(234, 88, 12, 0.08)', border: '1px solid rgba(234, 88, 12, 0.2)', borderRadius: '8px', marginBottom: '20px', fontSize: '0.82em', color: '#fdba74', lineHeight: '1.4' }}>
                      <strong>Semáforo de Reclamos:</strong> Ajuste la cantidad real que ingresó a su depósito e indique el motivo de la diferencia.
                    </div>

                    {/* Grilla Semáforo de Artículos */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '25px' }}>
                      {items.map(item => {
                        const cantReal = cantidadesReales[item.id] !== undefined ? cantidadesReales[item.id] : item.cantidad;
                        const qtyOriginal = parseFloat(item.cantidad);
                        const qtyRealNum = parseFloat(cantReal);
                        const tieneReclamo = qtyRealNum < qtyOriginal;
                        
                        return (
                          <div 
                            key={item.id}
                            style={{
                              padding: '14px',
                              background: tieneReclamo ? 'rgba(234, 88, 12, 0.03)' : 'rgba(255,255,255,0.01)',
                              border: tieneReclamo ? '1px solid rgba(234, 88, 12, 0.25)' : '1px solid rgba(255,255,255,0.03)',
                              borderRadius: '10px',
                              transition: 'all 0.2s'
                            }}
                          >
                            {/* Titulo/Desc */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '10px' }}>
                              <div style={{ fontSize: '0.88em', fontWeight: '500', color: 'white' }}>
                                {item.producto_descripcion}
                              </div>
                              <span style={{ fontSize: '0.72em', color: '#64748b', whiteSpace: 'nowrap' }}>
                                Original: {qtyOriginal}u.
                              </span>
                            </div>

                            {/* Controles de Ajuste Numérico */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextVal = Math.max(0, qtyRealNum - 1);
                                    setCantidadesReales(prev => ({ ...prev, [item.id]: nextVal }));
                                  }}
                                  style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '6px',
                                    border: '1px solid #475569',
                                    background: 'rgba(255,255,255,0.02)',
                                    color: 'white',
                                    fontSize: '1.2em',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}
                                >
                                  -
                                </button>
                                
                                <input
                                  type="number"
                                  min="0"
                                  max={qtyOriginal}
                                  value={cantReal}
                                  onChange={(e) => {
                                    let val = parseFloat(e.target.value);
                                    if (isNaN(val)) val = 0;
                                    if (val < 0) val = 0;
                                    if (val > qtyOriginal) val = qtyOriginal;
                                    setCantidadesReales(prev => ({ ...prev, [item.id]: val }));
                                  }}
                                  style={{
                                    width: '60px',
                                    padding: '6px',
                                    textAlign: 'center',
                                    background: 'rgba(0,0,0,0.2)',
                                    border: '1px solid #475569',
                                    borderRadius: '6px',
                                    color: 'white',
                                    fontFamily: 'monospace',
                                    fontWeight: 'bold',
                                    fontSize: '0.95em'
                                  }}
                                />

                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextVal = Math.min(qtyOriginal, qtyRealNum + 1);
                                    setCantidadesReales(prev => ({ ...prev, [item.id]: nextVal }));
                                  }}
                                  style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '6px',
                                    border: '1px solid #475569',
                                    background: 'rgba(255,255,255,0.02)',
                                    color: 'white',
                                    fontSize: '1.2em',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}
                                >
                                  +
                                </button>
                              </div>

                              {tieneReclamo && (
                                <span style={{ fontSize: '0.78em', color: '#f97316', fontWeight: '500' }}>
                                  ⚠️ Faltan {qtyOriginal - qtyRealNum} u.
                                </span>
                              )}
                            </div>

                            {/* Causal y Comentarios del Ítem */}
                            {tieneReclamo && (
                              <div style={{ marginTop: '12px', borderTop: '1px dashed rgba(255,255,255,0.05)', paddingTop: '10px' }}>
                                <label style={{ display: 'block', fontSize: '0.72em', color: '#94a3b8', marginBottom: '4px' }}>
                                  Motivo de Novedad:
                                </label>
                                <select
                                  value={motivosDiscrepancia[item.id] || ''}
                                  onChange={(e) => setMotivosDiscrepancia(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  style={{
                                    width: '100%',
                                    padding: '8px',
                                    borderRadius: '6px',
                                    background: '#1e293b',
                                    border: '1px solid #475569',
                                    color: 'white',
                                    fontSize: '0.8em',
                                    marginBottom: '8px',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <option value="">-- Seleccionar Motivo --</option>
                                  <option value="Faltante">Faltante (No vino dentro del bulto)</option>
                                  <option value="Mercadería Dañada / Rota">Mercadería Dañada / Rota</option>
                                  <option value="Problema de Calidad">Problema de Calidad (Humedad / Mal estado)</option>
                                </select>

                                <input
                                  type="text"
                                  placeholder="Comentario opcional del artículo..."
                                  value={comentariosItems[item.id] || ''}
                                  onChange={(e) => setComentariosItems(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  style={{
                                    width: '100%',
                                    padding: '8px',
                                    borderRadius: '6px',
                                    background: 'rgba(0,0,0,0.15)',
                                    border: '1px solid #334155',
                                    color: 'white',
                                    fontSize: '0.8em'
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* SECCIÓN FOTOGRAFÍAS DE EVIDENCIA (HASTA 2) */}
                    <div style={{ marginBottom: '20px', padding: '14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '10px' }}>
                      <label style={{ display: 'block', fontSize: '0.82em', fontWeight: 'bold', color: 'white', marginBottom: '8px' }}>
                        📸 Evidencia Fotográfica (Máx. 2 fotos)
                      </label>
                      <p style={{ margin: '0 0 12px 0', fontSize: '0.75em', color: '#94a3b8' }}>
                        Tome fotos de la mercadería dañada o faltantes detectados.
                      </p>

                      <div style={{ display: 'flex', gap: '15px' }}>
                        {/* Foto 1 */}
                        <div style={{ flex: 1, position: 'relative', height: '110px', border: '1px dashed #475569', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'rgba(0,0,0,0.15)' }}>
                          {fotoReclamo1 ? (
                            <>
                              <img src={fotoReclamo1} alt="Foto 1" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              <button
                                type="button"
                                onClick={() => setFotoReclamo1(null)}
                                style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(239,68,68,0.85)', border: 'none', borderRadius: '50%', width: '22px', height: '22px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                              >
                                <X style={{ width: '12px', height: '12px' }} />
                              </button>
                            </>
                          ) : (
                            <label style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                              <Camera style={{ width: '22px', height: '22px', color: '#64748b' }} />
                              <span style={{ fontSize: '0.72em' }}>Foto 1</span>
                              <input 
                                type="file" 
                                accept="image/*" 
                                capture="environment"
                                onChange={(e) => handlePhotoUpload(e.target.files[0], 1)} 
                                style={{ display: 'none' }} 
                              />
                            </label>
                          )}
                        </div>

                        {/* Foto 2 */}
                        <div style={{ flex: 1, position: 'relative', height: '110px', border: '1px dashed #475569', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'rgba(0,0,0,0.15)' }}>
                          {fotoReclamo2 ? (
                            <>
                              <img src={fotoReclamo2} alt="Foto 2" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              <button
                                type="button"
                                onClick={() => setFotoReclamo2(null)}
                                style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(239,68,68,0.85)', border: 'none', borderRadius: '50%', width: '22px', height: '22px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                              >
                                <X style={{ width: '12px', height: '12px' }} />
                              </button>
                            </>
                          ) : (
                            <label style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', color: '#94a3b8' }}>
                              <Camera style={{ width: '22px', height: '22px', color: '#64748b' }} />
                              <span style={{ fontSize: '0.72em' }}>Foto 2</span>
                              <input 
                                type="file" 
                                accept="image/*" 
                                capture="environment"
                                onChange={(e) => handlePhotoUpload(e.target.files[0], 2)} 
                                style={{ display: 'none' }} 
                              />
                            </label>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* NOTAS GLOBALES DE RECEPCION */}
                    <div style={{ marginBottom: '25px' }}>
                      <label style={{ display: 'block', fontSize: '0.8em', fontWeight: 'bold', color: '#94a3b8', marginBottom: '6px' }}>
                        Comentarios Generales del Reclamo:
                      </label>
                      <textarea
                        placeholder="Escriba comentarios adicionales sobre la descarga..."
                        value={comentariosGlobales}
                        onChange={(e) => setComentariosGlobales(e.target.value)}
                        style={{
                          width: '100%',
                          height: '75px',
                          padding: '10px',
                          borderRadius: '8px',
                          background: 'rgba(0,0,0,0.2)',
                          border: '1px solid #475569',
                          color: 'white',
                          fontSize: '0.85em',
                          resize: 'none'
                        }}
                      />
                    </div>

                    {/* ACCIONES DE SUBMIT Y CANCELAR EN AUDITORIA */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button
                        onClick={() => setModoAuditoria(false)}
                        disabled={isSubmitting}
                        style={{
                          flex: 1,
                          padding: '12px',
                          borderRadius: '8px',
                          background: 'none',
                          border: '1px solid #475569',
                          color: '#94a3b8',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          fontSize: '0.9em'
                        }}
                      >
                        Atrás
                      </button>

                      <button
                        onClick={handleAuditoriaSubmit}
                        disabled={isSubmitting}
                        style={{
                          flex: 2,
                          padding: '12px',
                          borderRadius: '8px',
                          background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                          color: 'white',
                          border: 'none',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          fontSize: '0.9em',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: '0 4px 12px rgba(234, 88, 12, 0.2)'
                        }}
                      >
                        {isSubmitting ? (
                          <Loader2 style={{ width: '18px', height: '18px', animation: 'spin 1.5s linear infinite' }} />
                        ) : (
                          <>
                            <Check style={{ width: '18px', height: '18px' }} />
                            Enviar Reporte
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Metadatos secundarios al final del formulario */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '25px', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.75em', color: '#475569' }}>
              <span>Cliente: {pedido.cliente_id}</span>
              <span>Emisión: {new Date(pedido.fecha_pedido).toLocaleDateString('es-AR')}</span>
            </div>
          </>
        )}

        {/* Footer info */}
        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.72em', color: '#475569', paddingTop: '10px' }}>
          Tostadero Búnker S.A. - Recepción Segura con QR
        </div>
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
