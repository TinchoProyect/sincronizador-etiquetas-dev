import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import Swal from 'sweetalert2';
import { fetchPoliticaB2B, evaluarPoliticaB2B } from '../utils/politicasB2B';
import { registrarAccesoTelemetria } from '../utils/telemetria';
import { 
  ClipboardList, 
  Clock, 
  Package, 
  Truck, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  Loader2, 
  Calendar, 
  AlertCircle,
  AlertTriangle,
  FileText,
  Minus,
  Plus,
  Trash2,
  ShoppingBag,
  Users,
  QrCode,
  Share2,
  Copy,
  ExternalLink,
  Bell,
  Eye,
  Send,
  Check,
  X
} from 'lucide-react';

export default function Pedidos({ profile, cart = [], addToCart, removeFromCart, clearCart, setCurrentTab }) {
  const [pedidos, setPedidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedPedidoId, setExpandedPedidoId] = useState(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [openMonthKey, setOpenMonthKey] = useState(null);
  
  const [submitting, setSubmitting] = useState(false);
  const [nota, setNota] = useState('');
  const [politicaComercial, setPoliticaComercial] = useState(null);

  useEffect(() => {
    if (profile?.cliente_id) {
      fetchPoliticaB2B(profile).then(pol => setPoliticaComercial(pol));
    }
  }, [profile]);

  const politicaEval = useMemo(() => {
    return evaluarPoliticaB2B(politicaComercial, cart, profile);
  }, [politicaComercial, cart, profile]);

  // Estados para Delegación de Pre-Pedidos / Modo Reposición (Colaboradores)
  const [prepedidosPendientes, setPrepedidosPendientes] = useState([]);
  const [showDelegarModal, setShowDelegarModal] = useState(false);
  const [colaboradorNombre, setColaboradorNombre] = useState('');
  const [mostrarPrecios, setMostrarPrecios] = useState(false);
  const [mostrarSinIvaDelegacion, setMostrarSinIvaDelegacion] = useState(false);
  const [tipoEnlace, setTipoEnlace] = useState('permanente');
  const [generandoEnlace, setGenerandoEnlace] = useState(false);
  const [enlaceGenerado, setEnlaceGenerado] = useState(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [activeDelegaciones, setActiveDelegaciones] = useState([]);
  const [viewingPrepedido, setViewingPrepedido] = useState(null);

  useEffect(() => {
    if (profile?.cliente_id) {
      fetchPedidos();
      fetchPrepedidos();
      fetchDelegaciones();
    }
  }, [profile]);

  // Auto-reparar ítems del carrito con precio en 0 (ej: pre-pedidos antiguos cargados en el carrito)
  useEffect(() => {
    if (!profile?.cliente_id || !Array.isArray(cart) || cart.length === 0) return;

    const zeroPriceItems = cart.filter(it => !it.precio_unitario || parseFloat(it.precio_unitario) <= 0);
    if (zeroPriceItems.length === 0) return;

    const codigos = zeroPriceItems.map(it => (it.producto_codigo || '').trim()).filter(Boolean);
    const listasIds = Array.isArray(profile.listas_precios) ? profile.listas_precios : [];

    const repairPrices = async () => {
      try {
        let query = supabase
          .from('clientes_b2b_catalogo_precios')
          .select('producto_codigo, producto_descripcion, precio_final')
          .in('producto_codigo', codigos);

        if (listasIds.length > 0) {
          query = query.in('lista_id', listasIds);
        }

        const { data: prodsData } = await query;
        if (prodsData && prodsData.length > 0) {
          for (const p of prodsData) {
            const cleanCod = (p.producto_codigo || '').trim();
            const precioReal = parseFloat(p.precio_final || 0);
            if (precioReal > 0) {
              const currentItem = cart.find(c => (c.producto_codigo || '').trim() === cleanCod);
              if (currentItem) {
                addToCart({
                  producto_codigo: cleanCod,
                  producto_descripcion: currentItem.producto_descripcion || p.producto_descripcion,
                  precio_final: precioReal
                }, currentItem.cantidad);
              }
            }
          }
        }
      } catch (e) {
        console.warn('Error reparando precios en 0 del carrito:', e);
      }
    };

    repairPrices();
  }, [cart, profile]);

  const fetchPedidos = async () => {
    setLoading(true);
    setError(null);
    try {
      // Consultamos la cabecera del cliente e inyectamos los items correspondientes
      let query = supabase
        .from('clientes_b2b_pedidos_cabecera')
        .select(`
          *,
          clientes_b2b_pedidos_items (
            id,
            producto_codigo,
            producto_descripcion,
            cantidad,
            precio_unitario,
            subtotal,
            cantidad_recibida,
            motivo_incidencia,
            comentarios
          )
        `);

      if (profile?.cliente_id) {
        query = query.eq('cliente_id', profile.cliente_id);
      }

      const { data, error: fetchError } = await query
        .not('estado', 'eq', 'Cancelado')
        .not('estado', 'eq', 'CANCELLED')
        .not('estado', 'eq', 'Eliminado')
        .order('fecha_pedido', { ascending: false });

      if (fetchError) throw fetchError;
      setPedidos(data || []);
    } catch (err) {
      console.error('Error al cargar pedidos:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPrepedidos = async () => {
    if (!profile?.cliente_id) return;
    try {
      const { data, error: err } = await supabase
        .from('clientes_b2b_prepedidos')
        .select('*')
        .eq('cliente_id', profile.cliente_id)
        .eq('estado', 'pendiente_revision')
        .order('created_at', { ascending: false });
      if (!err && data) {
        setPrepedidosPendientes(data);
      }
    } catch (e) {
      console.warn('Advertencia al consultar pre-pedidos:', e);
    }
  };

  const fetchDelegaciones = async () => {
    if (!profile?.cliente_id) return;
    try {
      const { data, error: err } = await supabase
        .from('clientes_b2b_delegaciones')
        .select('*')
        .eq('cliente_id', profile.cliente_id)
        .eq('activo', true)
        .order('created_at', { ascending: false });
      if (!err && data) {
        // Filtrar también cualquier enlace que haya expirado
        const vigentes = data.filter(d => !d.expires_at || new Date(d.expires_at) > new Date());
        setActiveDelegaciones(vigentes);
      }
    } catch (e) {
      console.warn('Advertencia al consultar delegaciones:', e);
    }
  };

  const handleCrearDelegacion = async () => {
    if (!profile?.cliente_id) return;
    setGenerandoEnlace(true);
    try {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0')).join('');

      const listasIds = Array.isArray(profile.listas_precios) ? profile.listas_precios : [];
      const nombreEmpresa = profile.nombre_empresa || profile.nombre_completo || 'Comercio B2B';

      const { data, error: insertErr } = await supabase
        .from('clientes_b2b_delegaciones')
        .insert({
          cliente_id: profile.cliente_id,
          token: token,
          nombre_empresa: nombreEmpresa,
          nombre_colaborador: colaboradorNombre.trim() || 'Colaborador',
          mostrar_precios: mostrarPrecios,
          mostrar_sin_iva: mostrarPrecios ? mostrarSinIvaDelegacion : false,
          tipo_enlace: tipoEnlace,
          listas_ids: listasIds,
          activo: true
        })
        .select()
        .single();

      if (insertErr) throw insertErr;

      const origin = window.location.origin;
      const url = `${origin}/#/pre-pedido?token=${token}`;
      setEnlaceGenerado({ token, url, colaborador: data.nombre_colaborador });
      fetchDelegaciones();
    } catch (err) {
      Swal.fire({
        title: 'Error al generar enlace',
        text: err.message,
        icon: 'error',
        confirmButtonColor: '#7c3aed'
      });
    } finally {
      setGenerandoEnlace(false);
    }
  };

  const handleRevocarDelegacion = async (delId) => {
    try {
      const res = await Swal.fire({
        title: '¿Eliminar este enlace?',
        text: 'El colaborador ya no podrá acceder a la reposición y el enlace desaparecerá de este listado.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ef4444'
      });
      if (res.isConfirmed) {
        await supabase
          .from('clientes_b2b_delegaciones')
          .update({ activo: false, updated_at: new Date().toISOString() })
          .eq('id', delId);
        setActiveDelegaciones(prev => prev.filter(d => d.id !== delId));
        fetchDelegaciones();
      }
    } catch (e) {
      console.error('Error al dar de baja enlace:', e);
    }
  };

  const handleIncorporarPrepedido = async (prepedido) => {
    const items = prepedido.items || [];
    if (items.length === 0) return;

    // 1. Obtener todos los códigos de productos del pre-pedido
    const codigos = items.map(it => (it.producto_codigo || '').trim()).filter(Boolean);

    // 2. Consultar el catálogo vigente del cliente para obtener precio_final y descripción oficial
    const preciosMap = new Map();
    try {
      const listasIds = Array.isArray(profile.listas_precios) ? profile.listas_precios : [];
      let query = supabase
        .from('clientes_b2b_catalogo_precios')
        .select('producto_codigo, producto_descripcion, precio_final')
        .in('producto_codigo', codigos);

      if (listasIds.length > 0) {
        query = query.in('lista_id', listasIds);
      }

      const { data: prodsData } = await query;
      if (prodsData && prodsData.length > 0) {
        for (const p of prodsData) {
          const cleanCod = (p.producto_codigo || '').trim();
          if (!preciosMap.has(cleanCod) || parseFloat(p.precio_final || 0) > 0) {
            preciosMap.set(cleanCod, {
              precio_final: parseFloat(p.precio_final || 0),
              producto_descripcion: p.producto_descripcion
            });
          }
        }
      }
    } catch (e) {
      console.warn('Advertencia al consultar precios vigentes para pre-pedido:', e);
    }

    let totalCargados = 0;
    for (const it of items) {
      const cleanCod = (it.producto_codigo || '').trim();
      const cant = parseInt(it.cantidad, 10) || 1;
      
      const infoCat = preciosMap.get(cleanCod);
      const precioUnitario = infoCat && infoCat.precio_final > 0
        ? infoCat.precio_final
        : (parseFloat(it.precio_unitario) || 0);

      const descripcion = (infoCat && infoCat.producto_descripcion)
        ? infoCat.producto_descripcion
        : it.producto_descripcion;

      addToCart({
        producto_codigo: cleanCod,
        producto_descripcion: descripcion,
        precio_final: precioUnitario
      }, cant);
      totalCargados += cant;
    }

    if (prepedido.nota_colaborador) {
      setNota(prev => {
        const prefijo = `[Nota de ${prepedido.colaborador_nombre || 'Colaborador'}]: ${prepedido.nota_colaborador}`;
        return prev ? `${prev}\n${prefijo}` : prefijo;
      });
    }

    await supabase
      .from('clientes_b2b_prepedidos')
      .update({ estado: 'incorporado', updated_at: new Date().toISOString() })
      .eq('id', prepedido.id);

    fetchPrepedidos();
    setViewingPrepedido(null);

    Swal.fire({
      title: '¡Pre-pedido incorporado!',
      text: `Se agregaron ${items.length} artículos (${totalCargados} unidades) seleccionados por ${prepedido.colaborador_nombre || 'tu colaborador'} con los precios vigentes de tu lista.`,
      icon: 'success',
      confirmButtonColor: '#7c3aed'
    });
  };

  const handleDescartarPrepedido = async (prepedidoId) => {
    const res = await Swal.fire({
      title: '¿Descartar este pre-pedido?',
      text: 'La lista de reposición se archivará sin agregarse a tu orden de compra.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, descartar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#ef4444'
    });
    if (res.isConfirmed) {
      await supabase
        .from('clientes_b2b_prepedidos')
        .update({ estado: 'descartado', updated_at: new Date().toISOString() })
        .eq('id', prepedidoId);
      fetchPrepedidos();
      setViewingPrepedido(null);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS'
    }).format(val);
  };

  const getStepIndex = (estado) => {
    const est = (estado || '').toLowerCase().trim();
    if (est === 'borrador' || est === 'pendiente' || est === 'en preparacion') {
      return 1;
    }
    if (est === 'en proceso') {
      return 2;
    }
    if (est === 'listo para entregar') {
      return 3;
    }
    if (est === 'en ruta' || est === 'listo para retirar') {
      return 4;
    }
    if (est === 'entregado' || est === 'reclamado') {
      return 5;
    }
    return 1; // Default
  };

  const toggleExpand = (id) => {
    if (expandedPedidoId !== id) {
      registrarAccesoTelemetria(`👁️ Consultó detalle de Pedido #${id}`, profile);
    }
    setExpandedPedidoId(expandedPedidoId === id ? null : id);
  };

  const stepsConfig = [
    { label: 'Preparación', sublabel: 'En cola de armado', icon: ClipboardList },
    { label: 'Producción', sublabel: 'Armando pedido', icon: Clock },
    { label: 'Listo para Entregar', sublabel: 'Control de bultos', icon: Package },
    { label: 'Logística', sublabel: 'Despacho / Retiro', icon: Truck },
    { label: 'Entregado', sublabel: 'Circuito finalizado', icon: CheckCircle2 }
  ];

  if (loading) {
    return (
      <div className="spinner-container">
        <Loader2 className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Cargando su historial de pedidos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state" style={{ borderColor: 'var(--danger)' }}>
        <AlertCircle size={48} style={{ color: 'var(--danger)' }} />
        <p className="empty-state-title">Ocurrió un error al obtener los pedidos</p>
        <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
        <button onClick={fetchPedidos} className="filter-btn" style={{ marginTop: '1rem' }}>
          Reintentar Carga
        </button>
      </div>
    );
  }

  const cartTotal = cart.reduce((acc, item) => acc + item.subtotal, 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    
    try {
      const subtotal = cartTotal;
      const montoDescuento = politicaEval.aplica ? politicaEval.montoDescuento : 0.00;
      const total = cartTotal - montoDescuento;
      const editandoPedidoId = localStorage.getItem('B2B_EDITANDO_PEDIDO_ID');
      const isEdition = !!editandoPedidoId;

      let obs = nota.trim();
      if (politicaEval.aplica && politicaEval.porcentaje > 0) {
        const tag = `(Bonif. Comercial: ${politicaEval.porcentaje}% por volumen)`;
        obs = obs ? `${obs} • ${tag}` : tag;
      }

      // 1. Insertar cabecera del pedido con guardarraíl para base de datos no migrada
      let header;
      let headerErr;

      const cabeceraPayload = {
        cliente_id: profile.cliente_id,
        subtotal: subtotal,
        descuento: montoDescuento,
        total: total,
        observaciones: obs || null,
        estado: 'Borrador',
        sync_estado: 'Pendiente',
        es_edicion: isEdition
      };

      const resSupa = await supabase
        .from('clientes_b2b_pedidos_cabecera')
        .insert(cabeceraPayload)
        .select()
        .single();

      header = resSupa.data;
      headerErr = resSupa.error;

      if (headerErr && headerErr.message && headerErr.message.includes('es_edicion')) {
        console.warn('⚠️ La columna es_edicion no existe en la base remota. Reintentando sin esa columna...');
        delete cabeceraPayload.es_edicion;
        const fallbackRes = await supabase
          .from('clientes_b2b_pedidos_cabecera')
          .insert(cabeceraPayload)
          .select()
          .single();
        header = fallbackRes.data;
        headerErr = fallbackRes.error;
      }

      if (headerErr) throw headerErr;
      registrarAccesoTelemetria(`✅ Confirmó Pedido B2B #${header.id} (${cart.length} ítems — Total: ${formatCurrency(total)})`, profile);
      
      // Limpiar marca de edición
      if (isEdition) {
        localStorage.removeItem('B2B_EDITANDO_PEDIDO_ID');
      }

      // 2. Insertar ítems del pedido
      const itemsPayload = cart.map(item => ({
        pedido_id: header.id,
        producto_codigo: item.producto_codigo,
        producto_descripcion: item.producto_descripcion,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        subtotal: item.subtotal
      }));

      const { error: itemsErr } = await supabase
        .from('clientes_b2b_pedidos_items')
        .insert(itemsPayload);

      if (itemsErr) throw itemsErr;

      // Alerta SweetAlert2
      Swal.fire({
        title: '¡Pedido Confirmado!',
        text: `Su orden ha sido registrada con éxito (ID: ${header.id.slice(0, 8)}). Se ingresará a la grilla logística en la distribuidora para su armado en breve.`,
        icon: 'success',
        confirmButtonText: 'Listo',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)',
        iconColor: 'var(--success)'
      });

      clearCart();
      setNota('');
      // Recargar el historial
      fetchPedidos();
    } catch (err) {
      console.error('Error al enviar pedido:', err.message);
      Swal.fire({
        title: 'Error al enviar pedido',
        text: err.message,
        icon: 'error',
        confirmButtonText: 'Entendido',
        confirmButtonColor: 'var(--accent)',
        background: 'hsl(222, 47%, 11%)',
        color: 'var(--text-primary)'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearCartPrompt = () => {
    Swal.fire({
      title: '¿Eliminar Pedido?',
      text: 'Se limpiará por completo la simulación actual y el carrito quedará vacío. Esta acción no se puede deshacer.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, vaciar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--danger)',
      cancelButtonColor: 'rgba(255,255,255,0.05)',
      background: 'hsl(222, 47%, 11%)',
      color: 'var(--text-primary)',
      iconColor: 'var(--danger)'
    }).then((result) => {
      if (result.isConfirmed) {
        clearCart();
        setNota('');
      }
    });
  };

  const handleAnularPedido = async (pedidoId) => {
    Swal.fire({
      title: '¿Anular este pedido?',
      text: 'Se enviará la solicitud de cancelación a la distribuidora. Esta acción no se puede revertir.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, anular',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--danger)',
      cancelButtonColor: 'rgba(255,255,255,0.05)',
      background: 'hsl(222, 47%, 11%)',
      color: 'var(--text-primary)',
      iconColor: 'var(--danger)'
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const { error: patchError } = await supabase
            .from('clientes_b2b_pedidos_cabecera')
            .update({ estado: 'CANCELLED' })
            .eq('id', pedidoId);

          if (patchError) throw patchError;

          Swal.fire({
            title: 'Pedido Anulado',
            text: 'El pedido ha sido marcado como Cancelado. El sincronizador del sistema actualizará la cola de armado en unos instantes.',
            icon: 'success',
            confirmButtonText: 'Entendido',
            confirmButtonColor: 'var(--accent)',
            background: 'hsl(222, 47%, 11%)',
            color: 'var(--text-primary)'
          });

          fetchPedidos();
        } catch (err) {
          console.error('Error al anular pedido:', err.message);
          Swal.fire({
            title: 'Error al anular',
            text: err.message,
            icon: 'error',
            confirmButtonText: 'Aceptar',
            background: 'hsl(222, 47%, 11%)',
            color: 'var(--text-primary)'
          });
        }
      }
    });
  };

  const handleEditarPedido = async (pedido) => {
    Swal.fire({
      title: '¿Editar este pedido?',
      text: 'Se cargarán los artículos de esta orden en el carrito actual con sus precios vigentes y se cancelará el pedido anterior para que puedas realizar tus modificaciones. ¿Deseas continuar?',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, editar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--accent)',
      cancelButtonColor: 'rgba(255,255,255,0.05)',
      background: 'hsl(222, 47%, 11%)',
      color: 'var(--text-primary)',
      iconColor: 'var(--accent)'
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          if (!profile?.cliente_id) {
            throw new Error("No se pudo identificar el perfil del cliente.");
          }

          // 1. Obtener listas de precios asignadas al cliente
          const { data: userLists, error: listError } = await supabase
            .from('clientes_b2b_perfiles_listas')
            .select('lista_id, es_principal')
            .eq('cliente_id', profile.cliente_id);

          if (listError) throw listError;
          if (!userLists || userLists.length === 0) {
            throw new Error("El cliente no tiene listas de precios asignadas.");
          }

          const listIds = userLists.map(ul => ul.lista_id);
          const listPriorityMap = new Map();
          for (const ul of userLists) {
            listPriorityMap.set(ul.lista_id, ul.es_principal ? 1 : 2);
          }

          // 2. Obtener códigos de los ítems del pedido (limpiando espacios)
          const oldItems = pedido.clientes_b2b_pedidos_items || [];
          const codigos = oldItems.map(it => (it.producto_codigo || '').trim());

          // 3. Consultar precios vigentes en Supabase
          const { data: catalogPrices, error: catalogError } = await supabase
            .from('clientes_b2b_catalogo_precios')
            .select('producto_codigo, precio_final, lista_id')
            .in('lista_id', listIds)
            .in('producto_codigo', codigos);

          if (catalogError) throw catalogError;

          // 4. Mapear precios vigentes priorizando listas principales
          const priceMap = new Map();
          for (const cp of catalogPrices || []) {
            const cleanCode = (cp.producto_codigo || '').trim();
            const existing = priceMap.get(cleanCode);
            const currentPrice = parseFloat(cp.precio_final);

            if (!existing) {
              priceMap.set(cleanCode, cp);
            } else {
              const existingPrice = parseFloat(existing.precio_final);
              const existingPriority = listPriorityMap.get(existing.lista_id) || 99;
              const itemPriority = listPriorityMap.get(cp.lista_id) || 99;

              let shouldUpdate = false;
              if (existingPrice <= 0 && currentPrice > 0) {
                shouldUpdate = true;
              } else if (currentPrice > 0 && itemPriority < existingPriority) {
                shouldUpdate = true;
              }

              if (shouldUpdate) {
                priceMap.set(cleanCode, cp);
              }
            }
          }

          // 5. Limpiar carrito actual
          clearCart();
          
          // 6. Cargar ítems al carrito con el precio de catálogo vivo
          for (const item of oldItems) {
            const cleanCode = (item.producto_codigo || '').trim();
            const livePriceObj = priceMap.get(cleanCode);
            const livePrice = livePriceObj ? parseFloat(livePriceObj.precio_final) : parseFloat(item.precio_unitario);

            await addToCart({
              producto_codigo: cleanCode,
              producto_descripcion: item.producto_descripcion,
              precio_final: livePrice
            }, item.cantidad);
          }

          // 7. Cancelar pedido anterior en Supabase
          const { error: patchError } = await supabase
            .from('clientes_b2b_pedidos_cabecera')
            .update({ estado: 'CANCELLED' })
            .eq('id', pedido.id);

          if (patchError) throw patchError;

          // Guardar marca de edición
          localStorage.setItem('B2B_EDITANDO_PEDIDO_ID', pedido.id);

          // 8. Establecer observaciones del pedido anterior si las tuviera
          if (pedido.observaciones) {
            setNota(pedido.observaciones);
          }

          Swal.fire({
            title: 'Pedido listo para editar',
            text: 'Los artículos han sido cargados en tu carrito con precios vigentes. Serás redirigido a la solapa de artículos.',
            icon: 'success',
            confirmButtonText: 'Ir a artículos',
            confirmButtonColor: 'var(--accent)',
            background: 'hsl(222, 47%, 11%)',
            color: 'var(--text-primary)'
          }).then(() => {
            setCurrentTab('articulos');
          });

        } catch (err) {
          console.error('Error al iniciar edición de pedido:', err.message);
          Swal.fire({
            title: 'Error al editar',
            text: err.message,
            icon: 'error',
            confirmButtonText: 'Aceptar',
            background: 'hsl(222, 47%, 11%)',
            color: 'var(--text-primary)'
          });
        }
      }
    });
  };

  const pedidosActivos = pedidos.filter(p => {
    const est = (p.estado || '').toLowerCase().trim();
    return est !== 'cancelado' && est !== 'cancelled' && est !== 'eliminado' && getStepIndex(p.estado) !== 5;
  });
  const pedidosEntregados = pedidos.filter(p => {
    const est = (p.estado || '').toLowerCase().trim();
    return est !== 'cancelado' && est !== 'cancelled' && est !== 'eliminado' && getStepIndex(p.estado) === 5;
  });

  const groupHistoricalPedidos = (historicalList) => {
    const groups = {};
    historicalList.forEach(pedido => {
      const date = new Date(pedido.fecha_pedido);
      const monthName = date.toLocaleDateString('es-AR', { month: 'long' });
      const year = date.getFullYear();
      const groupKey = `${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`;
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(pedido);
    });
    return groups;
  };

  const historicalGroups = groupHistoricalPedidos(pedidosEntregados);

  const renderPedidoItemsBlock = (pedido, items) => {
    return (
      <>
        {/* 1. Vista en Tabla (Escritorio / Pantallas Grandes) */}
        <div className="details-table-wrapper desktop-only">
          <table className="details-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th style={{ textAlign: 'right' }}>Cant.</th>
                <th style={{ textAlign: 'right' }}>Precio Unit.</th>
                <th style={{ textAlign: 'right' }}>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    No se encontraron ítems en este pedido.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const qtyPrepared = parseFloat(item.cantidad);
                  const qtyReceived = item.cantidad_recibida !== null ? parseFloat(item.cantidad_recibida) : qtyPrepared;
                  const hasDiscrepancy = qtyReceived < qtyPrepared;
                  
                  return (
                    <tr key={item.id} style={hasDiscrepancy ? { background: 'rgba(234, 88, 12, 0.05)' } : undefined}>
                      <td style={{ color: hasDiscrepancy ? '#ea580c' : 'var(--accent)', fontWeight: '600' }}>
                        {item.producto_codigo}
                      </td>
                      <td>
                        {item.producto_descripcion}
                        {hasDiscrepancy && (
                          <div style={{ fontSize: '0.75rem', color: '#f97316', marginTop: '2px' }}>
                            ⚠️ Reclamo: {item.motivo_incidencia} {item.comentarios ? `("${item.comentarios}")` : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: '500', color: hasDiscrepancy ? '#f97316' : 'inherit' }}>
                        {hasDiscrepancy ? `${qtyReceived} de ${qtyPrepared}` : qtyPrepared}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {formatCurrency(item.precio_unitario)}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: '600', color: hasDiscrepancy ? '#f97316' : 'var(--text-primary)' }}>
                        {formatCurrency(item.precio_unitario * qtyReceived)}
                      </td>
                    </tr>
                  );
                })
              )}
              {pedido.iva && parseFloat(pedido.iva) > 0 ? (
                <>
                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <td colSpan="3"></td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)', fontWeight: '500' }}>Subtotal Neto:</td>
                    <td style={{ textAlign: 'right', fontWeight: '600' }}>{formatCurrency(pedido.subtotal)}</td>
                  </tr>
                  {parseFloat(pedido.descuento) > 0 && (
                    <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <td colSpan="3"></td>
                      <td style={{ textAlign: 'right', color: 'var(--danger)', fontWeight: '500' }}>Descuento Neto:</td>
                      <td style={{ textAlign: 'right', fontWeight: '600', color: 'var(--danger)' }}>-{formatCurrency(pedido.descuento)}</td>
                    </tr>
                  )}
                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <td colSpan="3"></td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)', fontWeight: '500' }}>IVA (21%):</td>
                    <td style={{ textAlign: 'right', fontWeight: '600' }}>{formatCurrency(pedido.iva)}</td>
                  </tr>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <td colSpan="3"></td>
                    <td style={{ textAlign: 'right', color: 'var(--text-primary)', fontWeight: '700' }}>Total Final:</td>
                    <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--text-primary)', fontSize: '1.05rem' }}>{formatCurrency(pedido.total)}</td>
                  </tr>
                </>
              ) : (
                <>
                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <td colSpan="3"></td>
                    <td style={{ textAlign: 'right', color: 'var(--text-secondary)', fontWeight: '500' }}>Subtotal:</td>
                    <td style={{ textAlign: 'right', fontWeight: '600' }}>{formatCurrency(pedido.subtotal)}</td>
                  </tr>
                  {parseFloat(pedido.descuento) > 0 && (
                    <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <td colSpan="3"></td>
                      <td style={{ textAlign: 'right', color: 'var(--danger)', fontWeight: '500' }}>Descuento:</td>
                      <td style={{ textAlign: 'right', fontWeight: '600', color: 'var(--danger)' }}>-{formatCurrency(pedido.descuento)}</td>
                    </tr>
                  )}
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <td colSpan="3"></td>
                    <td style={{ textAlign: 'right', color: 'var(--text-primary)', fontWeight: '700' }}>Total Final:</td>
                    <td style={{ textAlign: 'right', fontWeight: '700', color: 'var(--text-primary)', fontSize: '1.05rem' }}>{formatCurrency(pedido.total)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* 2. Vista en Tarjetas Touch-Friendly (Móviles y Tablets) */}
        <div className="mobile-order-items-list">
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
              No se encontraron ítems en este pedido.
            </div>
          ) : (
            items.map((item) => {
              const qtyPrepared = parseFloat(item.cantidad);
              const qtyReceived = item.cantidad_recibida !== null ? parseFloat(item.cantidad_recibida) : qtyPrepared;
              const hasDiscrepancy = qtyReceived < qtyPrepared;

              return (
                <div key={item.id} className="mobile-order-item-card" style={hasDiscrepancy ? { borderColor: 'rgba(234, 88, 12, 0.4)' } : undefined}>
                  <div className="mobile-order-item-header">
                    <span className="mobile-order-item-code">{item.producto_codigo}</span>
                    <span className="mobile-order-item-desc">{item.producto_descripcion}</span>
                  </div>

                  {hasDiscrepancy && (
                    <div style={{ fontSize: '0.74rem', color: '#f97316', background: 'rgba(234, 88, 12, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', marginTop: '2px' }}>
                      ⚠️ Reclamo: {item.motivo_incidencia} {item.comentarios ? `("${item.comentarios}")` : ''}
                    </div>
                  )}

                  <div className="mobile-order-item-meta">
                    <span className="mobile-order-item-qty" style={hasDiscrepancy ? { color: '#f97316', fontWeight: '700' } : undefined}>
                      {hasDiscrepancy ? `${qtyReceived} de ${qtyPrepared} bultos` : `${qtyPrepared} ${qtyPrepared === 1 ? 'bulto' : 'bultos'}`}
                    </span>
                    <div className="mobile-order-item-prices">
                      <span className="mobile-order-item-unit">x {formatCurrency(item.precio_unitario)}</span>
                      <span className="mobile-order-item-subtotal">{formatCurrency(item.precio_unitario * qtyReceived)}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Resumen de Totales en Móvil */}
          <div className="mobile-order-totals-card">
            <div className="mobile-order-totals-row">
              <span>{pedido.iva && parseFloat(pedido.iva) > 0 ? 'Subtotal Neto:' : 'Subtotal:'}</span>
              <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(pedido.subtotal)}</strong>
            </div>

            {parseFloat(pedido.descuento) > 0 && (
              <div className="mobile-order-totals-row" style={{ color: 'var(--danger)' }}>
                <span>Descuento:</span>
                <strong>-{formatCurrency(pedido.descuento)}</strong>
              </div>
            )}

            {pedido.iva && parseFloat(pedido.iva) > 0 && (
              <div className="mobile-order-totals-row">
                <span>IVA (21%):</span>
                <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(pedido.iva)}</strong>
              </div>
            )}

            <div className="mobile-order-totals-row final">
              <span>Total Final:</span>
              <span>{formatCurrency(pedido.total)}</span>
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="pedidos-container">
      {/* BANNER DE PRE-PEDIDOS PENDIENTES DE MOSTRADOR */}
      {prepedidosPendientes.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.18) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1.5px solid #7c3aed',
          borderRadius: '16px',
          padding: '1.25rem',
          marginBottom: '1.5rem',
          boxShadow: '0 10px 30px rgba(124, 58, 237, 0.25)',
          animation: 'fadeIn 0.25s ease-out'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(124, 58, 237, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#c084fc'
              }}>
                <Bell size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#f8fafc' }}>
                  Pre-pedidos de Reposición Recibidos ({prepedidosPendientes.length})
                </h3>
                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.78rem', color: '#cbd5e1' }}>
                  Tu equipo envió listas de faltantes para revisar e incorporar a la orden oficial.
                </p>
              </div>
            </div>
            <button
              onClick={fetchPrepedidos}
              style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Actualizar
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {prepedidosPendientes.map(prep => {
              const items = prep.items || [];
              const totalItemsCount = items.length;
              const totalUnitsCount = items.reduce((acc, i) => acc + (parseInt(i.cantidad, 10) || 0), 0);

              return (
                <div
                  key={prep.id}
                  style={{
                    background: '#090d16',
                    border: '1px solid #1e293b',
                    borderRadius: '12px',
                    padding: '0.85rem 1rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                      <span style={{
                        background: 'rgba(56, 189, 248, 0.15)',
                        color: '#38bdf8',
                        padding: '0.15rem 0.5rem',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        fontWeight: 800
                      }}>
                        👤 {prep.colaborador_nombre || 'Colaborador'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {new Date(prep.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} hs
                      </span>
                    </div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc' }}>
                      {totalItemsCount} artículo{totalItemsCount > 1 ? 's' : ''} ({totalUnitsCount} unidades)
                    </div>
                    {prep.nota_colaborador && (
                      <div style={{ fontSize: '0.78rem', color: '#fbbf24', marginTop: '0.2rem', fontStyle: 'italic' }}>
                        💬 "{prep.nota_colaborador}"
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                      onClick={() => setViewingPrepedido(prep)}
                      style={{
                        background: '#1e293b',
                        color: '#cbd5e1',
                        border: '1px solid #334155',
                        padding: '0.45rem 0.75rem',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem'
                      }}
                    >
                      <Eye size={14} /> Ver Ítems
                    </button>
                    <button
                      onClick={() => handleIncorporarPrepedido(prep)}
                      style={{
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        color: 'white',
                        border: 'none',
                        padding: '0.45rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                      }}
                    >
                      <ShoppingBag size={14} /> Cargar en Mi Pedido
                    </button>
                    <button
                      onClick={() => handleDescartarPrepedido(prep.id)}
                      style={{
                        background: 'none',
                        color: '#94a3b8',
                        border: 'none',
                        padding: '0.45rem',
                        cursor: 'pointer'
                      }}
                      title="Descartar pre-pedido"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* BANNER DE ALERTA: PEDIDOS ACTIVOS EN TRÁMITE */}
      {pedidosActivos.length > 0 && (
        <div className="b2b-pedidos-activos-banner">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'rgba(245, 158, 11, 0.2)',
                border: '1px solid rgba(245, 158, 11, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f59e0b',
                fontSize: '1.2rem',
                flexShrink: 0
              }}>
                ⚠️
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#f8fafc' }}>
                  Tenés {pedidosActivos.length} pedido{pedidosActivos.length > 1 ? 's' : ''} activo{pedidosActivos.length > 1 ? 's' : ''} en trámite
                </h3>
                <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.78rem', color: '#cbd5e1' }}>
                  Revisá si deseás mantenerlos, modificarlos o anularlos para evitar duplicaciones de mercadería.
                </p>
              </div>
            </div>
            <button
              onClick={fetchPedidos}
              style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Actualizar
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            {pedidosActivos.map(ped => {
              const items = ped.clientes_b2b_pedidos_items || [];
              const itemsCount = items.length;
              const isExpanded = expandedPedidoId === ped.id;

              return (
                <div
                  key={ped.id}
                  style={{
                    background: '#090d16',
                    border: '1px solid #1e293b',
                    borderRadius: '12px',
                    padding: '0.85rem 1rem'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem'
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span style={{
                          background: 'rgba(245, 158, 11, 0.15)',
                          color: '#fbbf24',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 800
                        }}>
                          📦 #{ped.id.substring(0, 8).toUpperCase()}
                        </span>
                        <span style={{
                          background: 'rgba(56, 189, 248, 0.15)',
                          color: '#38bdf8',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 700
                        }}>
                          {ped.estado || 'Recibido'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {new Date(ped.fecha_pedido).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} hs
                        </span>
                      </div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f8fafc' }}>
                        {itemsCount} artículo{itemsCount > 1 ? 's' : ''} • Total: {formatCurrency(ped.total)}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => toggleExpand(ped.id)}
                        style={{
                          background: '#1e293b',
                          color: '#cbd5e1',
                          border: '1px solid #334155',
                          padding: '0.45rem 0.7rem',
                          borderRadius: '8px',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}
                      >
                        <Eye size={14} /> {isExpanded ? 'Ocultar Detalle' : 'Ver Detalle'}
                      </button>

                      <button
                        onClick={() => handleEditarPedido(ped)}
                        style={{
                          background: 'rgba(124, 58, 237, 0.2)',
                          color: '#c084fc',
                          border: '1px solid rgba(124, 58, 237, 0.4)',
                          padding: '0.45rem 0.75rem',
                          borderRadius: '8px',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}
                        title="Cargar artículos en el carrito para modificar este pedido"
                      >
                        ✏️ Modificar
                      </button>

                      <button
                        onClick={() => handleAnularPedido(ped.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          padding: '0.45rem 0.75rem',
                          borderRadius: '8px',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}
                        title="Cancelar este pedido para que no se despache"
                      >
                        🗑️ Anular
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid #1e293b' }}>
                      {renderPedidoItemsBlock(ped, items)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {cart.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', animation: 'fadeInUp 0.3s ease-out' }}>
          
          <div className="page-header" style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h1 className="page-title">Revisar Orden</h1>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Paso 2 de 3: Confirme el detalle de los artículos y complete su compra
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <button 
                onClick={() => {
                  setEnlaceGenerado(null);
                  setShowDelegarModal(true);
                }} 
                className="filter-btn"
                style={{
                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                  color: 'white',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)'
                }}
                title="Permitir que un colaborador de tu equipo arme la lista de faltantes de mercadería"
              >
                <Users size={16} />
                <span>Delegar a Empleado</span>
              </button>
            </div>
          </div>

          {pedidosActivos.length > 0 && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '10px',
              padding: '0.65rem 0.95rem',
              fontSize: '0.8rem',
              color: '#fbbf24',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span>ℹ️</span>
              <span>
                <strong>Atención:</strong> Ya tenés <strong>{pedidosActivos.length} pedido(s) activo(s)</strong> en trámite arriba. Si confirmás esta orden, se generará un pedido adicional independiente.
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            
            {/* Tabla de Artículos en Revisión (Izquierda) */}
            <div className="login-card" style={{ flex: '1', minWidth: '320px', padding: '1.75rem', border: '1px solid var(--border-glass)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '1rem' }}>
                <ShoppingBag size={20} style={{ color: 'var(--accent)' }} />
                <h2 style={{ fontSize: '1.15rem', fontWeight: '750' }}>Detalle de Artículos ({cart.length})</h2>
              </div>

              <div className="details-table-wrapper" style={{ border: '1px solid rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                <table className="details-table" style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Descripción</th>
                      <th style={{ textAlign: 'center', width: '120px' }}>Cant.</th>
                      <th style={{ textAlign: 'right' }}>Precio Unit. <span style={{ fontSize: '0.65rem', opacity: 0.8, display: 'block', fontWeight: 'normal' }}>(IVA Incluido)</span></th>
                      <th style={{ textAlign: 'right' }}>Subtotal</th>
                      <th style={{ textAlign: 'center', width: '60px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item) => (
                      <tr key={item.producto_codigo} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', backgroundColor: item.is_kit_item ? 'rgba(16, 185, 129, 0.04)' : 'transparent' }}>
                        <td style={{ color: item.is_kit_item ? '#10b981' : 'var(--accent)', fontWeight: '600', paddingLeft: item.is_kit_item ? '1.25rem' : '0.5rem' }}>
                          {item.is_kit_item && '↳ '}{item.producto_codigo}
                        </td>
                        <td>
                          {item.is_kit_item && <span style={{ color: '#10b981', marginRight: '5px' }}>📦</span>}
                          {item.producto_descripcion}
                          {item.is_kit_item && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginTop: '1px' }}>
                              Insumo de Kit (proporcional a {item.kit_parent})
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {item.is_kit_item ? (
                            <span 
                              style={{ 
                                display: 'inline-block',
                                background: 'rgba(16, 185, 129, 0.12)', 
                                color: '#10b981', 
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                borderRadius: '6px',
                                padding: '0.2rem 0.6rem',
                                fontWeight: '700', 
                                fontSize: '0.82rem' 
                              }}
                              title="Cantidad calculada automáticamente en función del artículo principal"
                            >
                              {item.cantidad}
                            </span>
                          ) : (
                            <div className="quantity-controls" style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.02)', padding: '0.2rem', borderRadius: '6px', border: '1px solid var(--border-glass)' }}>
                              <button 
                                className="qty-btn"
                                onClick={() => addToCart({ producto_codigo: item.producto_codigo, producto_descripcion: item.producto_descripcion, precio_final: item.precio_unitario }, item.cantidad - 1)}
                                style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                              >
                                <Minus size={12} />
                              </button>
                              <span style={{ minWidth: '24px', display: 'inline-block', fontWeight: '600', color: 'var(--text-primary)', fontSize: '0.85rem' }}>{item.cantidad}</span>
                              <button 
                                className="qty-btn"
                                onClick={() => addToCart({ producto_codigo: item.producto_codigo, producto_descripcion: item.producto_descripcion, precio_final: item.precio_unitario }, item.cantidad + 1)}
                                style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(item.precio_unitario)}</td>
                        <td style={{ textAlign: 'right', fontWeight: '600' }}>{formatCurrency(item.subtotal)}</td>
                        <td style={{ textAlign: 'center' }}>
                          {!item.is_kit_item && (
                            <button 
                              onClick={() => removeFromCart(item.producto_codigo)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', transition: 'var(--transition-smooth)' }}
                              title="Quitar artículo y sus kits"
                              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Panel de Control y Confirmación (Derecha) */}
            <div className="login-card" style={{ width: '380px', display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.75rem', border: '1px solid var(--border-glass)', margin: '0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.75rem' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: '750' }}>Resumen de Orden</h3>
              </div>

              {/* Notas de entrega */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label className="form-label" style={{ fontSize: '0.8rem' }}>Observaciones de entrega</label>
                <textarea 
                  placeholder="Ej: Horario de entrega por la mañana, indicaciones para el chofer..."
                  className="form-input"
                  style={{ resize: 'none', height: '72px', padding: '0.5rem', fontSize: '0.85rem' }}
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  disabled={submitting}
                />
              </div>

              {/* Banner dinámico de política comercial */}
              {politicaComercial && (
                <div style={{
                  borderRadius: '10px',
                  padding: '0.75rem 0.95rem',
                  fontSize: '0.82rem',
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
                  gap: '0.6rem'
                }}>
                  <span style={{ fontSize: '1.15rem', lineHeight: '1' }}>
                    {politicaEval.bloqueadoPorSaldo ? '⛔' : (politicaEval.aplica ? '🎉' : '💡')}
                  </span>
                  <div style={{ flex: 1 }}>
                    {politicaEval.bloqueadoPorSaldo ? (
                      <div>
                        <strong style={{ display: 'block', marginBottom: '2px', color: '#f87171' }}>Bonificación por volumen retenida</strong>
                        <div>{politicaEval.mensaje}</div>
                      </div>
                    ) : politicaEval.aplica ? (
                      <div>
                        <strong>¡Bonificación del {politicaEval.porcentaje}% aplicada!</strong> ({politicaEval.etiqueta})
                        {politicaEval.proximoTramo && (
                          <div style={{ fontSize: '0.75rem', marginTop: '3px', opacity: 0.9 }}>
                            ↳ Faltan {formatCurrency(politicaEval.faltaParaProximo)} para el próximo tramo del {politicaEval.proximoPorcentaje}%
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        Faltan <strong>{formatCurrency(politicaEval.faltaParaProximo)}</strong> para alcanzar el <strong>{politicaEval.proximoPorcentaje}% de descuento</strong> por volumen.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Total final y desglose */}
              <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {politicaEval.aplica && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                      <span>Subtotal {politicaEval.aplicaSobre === 'NETO' ? 'Neto' : ''}:</span>
                      <span>{formatCurrency(politicaEval.subtotalBruto)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', color: '#34d399', fontWeight: 600 }}>
                      <span>Bonificación ({politicaEval.porcentaje}%):</span>
                      <span>-{formatCurrency(politicaEval.montoDescuento)}</span>
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '1.05rem', fontWeight: '600', color: 'var(--text-secondary)' }}>Total Estimado <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>(IVA Incluido)</span>:</span>
                  <span style={{ fontSize: '1.6rem', fontWeight: '850', color: politicaEval.aplica ? '#34d399' : 'var(--text-primary)' }}>
                    {formatCurrency(politicaEval.totalEstimado)}
                  </span>
                </div>
              </div>

              {/* Acciones del Paso B */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  onClick={handleCheckout}
                  disabled={submitting}
                  className="btn-primary"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', width: '100%', padding: '0.85rem' }}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="spinner" style={{ width: '18px', height: '18px', borderTopColor: 'var(--text-primary)' }} />
                      <span>Enviando pedido...</span>
                    </>
                  ) : (
                    <span>Confirmar Compra</span>
                  )}
                </button>

                <button
                  onClick={handleClearCartPrompt}
                  disabled={submitting}
                  className="filter-btn"
                  style={{ width: '100%', borderColor: 'var(--danger)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', background: 'rgba(239, 68, 68, 0.03)' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.03)'}
                >
                  <Trash2 size={16} />
                  <span>Eliminar Pedido</span>
                </button>

                <button
                  onClick={() => setCurrentTab('articulos')}
                  disabled={submitting}
                  className="filter-btn"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem' }}
                >
                  <span>Seguir Comprando</span>
                </button>
              </div>
            </div>

          </div>

        </div>
      ) : (
        <>
          <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h1 className="page-title">Mis Pedidos</h1>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Seguimiento de compras y estado de despacho en tiempo real
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
              <button 
                onClick={() => {
                  setEnlaceGenerado(null);
                  setShowDelegarModal(true);
                }} 
                className="filter-btn"
                style={{
                  background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                  color: 'white',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)'
                }}
                title="Permitir que un colaborador de tu equipo arme la lista de faltantes de mercadería"
              >
                <Users size={16} />
                <span>Delegar a Empleado</span>
              </button>
              <button onClick={fetchPedidos} className="filter-btn">
                Actualizar
              </button>
            </div>
          </div>

          {pedidos.length === 0 ? (
            <div className="empty-state">
              <FileText size={48} style={{ color: 'var(--text-muted)' }} />
              <p className="empty-state-title">No hay pedidos registrados</p>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '400px' }}>
                Aún no has realizado pedidos desde el portal. Cuando confirmes un carrito de compras, podrás seguir su estado desde aquí.
              </p>
            </div>
          ) : (
            <>
              {/* Listado de Pedidos Activos */}
              {pedidosActivos.length === 0 ? (
                <div className="empty-state" style={{ padding: '2rem 1.5rem', background: 'rgba(255,255,255,0.01)', border: '1px dashed var(--border-glass)', borderRadius: 'var(--radius-lg)' }}>
                  <Clock size={36} style={{ color: 'var(--text-muted)' }} />
                  <p className="empty-state-title" style={{ fontSize: '1rem', marginTop: '0.5rem' }}>No tienes pedidos activos</p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', maxWidth: '350px', margin: '0 auto' }}>
                    Todos tus pedidos han sido entregados y archivados en el listado histórico inferior.
                  </p>
                </div>
              ) : (
                <div className="pedidos-grid">
                  {pedidosActivos.map((pedido) => {
                    const currentStep = getStepIndex(pedido.estado);
                    const isExpanded = expandedPedidoId === pedido.id;
                    const items = pedido.clientes_b2b_pedidos_items || [];
                    
                    let logisticaLabel = 'Logística';
                    let logisticaSublabel = 'Despacho / Retiro';
                    const rawEstado = (pedido.estado || '').toLowerCase().trim();
                    if (rawEstado === 'en ruta') {
                      logisticaLabel = 'En Reparto';
                      logisticaSublabel = 'Asignado a reparto';
                    } else if (rawEstado === 'listo para retirar') {
                      logisticaLabel = 'Listo para Retirar';
                      logisticaSublabel = 'En depósito local';
                    }

                    return (
                      <div key={pedido.id} className="pedido-card">
                        {/* Cabecera de la Tarjeta */}
                        <div className="pedido-header">
                          <div className="pedido-info-main">
                            <span className="pedido-number">
                              <ClipboardList size={18} style={{ color: 'var(--accent)' }} />
                              Pedido: #{pedido.id.substring(0, 8).toUpperCase()}
                            </span>
                            <span className="pedido-date">
                              Fecha: {new Date(pedido.fecha_pedido).toLocaleDateString('es-AR', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          </div>
                          
                          <div className="pedido-totals">
                            <div className="pedido-total-amount">
                              Total: {formatCurrency(pedido.total)}
                            </div>
                            <span className={`badge-status ${
                              currentStep === 5 ? 'entregado' : 
                              currentStep === 4 ? 'logistica' : 
                              currentStep === 3 ? 'listo' : 
                              currentStep === 2 ? 'proceso' : 'pendiente'
                            }`}>
                              {pedido.estado || 'Recibido'}
                            </span>
                          </div>
                        </div>

                        {/* Stepper de 5 Pasos */}
                        <div className="stepper-container">
                          <div className="stepper-progress-bar">
                            <div 
                              className="stepper-progress-line"
                              style={{ 
                                width: `${((currentStep - 1) / 4) * 100}%`
                              }}
                            />
                          </div>

                          {stepsConfig.map((step, idx) => {
                            const stepNum = idx + 1;
                            const isCompleted = stepNum < currentStep;
                            const isActive = stepNum === currentStep;
                            
                            const StepIcon = step.icon;
                            const label = stepNum === 4 ? logisticaLabel : step.label;
                            const sublabel = stepNum === 4 ? logisticaSublabel : step.sublabel;

                            return (
                              <div 
                                key={idx} 
                                className={`step-item ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}`}
                              >
                                <div className="step-icon-wrapper">
                                  <StepIcon size={18} />
                                </div>
                                <span className="step-label">{label}</span>
                                <span className="step-sublabel">{sublabel}</span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Acciones y Detalle */}
                        <div className="pedido-action-bar" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                          <button 
                            onClick={() => toggleExpand(pedido.id)} 
                            className="btn-toggle-details"
                          >
                            <span>{isExpanded ? 'Ocultar Detalle' : 'Ver Detalle'}</span>
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                          
                          {(!pedido.facturado && (pedido.estado || '').toLowerCase().trim() !== 'cancelado') && (
                            <>
                              <button 
                                onClick={() => handleEditarPedido(pedido)}
                                className="filter-btn"
                                style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid var(--border-glass)', cursor: 'pointer', transition: 'all 0.2s' }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                              >
                                ✏️ Editar Pedido
                              </button>
                              <button 
                                onClick={() => handleAnularPedido(pedido.id)}
                                className="filter-btn"
                                style={{ padding: '0.45rem 0.85rem', fontSize: '0.8rem', borderColor: 'var(--danger)', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(239, 68, 68, 0.02)', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.02)'}
                              >
                                🗑️ Eliminar/Anular
                              </button>
                            </>
                          )}
                        </div>

                        {isExpanded && (
                          <div className="pedido-details">
                            {renderPedidoItemsBlock(pedido, items)}
                            {pedido.observaciones && (
                              <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: '0.25rem' }}>Observaciones del Cliente:</span>
                                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', margin: 0 }}>{pedido.observaciones}</p>
                              </div>
                            )}

                            {(pedido.entregado_chofer_nombre || pedido.recibido_por_nombre || pedido.estado === 'Reclamado') && (
                              <div style={{ marginTop: '1.2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {/* 🚚 Datos de Despacho Logístico (Chofer) */}
                                {(pedido.entregado_chofer_nombre || pedido.recibido_por_nombre === 'Chofer (QR)') && (
                                  <div style={{ 
                                    padding: '1rem', 
                                    background: 'rgba(59, 130, 246, 0.06)', 
                                    borderRadius: 'var(--radius-md)', 
                                    border: '1px solid rgba(59, 130, 246, 0.2)' 
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.4rem' }}>
                                      <Truck size={18} style={{ color: '#60a5fa' }} />
                                      <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#60a5fa', textTransform: 'uppercase' }}>🚚 Datos de Despacho Logístico:</span>
                                    </div>
                                    <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                                      <p style={{ margin: '2px 0' }}>
                                        Chofer: <strong>{pedido.entregado_chofer_nombre || 'Chofer (QR)'}</strong>
                                      </p>
                                      <p style={{ margin: '2px 0' }}>
                                        Fecha de descarga: <strong>{new Date(pedido.entregado_chofer_fecha || pedido.recibido_fecha).toLocaleString('es-AR')}</strong>
                                      </p>
                                    </div>
                                  </div>
                                )}

                                {/* 🏢 Datos de Recepción Comercial (Cliente) */}
                                {(pedido.recibido_por_nombre && pedido.recibido_por_nombre !== 'Chofer (QR)' || pedido.estado === 'Reclamado') && (
                                  <div style={{ 
                                    padding: '1rem', 
                                    background: pedido.estado === 'Reclamado' ? 'rgba(234, 88, 12, 0.08)' : 'rgba(16, 185, 129, 0.08)', 
                                    borderRadius: 'var(--radius-md)', 
                                    border: pedido.estado === 'Reclamado' ? '1px solid rgba(234, 88, 12, 0.25)' : '1px solid rgba(16, 185, 129, 0.25)' 
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.4rem' }}>
                                      {pedido.estado === 'Reclamado' ? (
                                        <AlertTriangle size={18} style={{ color: '#f97316' }} />
                                      ) : (
                                        <CheckCircle2 size={18} style={{ color: '#34d399' }} />
                                      )}
                                      <span style={{ 
                                        fontSize: '0.85rem', 
                                        fontWeight: 'bold', 
                                        color: pedido.estado === 'Reclamado' ? '#f97316' : '#34d399', 
                                        textTransform: 'uppercase' 
                                      }}>
                                        {pedido.estado === 'Reclamado' ? '🏢 Reporte de Recepción / Reclamo de Depósito:' : '🏢 Conformidad de Recepción Comercial:'}
                                      </span>
                                    </div>
                                    <div style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                                      <p style={{ margin: '2px 0' }}>
                                        Recibido por: <strong>{pedido.recibido_por_nombre || 'Cliente'} {pedido.recibido_por_apellido || ''}</strong> 
                                        {pedido.recibido_por_telefono && ` (Cel: ${pedido.recibido_por_telefono})`}
                                      </p>
                                      <p style={{ margin: '2px 0' }}>
                                        Fecha de auditoría: <strong>{new Date(pedido.recibido_fecha || pedido.reclamado_fecha).toLocaleString('es-AR')}</strong>
                                      </p>
                                      {pedido.comentarios_recepcion && (
                                        <p style={{ margin: '8px 0 0 0', background: 'rgba(0,0,0,0.15)', padding: '8px', borderRadius: '6px', fontStyle: 'italic' }}>
                                          Comentario: "{pedido.comentarios_recepcion}"
                                        </p>
                                      )}
                                      
                                      {(pedido.foto_reclamo_1 || pedido.foto_reclamo_2) && (
                                        <div style={{ marginTop: '10px' }}>
                                          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>Evidencia Fotográfica:</span>
                                          <div style={{ display: 'flex', gap: '10px' }}>
                                            {pedido.foto_reclamo_1 && (
                                              <a href={pedido.foto_reclamo_1} target="_blank" rel="noopener noreferrer">
                                                <img src={pedido.foto_reclamo_1} alt="Evidencia 1" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }} />
                                              </a>
                                            )}
                                            {pedido.foto_reclamo_2 && (
                                              <a href={pedido.foto_reclamo_2} target="_blank" rel="noopener noreferrer">
                                                <img src={pedido.foto_reclamo_2} alt="Evidencia 2" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }} />
                                              </a>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Acordeón de Pedidos Históricos (Entregados) */}
              {pedidosEntregados.length > 0 && (
                <div className="historical-accordion-container" style={{ marginTop: '2.5rem' }}>
                  <button 
                    onClick={() => setIsHistoryOpen(!isHistoryOpen)} 
                    className="historical-accordion-header"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      width: '100%',
                      padding: '1.15rem 1.5rem',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--border-glass)',
                      borderRadius: 'var(--radius-lg)',
                      color: 'var(--text-primary)',
                      fontWeight: '600',
                      fontSize: '0.95rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
                      <span>Pedidos Históricos (Entregados) ({pedidosEntregados.length})</span>
                    </div>
                    {isHistoryOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>

                  {isHistoryOpen && (
                    <div className="historical-months-list" style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {Object.entries(historicalGroups).map(([monthKey, monthPedidos]) => {
                        const isMonthOpen = openMonthKey === monthKey;
                        return (
                          <div 
                            key={monthKey} 
                            className="historical-month-group" 
                            style={{
                              border: '1px solid var(--border-glass)',
                              borderRadius: 'var(--radius-md)',
                              overflow: 'hidden',
                              background: 'rgba(255, 255, 255, 0.01)'
                            }}
                          >
                            <button
                              onClick={() => setOpenMonthKey(isMonthOpen ? null : monthKey)}
                              className="historical-month-header"
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                width: '100%',
                                padding: '0.85rem 1.25rem',
                                background: 'rgba(255, 255, 255, 0.02)',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                fontWeight: '550',
                                fontSize: '0.85rem',
                                cursor: 'pointer'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Calendar size={14} style={{ color: 'var(--text-muted)' }} />
                                <span>{monthKey} ({monthPedidos.length} {monthPedidos.length === 1 ? 'pedido' : 'pedidos'})</span>
                              </div>
                              {isMonthOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>

                            {isMonthOpen && (
                              <div 
                                className="historical-month-content" 
                                style={{ 
                                  padding: '1rem', 
                                  display: 'flex', 
                                  flexDirection: 'column', 
                                  gap: '1rem',
                                  background: 'rgba(0,0,0,0.15)'
                                }}
                              >
                                {monthPedidos.map((pedido) => {
                                  const isExpanded = expandedPedidoId === pedido.id;
                                  const items = pedido.clientes_b2b_pedidos_items || [];
                                  return (
                                    <div key={pedido.id} className="pedido-card historical-card" style={{ margin: 0, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
                                      <div className="pedido-header" style={{ paddingBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                        <div className="pedido-info-main">
                                          <span className="pedido-number" style={{ fontSize: '0.85rem' }}>
                                            <ClipboardList size={16} style={{ color: 'var(--text-muted)' }} />
                                            Pedido: #{pedido.id.substring(0, 8).toUpperCase()}
                                          </span>
                                          <span className="pedido-date" style={{ fontSize: '0.8rem' }}>
                                            Fecha: {new Date(pedido.fecha_pedido).toLocaleDateString('es-AR')}
                                          </span>
                                        </div>
                                        <div className="pedido-totals">
                                          <div className="pedido-total-amount" style={{ fontSize: '0.9rem' }}>
                                            Total: {formatCurrency(pedido.total)}
                                          </div>
                                          <span className={`badge-status ${(pedido.estado || '').toLowerCase()}`} style={{ 
                                             fontSize: '0.7rem', 
                                             padding: '0.15rem 0.5rem', 
                                             background: (pedido.estado === 'Cancelado' || pedido.estado === 'CANCELLED' || pedido.estado === 'Eliminado') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', 
                                             color: (pedido.estado === 'Cancelado' || pedido.estado === 'CANCELLED' || pedido.estado === 'Eliminado') ? '#ef4444' : '#10b981', 
                                             border: (pedido.estado === 'Cancelado' || pedido.estado === 'CANCELLED' || pedido.estado === 'Eliminado') ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(16, 185, 129, 0.2)' 
                                           }}>
                                             {(pedido.estado === 'Cancelado' || pedido.estado === 'CANCELLED') ? 'Cancelado' : pedido.estado === 'Eliminado' ? 'Eliminado' : 'Entregado'}
                                           </span>
                                        </div>
                                      </div>

                                      <div className="pedido-action-bar" style={{ padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.01)' }}>
                                        <button 
                                          onClick={() => toggleExpand(pedido.id)} 
                                          className="btn-toggle-details"
                                          style={{ fontSize: '0.8rem' }}
                                        >
                                          <span>{isExpanded ? 'Ocultar Detalle' : 'Ver Detalle'}</span>
                                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        </button>
                                      </div>

                                      {isExpanded && (
                                        <div className="pedido-details" style={{ padding: '0.75rem', background: 'transparent' }}>
                                          {(pedido.entregado_chofer_nombre || pedido.recibido_por_nombre) && (
                                            <div style={{
                                              display: 'flex',
                                              flexDirection: 'column',
                                              gap: '8px',
                                              marginBottom: '12px',
                                              fontSize: '0.8rem',
                                              boxSizing: 'border-box'
                                            }}>
                                              {/* Hito Chofer */}
                                              {(pedido.entregado_chofer_nombre || pedido.recibido_por_nombre === 'Chofer (QR)') && (
                                                <div style={{
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: '8px',
                                                  background: 'rgba(59, 130, 246, 0.06)',
                                                  border: '1px solid rgba(59, 130, 246, 0.15)',
                                                  borderRadius: '6px',
                                                  padding: '8px 10px',
                                                  color: '#93c5fd'
                                                }}>
                                                  <span>🚚</span>
                                                  <span>
                                                    Despacho: <strong>{pedido.entregado_chofer_nombre || 'Chofer (QR)'}</strong> el {new Date(pedido.entregado_chofer_fecha || pedido.recibido_fecha).toLocaleString('es-AR')}
                                                  </span>
                                                </div>
                                              )}

                                              {/* Hito Cliente */}
                                              {(pedido.recibido_por_nombre && pedido.recibido_por_nombre !== 'Chofer (QR)') && (
                                                <div style={{
                                                  display: 'flex',
                                                  alignItems: 'center',
                                                  gap: '8px',
                                                  background: pedido.estado === 'Reclamado' ? 'rgba(234, 88, 12, 0.06)' : 'rgba(16, 185, 129, 0.06)',
                                                  border: pedido.estado === 'Reclamado' ? '1px solid rgba(234, 88, 12, 0.15)' : '1px solid rgba(16, 185, 129, 0.15)',
                                                  borderRadius: '6px',
                                                  padding: '8px 10px',
                                                  color: pedido.estado === 'Reclamado' ? '#fed7aa' : '#a7f3d0'
                                                }}>
                                                  <span>{pedido.estado === 'Reclamado' ? '⚠️' : '🟢'}</span>
                                                  <span>
                                                    Recepción: <strong>{pedido.recibido_por_nombre} {pedido.recibido_por_apellido || ''}</strong>
                                                    {pedido.recibido_por_telefono && ` (Cel: ${pedido.recibido_por_telefono})`}
                                                    {pedido.recibido_fecha && ` el ${new Date(pedido.recibido_fecha).toLocaleString('es-AR')}`}
                                                  </span>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                          {renderPedidoItemsBlock(pedido, items)}
                                          {pedido.observaciones && (
                                            <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.01)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)', fontSize: '0.8rem' }}>
                                              <span style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>Observaciones:</span> {pedido.observaciones}
                                            </div>
                                          )}
                                        </div>
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
              )}
            </>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DELEGAR ARMADO A EMPLEADO (MOSTRADOR / REPOSICIÓN)                 */}
      {/* ========================================================================= */}
      {showDelegarModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          zIndex: 1050,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '520px',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '1.5rem',
            boxShadow: '0 25px 50px rgba(0,0,0,0.8)',
            color: '#f8fafc'
          }}>
            {/* Encabezado */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid #1e293b', paddingBottom: '0.85rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(124, 58, 237, 0.2)', color: '#c084fc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Users size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900 }}>
                    Delegar Armado a Empleado
                  </h3>
                  <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                    Modo Colaborador / Reposición de Faltantes
                  </span>
                </div>
              </div>
              <button
                onClick={() => { setShowDelegarModal(false); setEnlaceGenerado(null); }}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Explicación amigable */}
            <div style={{ background: 'rgba(124, 58, 237, 0.08)', border: '1px solid rgba(124, 58, 237, 0.25)', borderRadius: '12px', padding: '0.85rem', fontSize: '0.82rem', color: '#cbd5e1', lineHeight: 1.45, marginBottom: '1.25rem' }}>
              🛡️ <strong>Privacidad Blindada:</strong> Tu colaborador ingresa desde su teléfono <strong>sin contraseña</strong>. Únicamente seleccionará los artículos y cantidades de mercadería que falte reponer. <strong>No tendrá acceso a cuenta corriente, deudas, ni facturación</strong>, y la orden final siempre requerirá tu confirmación.
            </div>

            {!enlaceGenerado ? (
              <>
                {/* Formulario de Configuración */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem', marginBottom: '1.5rem' }}>
                  {/* Nombre Colaborador */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.35rem' }}>
                      👤 Nombre o Sector del Empleado / Repositor:
                    </label>
                    <input
                      type="text"
                      value={colaboradorNombre}
                      onChange={(e) => setColaboradorNombre(e.target.value)}
                      placeholder="Ej: Mostrador, Depósito Central, Repositor o nombre propio"
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        background: '#090d16',
                        border: '1px solid #334155',
                        borderRadius: '10px',
                        padding: '0.65rem 0.85rem',
                        color: 'white',
                        fontSize: '0.88rem',
                        outline: 'none'
                      }}
                    />
                  </div>

                  {/* Switch: Visibilidad de Precios */}
                  <div style={{
                    background: '#090d16',
                    border: '1px solid #1e293b',
                    borderRadius: '12px',
                    padding: '0.85rem 1rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f8fafc' }}>
                          Ocultar Precios al Empleado
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                          {mostrarPrecios 
                            ? '⚠️ El empleado verá los precios asignados al comercio.'
                            : '✅ Recomendado: Solo verá nombres, fotos y cantidades físicas.'}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={!mostrarPrecios}
                        onChange={(e) => setMostrarPrecios(!e.target.checked)}
                        style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#7c3aed' }}
                      />
                    </div>

                    {/* Sub-opción: Modalidad con o sin IVA si los precios son visibles */}
                    {mostrarPrecios && (
                      <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid #1e293b' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.45rem' }}>
                          Modalidad de Precios para el Colaborador:
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <label style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                            background: !mostrarSinIvaDelegacion ? 'rgba(124, 58, 237, 0.15)' : '#0f172a',
                            border: !mostrarSinIvaDelegacion ? '1.5px solid #7c3aed' : '1px solid #1e293b',
                            borderRadius: '8px',
                            padding: '0.5rem 0.65rem',
                            cursor: 'pointer',
                            fontSize: '0.76rem',
                            color: '#f8fafc'
                          }}>
                            <input
                              type="radio"
                              name="modalidadIvaDelegacion"
                              checked={!mostrarSinIvaDelegacion}
                              onChange={() => setMostrarSinIvaDelegacion(false)}
                              style={{ accentColor: '#7c3aed' }}
                            />
                            <span>Con IVA (Final)</span>
                          </label>

                          <label style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                            background: mostrarSinIvaDelegacion ? 'rgba(124, 58, 237, 0.15)' : '#0f172a',
                            border: mostrarSinIvaDelegacion ? '1.5px solid #7c3aed' : '1px solid #1e293b',
                            borderRadius: '8px',
                            padding: '0.5rem 0.65rem',
                            cursor: 'pointer',
                            fontSize: '0.76rem',
                            color: '#f8fafc'
                          }}>
                            <input
                              type="radio"
                              name="modalidadIvaDelegacion"
                              checked={mostrarSinIvaDelegacion}
                              onChange={() => setMostrarSinIvaDelegacion(true)}
                              style={{ accentColor: '#7c3aed' }}
                            />
                            <span>Sin IVA (Neto)</span>
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Selector: Tipo de Enlace */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.45rem' }}>
                      ⏳ Vigencia del Enlace:
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.65rem',
                        background: tipoEnlace === 'permanente' ? 'rgba(124, 58, 237, 0.12)' : '#090d16',
                        border: tipoEnlace === 'permanente' ? '1.5px solid #7c3aed' : '1px solid #1e293b',
                        borderRadius: '10px',
                        padding: '0.75rem',
                        cursor: 'pointer'
                      }}>
                        <input
                          type="radio"
                          name="tipoEnlace"
                          value="permanente"
                          checked={tipoEnlace === 'permanente'}
                          onChange={() => setTipoEnlace('permanente')}
                          style={{ marginTop: '0.2rem', accentColor: '#7c3aed' }}
                        />
                        <div>
                          <strong style={{ fontSize: '0.85rem', color: '#f8fafc', display: 'block' }}>
                            📌 Enlace Fijo Permanente del Local
                          </strong>
                          <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                            Para tenerlo en favoritos de WhatsApp o imprimir el código QR en el local. Sirve para múltiples reposiciones.
                          </span>
                        </div>
                      </label>

                      <label style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.65rem',
                        background: tipoEnlace === 'unico' ? 'rgba(124, 58, 237, 0.12)' : '#090d16',
                        border: tipoEnlace === 'unico' ? '1.5px solid #7c3aed' : '1px solid #1e293b',
                        borderRadius: '10px',
                        padding: '0.75rem',
                        cursor: 'pointer'
                      }}>
                        <input
                          type="radio"
                          name="tipoEnlace"
                          value="unico"
                          checked={tipoEnlace === 'unico'}
                          onChange={() => setTipoEnlace('unico')}
                          style={{ marginTop: '0.2rem', accentColor: '#7c3aed' }}
                        />
                        <div>
                          <strong style={{ fontSize: '0.85rem', color: '#f8fafc', display: 'block' }}>
                            ⏱️ Enlace de Un Solo Uso
                          </strong>
                          <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                            Expira automáticamente en cuanto el empleado envíe la lista de faltantes de este pedido.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleCrearDelegacion}
                  disabled={generandoEnlace}
                  style={{
                    width: '100%',
                    background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                    color: 'white',
                    border: 'none',
                    padding: '0.85rem',
                    borderRadius: '12px',
                    fontWeight: 800,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 15px rgba(124, 58, 237, 0.4)'
                  }}
                >
                  {generandoEnlace ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>Generando enlace...</span>
                    </>
                  ) : (
                    <>
                      <Share2 size={18} />
                      <span>Generar Enlace de Reposición</span>
                    </>
                  )}
                </button>
              </>
            ) : (
              /* ENLACE GENERADO CON ÉXITO */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', animation: 'fadeIn 0.2s ease-out' }}>
                <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', color: '#34d399', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem' }}>
                    <CheckCircle2 size={28} />
                  </div>
                  <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 900, color: '#f8fafc' }}>
                    ¡Enlace de reposición listo!
                  </h4>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                    Compartíselo a tu colaborador por WhatsApp o mostrale el código QR para que arme la lista.
                  </p>
                </div>

                <div style={{
                  background: '#090d16',
                  border: '1px solid #334155',
                  borderRadius: '10px',
                  padding: '0.75rem',
                  fontSize: '0.78rem',
                  fontFamily: 'monospace',
                  color: '#c084fc',
                  wordBreak: 'break-all',
                  userSelect: 'all'
                }}>
                  {enlaceGenerado.url}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {/* Compartir WhatsApp */}
                  <a
                    href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                      `Hola! Te comparto el enlace para armar la lista de faltantes de mercadería: ${enlaceGenerado.url}`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      background: '#25D366',
                      color: 'white',
                      textDecoration: 'none',
                      padding: '0.75rem',
                      borderRadius: '10px',
                      fontWeight: 800,
                      fontSize: '0.88rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 4px 15px rgba(37, 211, 102, 0.35)'
                    }}
                  >
                    <Send size={16} />
                    <span>Enviar por WhatsApp</span>
                  </a>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(enlaceGenerado.url);
                        Swal.fire({
                          title: '¡Enlace Copiado!',
                          text: 'El enlace se copió al portapapeles.',
                          icon: 'success',
                          timer: 1500,
                          showConfirmButton: false
                        });
                      }}
                      style={{
                        flex: 1,
                        background: '#1e293b',
                        color: '#f8fafc',
                        border: '1px solid #334155',
                        padding: '0.65rem',
                        borderRadius: '10px',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem'
                      }}
                    >
                      <Copy size={15} /> Copiar Link
                    </button>

                    <button
                      onClick={() => setShowQrModal(true)}
                      style={{
                        flex: 1,
                        background: '#1e293b',
                        color: '#c084fc',
                        border: '1px solid rgba(124, 58, 237, 0.4)',
                        padding: '0.65rem',
                        borderRadius: '10px',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem'
                      }}
                    >
                      <QrCode size={15} /> Ver QR
                    </button>
                  </div>

                  <button
                    onClick={() => setEnlaceGenerado(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      marginTop: '0.5rem',
                      textDecoration: 'underline'
                    }}
                  >
                    + Crear otro enlace para otro empleado
                  </button>
                </div>
              </div>
            )}

            {/* Lista de Enlaces Activos */}
            {activeDelegaciones.length > 0 && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid #1e293b', paddingTop: '1rem' }}>
                <h4 style={{ margin: '0 0 0.65rem 0', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>
                  Enlaces Activos ({activeDelegaciones.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '160px', overflowY: 'auto' }}>
                  {activeDelegaciones.map(del => (
                    <div
                      key={del.id}
                      style={{
                        background: '#090d16',
                        border: '1px solid #1e293b',
                        borderRadius: '8px',
                        padding: '0.55rem 0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.78rem'
                      }}
                    >
                      <div>
                        <strong style={{ color: '#38bdf8' }}>
                          {del.nombre_colaborador}
                        </strong>
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                          {del.tipo_enlace === 'permanente' ? '📌 Permanente' : '⏱️ Un solo uso'} • {del.mostrar_precios ? (del.mostrar_sin_iva ? 'Con precios (s/IVA)' : 'Con precios (c/IVA)') : 'Sin precios'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <button
                          onClick={() => handleRevocarDelegacion(del.id)}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            color: '#f87171',
                            padding: '0.3rem 0.6rem',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.3rem'
                          }}
                          title="Dar de baja y quitar del listado"
                        >
                          <Trash2 size={12} />
                          <span>Eliminar</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CÓDIGO QR DE MOSTRADOR                                             */}
      {/* ========================================================================= */}
      {showQrModal && enlaceGenerado && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          zIndex: 1100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '20px',
            padding: '1.75rem',
            maxWidth: '380px',
            textAlign: 'center',
            boxShadow: '0 25px 50px rgba(0,0,0,0.8)',
            color: '#f8fafc'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 900 }}>
                📱 Código QR de Reposición
              </h3>
              <button
                onClick={() => setShowQrModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 1.25rem 0' }}>
              Escaneá este código directamente con la cámara del celular para abrir la lista de reposición.
            </p>
            <div style={{ background: 'white', padding: '1rem', borderRadius: '12px', display: 'inline-block', marginBottom: '1.25rem' }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(enlaceGenerado.url)}`}
                alt="QR Reposición"
                style={{ display: 'block', width: '200px', height: '200px' }}
              />
            </div>
            {enlaceGenerado.colaborador && enlaceGenerado.colaborador !== 'Colaborador' && (
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#c084fc', marginBottom: '1rem' }}>
                👤 {enlaceGenerado.colaborador}
              </div>
            )}
            <button
              onClick={() => setShowQrModal(false)}
              style={{
                width: '100%',
                background: '#334155',
                color: 'white',
                border: 'none',
                padding: '0.65rem',
                borderRadius: '8px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DETALLE DE PRE-PEDIDO (VER ÍTEMS ANTES DE INCORPORAR)              */}
      {/* ========================================================================= */}
      {viewingPrepedido && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          zIndex: 1050,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem'
        }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '480px',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '1.5rem',
            boxShadow: '0 25px 50px rgba(0,0,0,0.8)',
            color: '#f8fafc'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 900 }}>
                  📋 Lista cargada por {viewingPrepedido.colaborador_nombre}
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  {new Date(viewingPrepedido.created_at).toLocaleString('es-AR')}
                </span>
              </div>
              <button
                onClick={() => setViewingPrepedido(null)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {viewingPrepedido.nota_colaborador && (
              <div style={{
                background: 'rgba(251, 191, 36, 0.1)',
                border: '1px solid rgba(251, 191, 36, 0.3)',
                borderRadius: '10px',
                padding: '0.75rem',
                fontSize: '0.82rem',
                color: '#fde68a',
                marginBottom: '1rem'
              }}>
                💬 <strong>Nota del colaborador:</strong> "{viewingPrepedido.nota_colaborador}"
              </div>
            )}

            <div style={{
              background: '#090d16',
              border: '1px solid #1e293b',
              borderRadius: '12px',
              maxHeight: '260px',
              overflowY: 'auto',
              padding: '0.5rem 0.75rem',
              marginBottom: '1.25rem'
            }}>
              {(viewingPrepedido.items || []).map((it, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.45rem 0',
                    borderBottom: '1px dashed rgba(255,255,255,0.06)',
                    fontSize: '0.82rem'
                  }}
                >
                  <div style={{ flex: 1, paddingRight: '0.5rem' }}>
                    <div style={{ color: '#f8fafc', fontWeight: 600 }}>{it.producto_descripcion}</div>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Cód: {it.producto_codigo}</span>
                  </div>
                  <div style={{ color: '#34d399', fontWeight: 900, whiteSpace: 'nowrap' }}>
                    x {it.cantidad}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => handleDescartarPrepedido(viewingPrepedido.id)}
                style={{
                  flex: 1,
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  padding: '0.75rem',
                  borderRadius: '10px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer'
                }}
              >
                🗑️ Descartar
              </button>
              <button
                onClick={() => handleIncorporarPrepedido(viewingPrepedido)}
                style={{
                  flex: 2,
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '0.75rem',
                  borderRadius: '10px',
                  fontWeight: 900,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  boxShadow: '0 4px 15px rgba(16, 185, 129, 0.35)'
                }}
              >
                <ShoppingBag size={16} />
                <span>Cargar en Mi Pedido</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
