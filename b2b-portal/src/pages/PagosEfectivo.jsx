import React, { useState, useEffect } from 'react';
import { 
  Banknote, 
  DollarSign, 
  PackageCheck, 
  Camera, 
  Truck, 
  Store, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight, 
  ArrowLeft, 
  Upload, 
  Eye, 
  Trash2, 
  FileText, 
  MessageSquare, 
  Plus, 
  Minus, 
  HelpCircle,
  RefreshCw,
  Loader2,
  Receipt,
  Filter,
  Users,
  Share2,
  Copy,
  ExternalLink,
  Mail
} from 'lucide-react';
import Swal from 'sweetalert2';
import { supabase } from '../supabaseClient';
import { registrarAccesoTelemetria } from '../utils/telemetria';

// Denominaciones oficiales de billetes en Argentina
const DENOMINACIONES_BILLETES = [
  { valor: 20000, label: '$ 20.000', subtitulo: 'Alberdi', color: '#1e3a8a' },
  { valor: 10000, label: '$ 10.000', subtitulo: 'Belgrano / Remedios', color: '#0369a1' },
  { valor: 2000,  label: '$ 2.000',  subtitulo: 'Carrillo / Grierson', color: '#7e22ce' },
  { valor: 1000,  label: '$ 1.000',  subtitulo: 'Hornero / San Martín', color: '#c2410c' },
  { valor: 500,   label: '$ 500',    subtitulo: 'Yaguareté', color: '#047857' },
  { valor: 200,   label: '$ 200',    subtitulo: 'Ballena franca', color: '#0f766e' },
  { valor: 100,   label: '$ 100',    subtitulo: 'Roca / Evita / Taruca', color: '#be123c' },
  { valor: 50,    label: '$ 50',     subtitulo: 'Cóndor / Malvinas', color: '#4338ca' },
  { valor: 20,    label: '$ 20',     subtitulo: 'Guanaco', color: '#854d0e' },
  { valor: 10,    label: '$ 10',     subtitulo: 'Manuel Belgrano', color: '#374151' }
];

const WHATSAPP_EMPRESA = '5492216615746';
const DRAFT_STORAGE_KEY = 'lamda_b2b_sobre_draft_v1';

const leerBorradorSobre = () => {
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
};

export default function PagosEfectivo({ profile, onNavigateToCC, onNavigateToHome }) {
  const borradorInicial = leerBorradorSobre();

  const [activeTab, setActiveTab] = useState('nuevo'); // 'nuevo' | 'historial'
  const [step, setStep] = useState(borradorInicial?.step || 1); // 1: Monto, 2: Billetes, 3: Ensobrado, 4: Fotos y Envío
  
  // Datos del Cliente y Saldo
  const [saldoActual, setSaldoActual] = useState(0);
  const [loadingSaldo, setLoadingSaldo] = useState(true);
  
  // Estado del Formulario (hidratado desde sessionStorage para no perder el código al abrir cámara en móvil)
  const [montoDeclarado, setMontoDeclarado] = useState(borradorInicial?.montoDeclarado || '');
  const [cantidadesBilletes, setCantidadesBilletes] = useState(borradorInicial?.cantidadesBilletes || {});
  const [codigoSobre, setCodigoSobre] = useState(() => {
    if (borradorInicial?.codigoSobre) return borradorInicial.codigoSobre;
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `SOB-${randomNum}`;
  });
  const [confirmEnsobrado, setConfirmEnsobrado] = useState(borradorInicial?.confirmEnsobrado || false);
  const [modalidadEntrega, setModalidadEntrega] = useState(borradorInicial?.modalidadEntrega || 'CHOFER'); // 'CHOFER' | 'LOCAL'
  const [observaciones, setObservaciones] = useState(borradorInicial?.observaciones || '');
  
  // Fotos
  const [fotoFrente, setFotoFrente] = useState(null);
  const [fotoFrentePreview, setFotoFrentePreview] = useState(null);
  const [fotoDorso, setFotoDorso] = useState(null);
  const [fotoDorsoPreview, setFotoDorsoPreview] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  
  // Historial de Sobres
  const [sobres, setSobres] = useState([]);
  const [loadingSobres, setLoadingSobres] = useState(false);
  const [mostrarCancelados, setMostrarCancelados] = useState(false);

  // Persistir borrador y código de sobre en sessionStorage para que nunca cambie a mitad de carga
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        step,
        montoDeclarado,
        cantidadesBilletes,
        codigoSobre,
        confirmEnsobrado,
        modalidadEntrega,
        observaciones
      }));
    } catch (e) {
      // Ignore storage errors
    }
  }, [step, montoDeclarado, cantidadesBilletes, codigoSobre, confirmEnsobrado, modalidadEntrega, observaciones]);

  useEffect(() => {
    fetchSaldoCuentaCorriente();
    fetchHistorialSobres();
    
    const clientIdent = profile?.nombre_empresa || profile?.nombre_completo || profile?.email || (profile?.cliente_id ? `Cliente ${profile.cliente_id}` : null);
    registrarAccesoTelemetria('Gestión de Pagos en Efectivo', clientIdent);
  }, [profile?.cliente_id]);

  const generarNuevoCodigoSobre = () => {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const code = `SOB-${randomNum}`;
    setCodigoSobre(code);
    return code;
  };

  const fetchSaldoCuentaCorriente = async () => {
    if (!profile?.cliente_id) {
      setLoadingSaldo(false);
      return;
    }
    try {
      setLoadingSaldo(true);
      const { data, error } = await supabase
        .from('clientes_b2b_cuentas_corrientes')
        .select('saldo')
        .eq('cliente_id', profile.cliente_id)
        .order('created_at', { ascending: false })
        .order('local_movimiento_id', { ascending: false })
        .limit(1);

      if (error) throw error;
      if (data && data.length > 0) {
        setSaldoActual(parseFloat(data[0].saldo) || 0);
      } else {
        setSaldoActual(0);
      }
    } catch (err) {
      console.error('Error al cargar saldo de cuenta corriente:', err.message);
    } finally {
      setLoadingSaldo(false);
    }
  };

  const fetchHistorialSobres = async () => {
    if (!profile?.cliente_id) return;
    try {
      setLoadingSobres(true);
      const { data, error } = await supabase
        .from('clientes_b2b_pagos_efectivo')
        .select('*')
        .eq('cliente_id', profile.cliente_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSobres(data || []);
    } catch (err) {
      console.error('Error al cargar historial de sobres:', err.message);
    } finally {
      setLoadingSobres(false);
    }
  };

  // Cálculo del total contado por billetes
  const calcularTotalBilletes = () => {
    return DENOMINACIONES_BILLETES.reduce((acc, curr) => {
      const cant = parseInt(cantidadesBilletes[curr.valor] || 0, 10);
      return acc + (cant * curr.valor);
    }, 0);
  };

  const totalBilletes = calcularTotalBilletes();
  const montoDeclaradoNum = parseFloat(montoDeclarado) || 0;
  const diferenciaArqueo = totalBilletes - montoDeclaradoNum;
  const arqueoExacto = montoDeclaradoNum > 0 && totalBilletes === montoDeclaradoNum;

  // Manejo de cantidades de billetes con Bloqueo de Exceso
  const handleCantidadChange = (valor, cantidad) => {
    const cantIngresada = Math.max(0, parseInt(cantidad || 0, 10));
    const cantActual = cantidadesBilletes[valor] || 0;
    const subtotalSinEste = totalBilletes - (cantActual * valor);
    const espacioDisponible = montoDeclaradoNum - subtotalSinEste;
    const maxPermitido = Math.floor(Math.max(0, espacioDisponible) / valor);
    const cantFinal = Math.min(cantIngresada, maxPermitido);

    setCantidadesBilletes(prev => ({
      ...prev,
      [valor]: cantFinal
    }));
  };

  const incrementarBillete = (valor) => {
    const actual = cantidadesBilletes[valor] || 0;
    if (totalBilletes + valor > montoDeclaradoNum) {
      return;
    }
    setCantidadesBilletes(prev => ({
      ...prev,
      [valor]: actual + 1
    }));
  };

  const decrementarBillete = (valor) => {
    setCantidadesBilletes(prev => ({
      ...prev,
      [valor]: Math.max(0, (prev[valor] || 0) - 1)
    }));
  };

  // Manejador de selección de fotos
  const handleFotoChange = (tipo, e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      Swal.fire('Formato Inválido', 'Por favor selecciona un archivo de imagen (JPG, PNG).', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      if (tipo === 'frente') {
        setFotoFrente(file);
        setFotoFrentePreview(reader.result);
      } else {
        setFotoDorso(file);
        setFotoDorsoPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Subir imagen a Supabase Storage
  const uploadImageToStorage = async (file, pathSuffix) => {
    const fileExt = file.name.split('.').pop() || 'jpg';
    const fileName = `${profile.cliente_id}/${codigoSobre}_${pathSuffix}_${Date.now()}.${fileExt}`;
    
    const { data, error } = await supabase.storage
      .from('sobres_efectivo')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
      .from('sobres_efectivo')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  };

  // Guardar sobre en Supabase
  const handleFinalizarSobre = async () => {
    if (!fotoFrente || !fotoDorso) {
      Swal.fire('Fotos Obligatorias', 'Debes cargar las fotografías de Frente y Dorso del sobre sellado.', 'warning');
      return;
    }

    try {
      // Control anti-duplicado: verificar si el cliente ya tiene un sobre PREPARADO o reciente con el mismo importe
      const hace12Horas = Date.now() - (12 * 60 * 60 * 1000);
      const sobreDuplicado = sobres.find(s => {
        if (s.estado === 'CANCELADO') return false;
        const mismoMonto = Math.abs(parseFloat(s.monto_declarado || 0) - montoDeclaradoNum) < 0.01;
        if (!mismoMonto) return false;
        const fechaCreacionMs = s.created_at ? new Date(s.created_at).getTime() : 0;
        return s.estado === 'PREPARADO' || fechaCreacionMs >= hace12Horas;
      });

      if (sobreDuplicado) {
        const resDup = await Swal.fire({
          title: '<span style="color: #d97706; font-weight: 800;">⚠️ Ya tenés un sobre por este mismo importe</span>',
          html: `
            <div style="text-align: left; font-size: 0.9rem; color: #334155; line-height: 1.5;">
              <p style="margin-bottom: 0.6rem;">
                Ya registraste el sobre <strong style="color: #8e4785;">${sobreDuplicado.codigo_sobre}</strong> por <strong>${formatCurrency(sobreDuplicado.monto_declarado)}</strong> (${sobreDuplicado.modalidad_entrega === 'CHOFER' ? '🚚 Retiro por Chofer' : '🏬 Entrega en Mostrador'}).
              </p>
              <p style="margin-bottom: 0; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 0.65rem; font-size: 0.82rem; color: #92400e;">
                💡 <strong>Importante:</strong> Si es el mismo paquete físico y solo querías cambiar entre <em>Chofer</em> y <em>Mostrador</em>, no hace falta crear otro sobre: podés actualizar el existente.
              </p>
            </div>
          `,
          icon: 'warning',
          showCancelButton: true,
          showDenyButton: true,
          confirmButtonText: sobreDuplicado.estado === 'PREPARADO'
            ? `🔄 Actualizar el ${sobreDuplicado.codigo_sobre} existente`
            : '📋 Ir a Mis Sobres',
          denyButtonText: '➕ Es otro sobre físico adicional',
          cancelButtonText: 'Cancelar',
          confirmButtonColor: '#8e4785',
          denyButtonColor: '#16a34a',
          cancelButtonColor: '#64748b'
        });

        if (resDup.isConfirmed) {
          if (sobreDuplicado.estado === 'PREPARADO') {
            setSubiendo(true);
            const urlFrente = await uploadImageToStorage(fotoFrente, 'frente');
            const urlDorso = await uploadImageToStorage(fotoDorso, 'dorso');
            const { error: updErr } = await supabase
              .from('clientes_b2b_pagos_efectivo')
              .update({
                modalidad_entrega: modalidadEntrega,
                foto_frente_url: urlFrente,
                foto_dorso_url: urlDorso,
                observaciones_cliente: observaciones.trim() || sobreDuplicado.observaciones_cliente || null,
                sincronizado_local: false,
                updated_at: new Date().toISOString()
              })
              .eq('id', sobreDuplicado.id)
              .eq('cliente_id', profile.cliente_id);

            if (updErr) throw updErr;
            Swal.fire('Actualizado', `El sobre ${sobreDuplicado.codigo_sobre} fue actualizado sin duplicar el registro.`, 'success');
          }
          resetForm();
          setActiveTab('historial');
          fetchHistorialSobres();
          return;
        }

        if (!resDup.isDenied) {
          return;
        }
      }

      setSubiendo(true);

      // 1. Subir fotos a Storage
      const urlFrente = await uploadImageToStorage(fotoFrente, 'frente');
      const urlDorso = await uploadImageToStorage(fotoDorso, 'dorso');

      // 2. Insertar en tabla de pagos en efectivo
      const nuevoSobre = {
        codigo_sobre: codigoSobre,
        cliente_id: profile.cliente_id,
        monto_declarado: montoDeclaradoNum,
        desglose_billetes: cantidadesBilletes,
        foto_frente_url: urlFrente,
        foto_dorso_url: urlDorso,
        modalidad_entrega: modalidadEntrega,
        estado: 'PREPARADO',
        observaciones_cliente: observaciones.trim() || null,
        sincronizado_local: false
      };

      const { data, error } = await supabase
        .from('clientes_b2b_pagos_efectivo')
        .insert([nuevoSobre])
        .select();

      if (error) throw error;

      // 3. Notificación de Éxito y Disparo de WhatsApp
      const mensajeWA = encodeURIComponent(
        `📦 *AVISO DE ENSOBRADO (EFECTIVO)*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🏷️ *Código de Sobre:* ${codigoSobre}\n` +
        `🏢 *Cliente:* ${profile.nombre_empresa || profile.nombre_completo} (${profile.cliente_id})\n` +
        `💵 *Monto Declarado:* $ ${montoDeclaradoNum.toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n` +
        `📦 *Modalidad:* ${modalidadEntrega === 'CHOFER' ? 'Retiro por Chofer' : 'Entrega en Mostrador LAMDA'}\n` +
        `📸 *Fotos Adjuntas:* Subidas y verificadas en el Portal\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `El dinero ya fue ensobrado y sellado según el protocolo de seguridad.`
      );

      const urlWhatsApp = `https://api.whatsapp.com/send?phone=${WHATSAPP_EMPRESA}&text=${mensajeWA}`;

      Swal.fire({
        title: '<span style="color: #16a34a; font-weight: 800;">¡Aviso de Ensobrado Registrado!</span>',
        html: `
          <div style="text-align: center; font-size: 0.95rem; color: #334155; line-height: 1.5;">
            <p>Se ha anunciado el sobre <strong style="color: #8e4785; font-size: 1.15rem;">${codigoSobre}</strong> por un monto de <strong>$ ${montoDeclaradoNum.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong>.</p>
            <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 0.75rem; margin: 1rem 0; font-size: 0.85rem;">
              <strong>Próximo paso:</strong> Envía el aviso por WhatsApp para coordinar ${modalidadEntrega === 'CHOFER' ? 'el retiro con el chofer' : 'la recepción en el mostrador'}.
            </div>
          </div>
        `,
        icon: 'success',
        showCancelButton: true,
        confirmButtonText: '📲 Enviar Aviso por WhatsApp',
        cancelButtonText: 'Ver Mis Sobres',
        confirmButtonColor: '#25D366',
        cancelButtonColor: '#64748b',
        customClass: {
          popup: 'swal-b2b-popup'
        }
      }).then((result) => {
        if (result.isConfirmed) {
          window.open(urlWhatsApp, '_blank');
        }
        resetForm();
        setActiveTab('historial');
        fetchHistorialSobres();
        fetchSaldoCuentaCorriente();
      });

    } catch (err) {
      console.error('Error al registrar sobre:', err);
      Swal.fire('Error', `No se pudo registrar el sobre: ${err.message}`, 'error');
    } finally {
      setSubiendo(false);
    }
  };

  // DERIVAR TAREA A UN COLABORADOR POR WHATSAPP O EMAIL
  const handleAbrirModalDerivacion = async () => {
    const montoSugerido = montoDeclaradoNum > 0 ? montoDeclaradoNum : '';
    const nuevoCodigo = generarNuevoCodigoSobre();

    const { value: formValues } = await Swal.fire({
      title: '<span style="color: #8e4785; font-weight: 800; font-size: 1.2rem;">👥 Derivar Ensobrado a un Colaborador</span>',
      html: `
        <div style="text-align: left; font-size: 0.85rem; color: #334155; font-family: sans-serif;">
          <p style="margin-bottom: 0.85rem; color: #64748b; line-height: 1.4;">
            El colaborador recibirá un <strong>enlace directo por Email o WhatsApp</strong> para contar los billetes, sellar el sobre y subir las fotos desde su celular <strong>sin necesidad de iniciar sesión</strong>.
          </p>

          <div style="margin-bottom: 0.75rem;">
            <label style="display: block; font-weight: 700; margin-bottom: 0.25rem; font-size: 0.78rem;">Nombre del Colaborador / Encargado *:</label>
            <input id="swal-colab-nombre" class="swal2-input" placeholder="Ej: Lucas / Encargado de Turno" style="width: 100%; margin: 0; padding: 0.5rem; font-size: 0.9rem;" />
          </div>

          <div style="margin-bottom: 0.75rem;">
            <label style="display: block; font-weight: 700; margin-bottom: 0.25rem; font-size: 0.78rem;">✉️ Correo Electrónico del Colaborador:</label>
            <input id="swal-colab-email" type="email" class="swal2-input" placeholder="Ej: colaborador@empresa.com" style="width: 100%; margin: 0; padding: 0.5rem; font-size: 0.9rem;" />
          </div>

          <div style="margin-bottom: 0.75rem;">
            <label style="display: block; font-weight: 700; margin-bottom: 0.25rem; font-size: 0.78rem;">📲 Celular WhatsApp (con código de área):</label>
            <input id="swal-colab-tel" class="swal2-input" placeholder="Ej: 2215551234 (opcional)" style="width: 100%; margin: 0; padding: 0.5rem; font-size: 0.9rem;" />
          </div>

          <div style="margin-bottom: 0.75rem;">
            <label style="display: block; font-weight: 700; margin-bottom: 0.25rem; font-size: 0.78rem;">Monto a Preparar ($ ARS - Opcional):</label>
            <input id="swal-colab-monto" type="number" class="swal2-input" value="${montoSugerido}" placeholder="Ej: 50000 (o dejar en blanco para que lo defina él)" style="width: 100%; margin: 0; padding: 0.5rem; font-size: 0.9rem;" />
          </div>

          <div style="margin-bottom: 0.5rem;">
            <label style="display: block; font-weight: 700; margin-bottom: 0.25rem; font-size: 0.78rem;">Instrucción / Nota para el colaborador:</label>
            <input id="swal-colab-nota" class="swal2-input" placeholder="Ej: Preparar para la visita del chofer de hoy" style="width: 100%; margin: 0; padding: 0.5rem; font-size: 0.85rem;" />
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: '🚀 Generar y Enviar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#8e4785',
      cancelButtonColor: '#64748b',
      preConfirm: () => {
        const nombre = document.getElementById('swal-colab-nombre').value.trim();
        const email = document.getElementById('swal-colab-email').value.trim();
        const tel = document.getElementById('swal-colab-tel').value.trim().replace(/\D/g, '');
        const monto = parseFloat(document.getElementById('swal-colab-monto').value) || 0;
        const nota = document.getElementById('swal-colab-nota').value.trim();

        if (!nombre) {
          Swal.showValidationMessage('Por favor ingresa el nombre del colaborador.');
          return false;
        }

        if (email && !email.includes('@')) {
          Swal.showValidationMessage('Por favor ingresa un correo electrónico válido.');
          return false;
        }

        return { nombre, email, tel, monto, nota };
      }
    });

    if (!formValues) return;

    try {
      Swal.fire({
        title: 'Generando enlace...',
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });

      const tokenPublico = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).substring(2) + Date.now().toString(36));

      // Insertar en Supabase con estado PENDIENTE_ENSOBRADO
      const nuevoSobreDerivado = {
        codigo_sobre: nuevoCodigo,
        cliente_id: profile.cliente_id,
        monto_declarado: formValues.monto > 0 ? formValues.monto : 1, // Placeholder
        desglose_billetes: {},
        foto_frente_url: null,
        foto_dorso_url: null,
        modalidad_entrega: 'CHOFER',
        estado: 'PENDIENTE_ENSOBRADO',
        observaciones_cliente: formValues.nota || null,
        token_publico: tokenPublico,
        colaborador_nombre: formValues.nombre,
        colaborador_telefono: formValues.tel || null,
        colaborador_email: formValues.email || null,
        derivado_por: profile.nombre_empresa || profile.nombre_completo || 'Titular',
        fecha_derivacion: new Date().toISOString(),
        sincronizado_local: false
      };

      const { data, error } = await supabase
        .from('clientes_b2b_pagos_efectivo')
        .insert([nuevoSobreDerivado])
        .select();

      if (error) throw error;

      // Enlace público para el colaborador
      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const baseAppUrl = isLocalHost ? 'https://proud-darkness-ac3d.miserrano75.workers.dev' : window.location.origin;
      const urlEnsobrado = `${baseAppUrl}/#ensobrado/${tokenPublico}`;
      const titularStr = profile.nombre_empresa || profile.nombre_completo || 'Titular';
      const montoTexto = formValues.monto > 0 ? `$ ${formValues.monto.toLocaleString('es-AR')}` : 'el pago correspondiente';

      // 1. Si ingresó correo electrónico, intentar enviar email automático por el servidor
      let emailEnviado = false;
      if (formValues.email) {
        try {
          const resEmail = await fetch('/api/logistica/pagos-efectivo/enviar-email-derivacion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: formValues.email,
              nombreColaborador: formValues.nombre,
              monto: formValues.monto,
              codigoSobre: nuevoCodigo,
              urlEnsobrado,
              titular: titularStr,
              nota: formValues.nota
            })
          });
          const dataEmail = await resEmail.json();
          if (dataEmail.success) {
            emailEnviado = true;
          }
        } catch (e) {
          console.warn('No se pudo enviar email vía servidor local, usando fallback:', e);
        }
      }

      // Preparar enlace de WhatsApp
      const mensajeWA = encodeURIComponent(
        `📦 *TAREA DE ENSOBRADO DE EFECTIVO PARA LAMDA*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Hola *${formValues.nombre}*! Te derivamos la preparación y sellado del sobre de efectivo por *${montoTexto}*.\n\n` +
        `👉 *Ingresá en este enlace desde tu celular para realizar el conteo y las fotos:*\n` +
        `${urlEnsobrado}\n\n` +
        `🏷️ Código de sobre asignado: *${nuevoCodigo}*\n` +
        (formValues.nota ? `📝 Nota: ${formValues.nota}\n` : '') +
        `━━━━━━━━━━━━━━━━━━━━`
      );

      const telDestino = formValues.tel ? (formValues.tel.startsWith('54') ? formValues.tel : `549${formValues.tel}`) : '';
      const urlWhatsApp = `https://api.whatsapp.com/send?${telDestino ? `phone=${telDestino}&` : ''}text=${mensajeWA}`;

      // Preparar enlace mailto
      const mailtoSubject = encodeURIComponent(`📦 Tarea de Ensobrado de Efectivo [${nuevoCodigo}] - ${titularStr}`);
      const mailtoBody = encodeURIComponent(
        `Hola ${formValues.nombre},\n\n` +
        `${titularStr} te ha derivado la preparación y sellado del sobre de efectivo por ${montoTexto} para LAMDA.\n\n` +
        `Ingresá en el siguiente enlace para realizar el conteo guiado de billetes, sellado y fotos:\n` +
        `${urlEnsobrado}\n\n` +
        `Código asignado: ${nuevoCodigo}\n` +
        (formValues.nota ? `Nota: ${formValues.nota}\n\n` : '\n') +
        `Saludos,\n${titularStr}`
      );
      const mailtoUrl = `mailto:${formValues.email || ''}?subject=${mailtoSubject}&body=${mailtoBody}`;

      Swal.fire({
        title: '<span style="color: #16a34a; font-weight: 800;">¡Enlace de Derivación Generado!</span>',
        html: `
          <div style="text-align: center; font-size: 0.9rem; color: #334155;">
            <p>Se asignó el sobre <strong style="color: #8e4785;">${nuevoCodigo}</strong> a <strong>${formValues.nombre}</strong>.</p>
            ${emailEnviado ? `
              <div style="background: #dcfce7; color: #166534; border: 1px solid #86efac; border-radius: 8px; padding: 0.5rem; margin: 0.75rem 0; font-size: 0.82rem; font-weight: 600;">
                ✅ Correo electrónico enviado automáticamente a <strong>${formValues.email}</strong>.
              </div>
            ` : ''}
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.6rem; margin: 0.75rem 0; font-family: monospace; font-size: 0.75rem; word-break: break-all;">
              ${urlEnsobrado}
            </div>
            <div style="display: flex; gap: 0.5rem; justify-content: center; margin-top: 1rem; flex-wrap: wrap;">
              <a href="${urlWhatsApp}" target="_blank" style="background: #25D366; color: #ffffff; text-decoration: none; padding: 0.55rem 0.9rem; border-radius: 6px; font-weight: 700; font-size: 0.8rem; display: inline-flex; alignItems: center; gap: 0.3rem;">
                📲 WhatsApp
              </a>
              <a href="${mailtoUrl}" target="_blank" style="background: #0284c7; color: #ffffff; text-decoration: none; padding: 0.55rem 0.9rem; border-radius: 6px; font-weight: 700; font-size: 0.8rem; display: inline-flex; alignItems: center; gap: 0.3rem;">
                ✉️ Enviar Email
              </a>
            </div>
          </div>
        `,
        icon: 'success',
        showCancelButton: true,
        confirmButtonText: '📋 Copiar Enlace',
        cancelButtonText: 'Listo / Ver Sobres',
        confirmButtonColor: '#8e4785',
        cancelButtonColor: '#64748b'
      }).then((res) => {
        if (res.isConfirmed) {
          navigator.clipboard.writeText(urlEnsobrado);
          Swal.fire('Copiado', 'Enlace copiado al portapapeles.', 'info');
        }
        setActiveTab('historial');
        fetchHistorialSobres();
      });

    } catch (err) {
      console.error('Error al derivar ensobrado:', err);
      Swal.fire('Error', `No se pudo generar la derivación: ${err.message}`, 'error');
    }
  };

  // Reenviar invitación por Email
  const handleReenviarEmail = async (sobre) => {
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const baseAppUrl = isLocalHost ? 'https://proud-darkness-ac3d.miserrano75.workers.dev' : window.location.origin;
    const linkPublico = sobre.token_publico ? `${baseAppUrl}/#ensobrado/${sobre.token_publico}` : '';
    const titularStr = profile.nombre_empresa || profile.nombre_completo || 'Titular';
    const emailDest = sobre.colaborador_email || '';

    const { value: emailInput } = await Swal.fire({
      title: '✉️ Enviar Enlace por Correo',
      input: 'email',
      inputValue: emailDest,
      inputPlaceholder: 'colaborador@empresa.com',
      showCancelButton: true,
      confirmButtonText: 'Enviar Correo',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#8e4785'
    });

    if (!emailInput) return;

    try {
      Swal.fire({ title: 'Enviando correo...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
      
      const res = await fetch('/api/logistica/pagos-efectivo/enviar-email-derivacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailInput,
          nombreColaborador: sobre.colaborador_nombre,
          monto: sobre.monto_declarado,
          codigoSobre: sobre.codigo_sobre,
          urlEnsobrado: linkPublico,
          titular: titularStr,
          nota: sobre.observaciones_cliente
        })
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo enviar el correo.');

      // Actualizar email en Supabase si era nuevo
      if (emailInput !== sobre.colaborador_email) {
        await supabase
          .from('clientes_b2b_pagos_efectivo')
          .update({ colaborador_email: emailInput })
          .eq('id', sobre.id);
        fetchHistorialSobres();
      }

      Swal.fire('Enviado', `Correo enviado exitosamente a ${emailInput}.`, 'success');
    } catch (err) {
      // Fallback a mailto
      const mailtoSubject = encodeURIComponent(`📦 Tarea de Ensobrado [${sobre.codigo_sobre}] - ${titularStr}`);
      const mailtoBody = encodeURIComponent(`Hola ${sobre.colaborador_nombre || ''},\n\nIngresá al link para preparar el sobre de efectivo:\n${linkPublico}\n\nSaludos,\n${titularStr}`);
      window.open(`mailto:${emailInput}?subject=${mailtoSubject}&body=${mailtoBody}`, '_blank');
      Swal.fire('Atención', 'Se abrió tu cliente de correo local para enviar el mensaje.', 'info');
    }
  };

  const resetForm = () => {
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {
      // Ignore storage errors
    }
    setStep(1);
    setMontoDeclarado('');
    setCantidadesBilletes({});
    setConfirmEnsobrado(false);
    setModalidadEntrega('CHOFER');
    setObservaciones('');
    setFotoFrente(null);
    setFotoFrentePreview(null);
    setFotoDorso(null);
    setFotoDorsoPreview(null);
    generarNuevoCodigoSobre();
  };

  const handleCancelarOperacion = async () => {
    const hasData = montoDeclaradoNum > 0 || totalBilletes > 0 || fotoFrente || fotoDorso;
    if (hasData) {
      const confirm = await Swal.fire({
        title: '¿Cancelar operación?',
        text: 'Se descartarán los datos del sobre en preparación.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, cancelar operación',
        cancelButtonText: 'Continuar preparando',
        confirmButtonColor: '#e11d48',
        cancelButtonColor: '#64748b'
      });
      if (!confirm.isConfirmed) return;
    }
    resetForm();
    if (onNavigateToHome) {
      onNavigateToHome();
    } else {
      setActiveTab('historial');
    }
  };

  // Formato Moneda
  const formatCurrency = (val) => {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: 'ARS'
    }).format(val);
  };

  // Ver detalle modal de sobre histórico
  const handleVerDetalleSobre = (sobre) => {
    const desglose = sobre.desglose_billetes || {};
    const filasBilletes = Object.entries(desglose)
      .filter(([_, cant]) => cant > 0)
      .map(([den, cant]) => {
        const sub = parseInt(den, 10) * parseInt(cant, 10);
        return `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 0.4rem; font-weight: 600;">$ ${parseInt(den, 10).toLocaleString('es-AR')}</td>
            <td style="padding: 0.4rem; text-align: center;">${cant} billete(s)</td>
            <td style="padding: 0.4rem; text-align: right; font-weight: 700;">$ ${sub.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
          </tr>
        `;
      }).join('');

    const estadoLabels = {
      'PENDIENTE_ENSOBRADO': '<span style="background: #fef3c7; color: #b45309; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">🟡 PENDIENTE (Colaborador)</span>',
      'PREPARADO': '<span style="background: #dcfce7; color: #15803d; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">🟢 PREPARADO (Listo)</span>',
      'EN_TRANSITO': '<span style="background: #e0f2fe; color: #0369a1; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">🔵 EN TRÁNSITO (Chofer)</span>',
      'RECIBIDO_LOCAL': '<span style="background: #f3e8ff; color: #7e22ce; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">🟣 EN REVISIÓN (Local)</span>',
      'ACREDITADO': '<span style="background: #dcfce7; color: #15803d; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">🟢 ACREDITADO EN CTA CTE</span>',
      'OBSERVADO': '<span style="background: #fee2e2; color: #b91c1c; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">🔴 OBSERVADO</span>',
      'CANCELADO': '<span style="background: #f1f5f9; color: #64748b; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 700;">⚪ CANCELADO</span>'
    };

    const linkPublico = sobre.token_publico ? `${window.location.origin}/#ensobrado/${sobre.token_publico}` : '';

    Swal.fire({
      title: `<span style="color: #8e4785; font-weight: 700;">Detalle de Sobre ${sobre.codigo_sobre}</span>`,
      html: `
        <div style="text-align: left; font-size: 0.85rem; color: #1e293b;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; background: #f8fafc; padding: 0.6rem; border-radius: 6px;">
            <div><strong>Monto:</strong> <span style="font-size: 1.15rem; font-weight: 800; color: #16a34a;">${formatCurrency(sobre.monto_declarado)}</span></div>
            <div>${estadoLabels[sobre.estado] || sobre.estado}</div>
          </div>

          <div style="margin-bottom: 0.75rem;">
            <span style="font-weight: 600; color: #64748b;">Modalidad:</span> 
            <strong>${sobre.modalidad_entrega === 'CHOFER' ? '🚚 Retiro por Chofer' : '🏬 Entrega en Local'}</strong>
            ${sobre.colaborador_nombre ? `<span style="margin-left: 8px; color: #64748b;">(Encargado: <strong>${sobre.colaborador_nombre}</strong>)</span>` : ''}
          </div>

          ${linkPublico && sobre.estado === 'PENDIENTE_ENSOBRADO' ? `
            <div style="background: #fefce8; border: 1px dashed #eab308; border-radius: 6px; padding: 0.5rem; margin-bottom: 0.75rem; font-size: 0.75rem;">
              <strong>Enlace para colaborador:</strong> <a href="${linkPublico}" target="_blank" style="color: #8e4785; word-break: break-all;">${linkPublico}</a>
            </div>
          ` : ''}

          ${Object.keys(desglose).length > 0 ? `
            <div style="font-weight: 700; color: #8e4785; margin: 0.75rem 0 0.25rem 0; text-transform: uppercase; font-size: 0.75rem;">Arqueo de Billetes Declarado</div>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-bottom: 1rem; background: #ffffff;">
              <thead>
                <tr style="background: #f1f5f9; text-align: left;">
                  <th style="padding: 0.35rem;">Denominación</th>
                  <th style="padding: 0.35rem; text-align: center;">Cantidad</th>
                  <th style="padding: 0.35rem; text-align: right;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${filasBilletes || '<tr><td colspan="3" style="text-align:center; padding:0.5rem;">Sin desglose</td></tr>'}
              </tbody>
            </table>
          ` : ''}

          ${sobre.foto_frente_url && sobre.foto_dorso_url ? `
            <div style="font-weight: 700; color: #8e4785; margin-bottom: 0.4rem; text-transform: uppercase; font-size: 0.75rem;">Fotografías de Seguridad</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem;">
              <div>
                <span style="font-size: 0.7rem; color: #64748b; display: block; margin-bottom: 0.2rem; font-weight: 600;">FRENTE</span>
                <a href="${sobre.foto_frente_url}" target="_blank">
                  <img src="${sobre.foto_frente_url}" alt="Frente" style="width: 100%; height: 110px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1;" />
                </a>
              </div>
              <div>
                <span style="font-size: 0.7rem; color: #64748b; display: block; margin-bottom: 0.2rem; font-weight: 600;">DORSO (SELLADO)</span>
                <a href="${sobre.foto_dorso_url}" target="_blank">
                  <img src="${sobre.foto_dorso_url}" alt="Dorso" style="width: 100%; height: 110px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1;" />
                </a>
              </div>
            </div>
          ` : ''}

          ${sobre.observaciones_cliente ? `
            <div style="background: #f8fafc; border-radius: 6px; padding: 0.5rem; font-size: 0.8rem; margin-bottom: 0.5rem;">
              <span style="font-weight: 600; color: #64748b;">Observación:</span> ${sobre.observaciones_cliente}
            </div>
          ` : ''}

          ${sobre.observaciones_admin ? `
            <div style="background: #f0fdf4; border-left: 3px solid #16a34a; border-radius: 4px; padding: 0.5rem; font-size: 0.8rem;">
              <span style="font-weight: 600; color: #16a34a;">Nota Administración:</span> ${sobre.observaciones_admin}
            </div>
          ` : ''}
        </div>
      `,
      confirmButtonText: 'Cerrar',
      confirmButtonColor: '#8e4785',
      customClass: { popup: 'swal-b2b-popup' }
    });
  };

  // Cambiar modalidad de entrega (Chofer <-> Local) en un sobre PREPARADO sin duplicarlo
  const handleCambiarModalidadSobre = async (sobre) => {
    const nuevaModalidad = sobre.modalidad_entrega === 'CHOFER' ? 'LOCAL' : 'CHOFER';
    const labelNueva = nuevaModalidad === 'CHOFER' ? '🚚 Retiro por Chofer' : '🏬 Entrega en Mostrador Local';

    const confirm = await Swal.fire({
      title: '🔄 ¿Cambiar modalidad de entrega?',
      html: `El sobre <strong>${sobre.codigo_sobre}</strong> pasará a <strong>${labelNueva}</strong> conservando el mismo código y monto.`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: `Sí, cambiar a ${nuevaModalidad === 'CHOFER' ? 'Chofer' : 'Local'}`,
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#8e4785',
      cancelButtonColor: '#64748b'
    });

    if (!confirm.isConfirmed) return;

    try {
      const { error } = await supabase
        .from('clientes_b2b_pagos_efectivo')
        .update({
          modalidad_entrega: nuevaModalidad,
          sincronizado_local: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', sobre.id)
        .eq('cliente_id', profile.cliente_id);

      if (error) throw error;

      Swal.fire('Modalidad actualizada', `El sobre ${sobre.codigo_sobre} ahora figura como ${labelNueva}.`, 'success');
      fetchHistorialSobres();
    } catch (err) {
      Swal.fire('Error', `No se pudo cambiar la modalidad: ${err.message}`, 'error');
    }
  };

  // Cancelar sobre si está en PREPARADO o PENDIENTE
  const handleCancelarSobre = async (sobre) => {
    const confirm = await Swal.fire({
      title: '¿Cancelar este sobre?',
      text: `El sobre ${sobre.codigo_sobre} será cancelado.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, cancelar sobre',
      cancelButtonText: 'Volver',
      confirmButtonColor: '#e11d48',
      cancelButtonColor: '#64748b'
    });

    if (!confirm.isConfirmed) return;

    try {
      const { error } = await supabase
        .from('clientes_b2b_pagos_efectivo')
        .update({ 
          estado: 'CANCELADO', 
          sincronizado_local: false,
          updated_at: new Date().toISOString() 
        })
        .eq('id', sobre.id)
        .eq('cliente_id', profile.cliente_id);

      if (error) throw error;

      Swal.fire('Cancelado', 'El sobre ha sido cancelado.', 'success');
      fetchHistorialSobres();
    } catch (err) {
      Swal.fire('Error', `No se pudo cancelar: ${err.message}`, 'error');
    }
  };

  // Reenviar aviso WhatsApp al cliente o empresa
  const handleReenviarWhatsApp = (sobre) => {
    const mensajeWA = encodeURIComponent(
      `📦 *RECORDATORIO DE ENSOBRADO (EFECTIVO)*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🏷️ *Código de Sobre:* ${sobre.codigo_sobre}\n` +
      `🏢 *Cliente:* ${profile.nombre_empresa || profile.nombre_completo} (${profile.cliente_id})\n` +
      `💵 *Monto Declarado:* $ ${parseFloat(sobre.monto_declarado).toLocaleString('es-AR', { minimumFractionDigits: 2 })}\n` +
      `📦 *Modalidad:* ${sobre.modalidad_entrega === 'CHOFER' ? 'Retiro por Chofer' : 'Entrega en Mostrador LAMDA'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Consulta sobre el estado de retiro / recepción del sobre.`
    );
    window.open(`https://api.whatsapp.com/send?phone=${WHATSAPP_EMPRESA}&text=${mensajeWA}`, '_blank');
  };

  // Filtrado de sobres activos vs cancelados
  const sobresCanceladosCount = sobres.filter(s => s.estado === 'CANCELADO').length;
  const sobresVisibles = sobres.filter(s => mostrarCancelados ? true : s.estado !== 'CANCELADO');

  return (
    <div style={{ maxWidth: '1080px', margin: '0 auto', paddingBottom: '3rem' }}>
      
      {/* Botón de retorno al Inicio */}
      {onNavigateToHome && (
        <div style={{ marginBottom: '0.65rem' }}>
          <button
            type="button"
            onClick={handleCancelarOperacion}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: 'var(--text-secondary)',
              padding: '0.35rem 0.75rem',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              transition: 'all 0.2s ease'
            }}
          >
            <ArrowLeft size={14} /> Volver al Inicio
          </button>
        </div>
      )}

      {/* Header Principal */}
      <div className="page-header" style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.3rem' }}>
            <Banknote size={24} style={{ color: '#8e4785' }} /> 
            <span>Aviso de Ensobrado <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>(Efectivo)</span></span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '0.15rem' }}>
            Conteo de billetes, ensobrado sellado y aviso de retiro / entrega.
          </p>
        </div>

        {/* Saldo de Cuenta Corriente */}
        <div style={{ 
          background: 'linear-gradient(135deg, hsl(222, 47%, 11%), hsl(222, 47%, 16%))', 
          border: '1px solid rgba(255,255,255,0.1)', 
          borderRadius: '10px', 
          padding: '0.5rem 0.9rem', 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.75rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          <div>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
              Saldo en Cuenta
            </span>
            <span style={{ fontSize: '1.15rem', fontWeight: '800', color: saldoActual > 0 ? '#fb7185' : '#4ade80' }}>
              {loadingSaldo ? '...' : formatCurrency(saldoActual)}
            </span>
          </div>
          {onNavigateToCC && (
            <button 
              onClick={onNavigateToCC} 
              style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#ffffff', padding: '0.35rem 0.55rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
            >
              <FileText size={13} /> Ver CC
            </button>
          )}
        </div>
      </div>

      {/* Selector de Pestañas Superiores */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setActiveTab('nuevo')}
            style={{
              padding: '0.6rem 1rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'nuevo' ? '3px solid #8e4785' : '3px solid transparent',
              color: activeTab === 'nuevo' ? '#ffffff' : 'var(--text-muted)',
              fontWeight: '600',
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <PackageCheck size={16} /> Preparar Sobre
          </button>
          <button
            onClick={() => { setActiveTab('historial'); fetchHistorialSobres(); }}
            style={{
              padding: '0.6rem 1rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'historial' ? '3px solid #8e4785' : '3px solid transparent',
              color: activeTab === 'historial' ? '#ffffff' : 'var(--text-muted)',
              fontWeight: '600',
              fontSize: '0.88rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <Receipt size={16} /> Mis Sobres {sobresVisibles.length > 0 && `(${sobresVisibles.length})`}
          </button>
        </div>

        {/* Botón de Derivación Rápida */}
        <button
          onClick={handleAbrirModalDerivacion}
          style={{
            background: 'linear-gradient(135deg, rgba(142, 71, 133, 0.25), rgba(142, 71, 133, 0.15))',
            border: '1px solid #8e4785',
            color: '#ffffff',
            padding: '0.45rem 0.85rem',
            borderRadius: '8px',
            fontSize: '0.8rem',
            fontWeight: '700',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            boxShadow: '0 2px 8px rgba(142, 71, 133, 0.25)'
          }}
        >
          <Users size={15} style={{ color: '#e879f9' }} /> Derivar a un Colaborador
        </button>
      </div>

      {/* ========================================================================= */}
      {/* VISTA 1: ASISTENTE DE ENSOBRADO (NUEVO PAGO) */}
      {/* ========================================================================= */}
      {activeTab === 'nuevo' && (
        <div style={{ background: 'var(--surface-color, #1e293b)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '1rem', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          
          {/* Tarjeta Banner de Derivación */}
          <div style={{ background: 'rgba(142, 71, 133, 0.08)', border: '1px dashed rgba(142, 71, 133, 0.4)', borderRadius: '10px', padding: '0.65rem 0.85rem', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={18} style={{ color: '#e879f9' }} />
              <div>
                <strong style={{ fontSize: '0.82rem', color: '#ffffff', display: 'block' }}>¿No vas a preparar el dinero vos mismo?</strong>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Podés derivarle la tarea a un encargado con un link por WhatsApp.</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAbrirModalDerivacion}
              style={{ background: '#8e4785', color: '#ffffff', border: 'none', padding: '0.4rem 0.75rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
            >
              <Share2 size={13} /> Derivar Tarea
            </button>
          </div>

          {/* Barra de Progreso del Asistente */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', position: 'relative' }}>
            <div style={{ position: 'absolute', top: '50%', left: '5%', right: '5%', height: '2px', background: 'rgba(255,255,255,0.1)', zIndex: 0, transform: 'translateY(-50%)' }} />
            
            {[
              { num: 1, label: 'Monto' },
              { num: 2, label: 'Billetes' },
              { num: 3, label: 'Ensobrado' },
              { num: 4, label: 'Fotos' }
            ].map((s) => {
              const isPassed = step > s.num;
              const isCurrent = step === s.num;
              return (
                <div key={s.num} style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: '700',
                    fontSize: '0.8rem',
                    background: isCurrent ? '#8e4785' : isPassed ? '#16a34a' : 'hsl(222, 47%, 14%)',
                    color: '#ffffff',
                    border: isCurrent ? '2px solid rgba(142, 71, 133, 0.4)' : isPassed ? '2px solid #16a34a' : '1px solid rgba(255,255,255,0.15)',
                    boxShadow: isCurrent ? '0 0 10px rgba(142, 71, 133, 0.5)' : 'none',
                    transition: 'all 0.3s ease'
                  }}>
                    {isPassed ? '✓' : s.num}
                  </div>
                  <span style={{ fontSize: '0.7rem', fontWeight: isCurrent ? '700' : '500', color: isCurrent ? '#ffffff' : 'var(--text-muted)' }}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ------------------------------------------------------------- */}
          {/* PASO 1: DECLARACIÓN DEL MONTO */}
          {/* ------------------------------------------------------------- */}
          {step === 1 && (
            <div>
              <div style={{ textAlign: 'center', maxWidth: '500px', margin: '0 auto 1.25rem auto' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: '700', color: '#ffffff', marginBottom: '0.35rem' }}>
                  ¿Cuánto dinero en efectivo vas a preparar?
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  Indica el importe total a colocar dentro del sobre (pago total o parcial).
                </p>
              </div>

              <div style={{ maxWidth: '420px', margin: '0 auto 1.5rem auto' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  Monto a Declarar ($ ARS):
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <DollarSign size={22} style={{ position: 'absolute', left: '0.85rem', color: '#8e4785' }} />
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Ej: 145300"
                    value={montoDeclarado}
                    onChange={(e) => setMontoDeclarado(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.85rem 0.85rem 0.85rem 2.6rem',
                      fontSize: '1.25rem',
                      fontWeight: '700',
                      borderRadius: '10px',
                      background: 'rgba(0,0,0,0.25)',
                      border: '2px solid rgba(142, 71, 133, 0.5)',
                      color: '#ffffff',
                      outline: 'none'
                    }}
                  />
                </div>

                {/* Botones rápidos */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                  {saldoActual > 0 && (
                    <button
                      type="button"
                      onClick={() => setMontoDeclarado(Math.round(saldoActual).toString())}
                      style={{ background: 'rgba(142, 71, 133, 0.2)', border: '1px solid #8e4785', color: '#ffffff', padding: '0.35rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: '600' }}
                    >
                      Pagar Total ({formatCurrency(saldoActual)})
                    </button>
                  )}
                  {[20000, 50000, 100000, 150000].map(val => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setMontoDeclarado(val.toString())}
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '0.35rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
                    >
                      + {formatCurrency(val)}
                    </button>
                  ))}
                </div>

                {/* Proyección del saldo resultante */}
                {montoDeclaradoNum > 0 && (
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '0.75rem', marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Saldo Proyectado:</span>
                      <strong style={{ fontSize: '1rem', color: (saldoActual - montoDeclaradoNum) <= 0 ? '#4ade80' : '#fb7185' }}>
                        {formatCurrency(saldoActual - montoDeclaradoNum)}
                      </strong>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {(saldoActual - montoDeclaradoNum) <= 0 ? '✓ Cuenta saldada' : 'Pago a cuenta'}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={handleCancelarOperacion}
                  style={{
                    background: 'none',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    color: '#fca5a5',
                    padding: '0.65rem 1rem',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem'
                  }}
                >
                  ✕ Cancelar operación
                </button>

                <button
                  type="button"
                  disabled={montoDeclaradoNum <= 0}
                  onClick={() => setStep(2)}
                  style={{
                    background: montoDeclaradoNum > 0 ? '#8e4785' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.75rem 1.4rem',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '0.92rem',
                    cursor: montoDeclaradoNum > 0 ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: montoDeclaradoNum > 0 ? '0 4px 12px rgba(142, 71, 133, 0.4)' : 'none'
                  }}
                >
                  Continuar al Conteo de Billetes <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* PASO 2: ASISTENTE DE CONTEO Y DENOMINACIONES (ANCLAJE FIJO + BLOQUEO DE EXCESO) */}
          {/* ------------------------------------------------------------- */}
          {step === 2 && (
            <div style={{ position: 'relative' }}>
              
              {/* Widget Superior Rígidamente Anclado (Sticky Top con z-index alto) */}
              <div style={{
                position: 'sticky',
                top: '0',
                zIndex: 999,
                background: '#0f172a',
                border: arqueoExacto ? '2px solid #16a34a' : '2px solid #8e4785',
                borderRadius: '10px',
                padding: '0.75rem 0.9rem',
                marginBottom: '1rem',
                boxShadow: '0 8px 24px rgba(0,0,0,0.7)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <div>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Declarado: <strong style={{ color: '#ffffff' }}>{formatCurrency(montoDeclaradoNum)}</strong>
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '2px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Contado:</span>
                    <strong style={{ fontSize: '1.15rem', color: arqueoExacto ? '#4ade80' : '#ffffff' }}>
                      {formatCurrency(totalBilletes)}
                    </strong>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase' }}>
                    {arqueoExacto ? 'Arqueo' : (diferenciaArqueo < 0 ? 'Falta Cargar' : 'Excedido')}
                  </span>
                  <strong style={{ 
                    fontSize: '0.95rem', 
                    color: arqueoExacto ? '#4ade80' : (diferenciaArqueo < 0 ? '#facc15' : '#f87171'),
                    background: arqueoExacto ? 'rgba(22, 163, 74, 0.25)' : (diferenciaArqueo < 0 ? 'rgba(234, 179, 8, 0.25)' : 'rgba(239, 68, 68, 0.25)'),
                    border: arqueoExacto ? '1px solid #16a34a' : (diferenciaArqueo < 0 ? '1px solid #eab308' : '1px solid #ef4444'),
                    padding: '0.25rem 0.55rem',
                    borderRadius: '6px',
                    display: 'inline-block',
                    marginTop: '2px'
                  }}>
                    {arqueoExacto ? '✓ Exacto ($ 0)' : (diferenciaArqueo < 0 ? `- ${formatCurrency(Math.abs(diferenciaArqueo))}` : `+ ${formatCurrency(diferenciaArqueo)}`)}
                  </strong>
                </div>
              </div>

              {/* Lista Compacta de Denominaciones con Feedback Contextual y Bloqueo */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {DENOMINACIONES_BILLETES.map((den) => {
                  const cant = cantidadesBilletes[den.valor] || 0;
                  const subtotalDen = cant * den.valor;
                  const puedeSumar = (totalBilletes + den.valor) <= montoDeclaradoNum;

                  return (
                    <div 
                      key={den.valor} 
                      style={{ 
                        background: cant > 0 ? 'rgba(142, 71, 133, 0.12)' : 'rgba(255,255,255,0.02)', 
                        border: cant > 0 ? '1px solid rgba(142, 71, 133, 0.5)' : '1px solid rgba(255,255,255,0.06)', 
                        borderRadius: '10px', 
                        padding: '0.55rem 0.75rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {/* Fila Principal de la Denominación */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                        
                        {/* Lado Izquierdo: Denominación y Subtotal */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <strong style={{ fontSize: '1.05rem', color: '#ffffff' }}>{den.label}</strong>
                            {subtotalDen > 0 && (
                              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#4ade80' }}>
                                = {formatCurrency(subtotalDen)}
                              </span>
                            )}
                          </div>
                          <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {den.subtitulo}
                          </span>
                        </div>

                        {/* Lado Derecho: Controles Ergonómicos y Bloqueo de Exceso */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                          <button
                            type="button"
                            disabled={cant === 0}
                            onClick={() => decrementarBillete(den.valor)}
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '6px',
                              background: cant > 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
                              border: '1px solid rgba(255,255,255,0.12)',
                              color: cant > 0 ? '#ffffff' : 'var(--text-muted)',
                              cursor: cant > 0 ? 'pointer' : 'not-allowed',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}
                          >
                            <Minus size={14} />
                          </button>

                          <input
                            type="number"
                            min="0"
                            value={cant === 0 ? '' : cant}
                            placeholder="0"
                            onChange={(e) => handleCantidadChange(den.valor, e.target.value)}
                            style={{
                              width: '48px',
                              maxWidth: '52px',
                              textAlign: 'center',
                              padding: '0.35rem 0.2rem',
                              fontSize: '1rem',
                              fontWeight: '700',
                              borderRadius: '6px',
                              background: 'rgba(0,0,0,0.35)',
                              border: '1px solid rgba(255,255,255,0.15)',
                              color: '#ffffff',
                              outline: 'none'
                            }}
                          />

                          <button
                            type="button"
                            disabled={!puedeSumar}
                            onClick={() => incrementarBillete(den.valor)}
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '6px',
                              background: puedeSumar ? 'rgba(142, 71, 133, 0.35)' : 'rgba(255,255,255,0.03)',
                              border: puedeSumar ? '1px solid #8e4785' : '1px solid rgba(255,255,255,0.08)',
                              color: puedeSumar ? '#ffffff' : 'var(--text-muted)',
                              cursor: puedeSumar ? 'pointer' : 'not-allowed',
                              opacity: puedeSumar ? 1 : 0.4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}
                            title={puedeSumar ? `Sumar ${den.label}` : 'Superaría el monto declarado'}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Línea de Feedback Contextual en Tiempo Real */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed rgba(255,255,255,0.06)', paddingTop: '0.2rem', fontSize: '0.72rem' }}>
                        {arqueoExacto ? (
                          <span style={{ color: '#4ade80', fontWeight: '700' }}>✅ Arqueo exacto alcanzado</span>
                        ) : diferenciaArqueo < 0 ? (
                          <span style={{ color: '#facc15', fontWeight: '600' }}>⚠️ Faltan: {formatCurrency(Math.abs(diferenciaArqueo))} para completar</span>
                        ) : (
                          <span style={{ color: '#f87171', fontWeight: '600' }}>🛑 Excedido por: {formatCurrency(diferenciaArqueo)}</span>
                        )}
                        {!puedeSumar && !arqueoExacto && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>Tope de billete alcanzado</span>
                        )}
                      </div>

                    </div>
                  );
                })}
              </div>

              {/* Botones de navegación inferiores */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'var(--text-secondary)', padding: '0.6rem 0.9rem', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }}
                  >
                    <ArrowLeft size={14} /> Monto
                  </button>

                  <button
                    type="button"
                    onClick={handleCancelarOperacion}
                    style={{
                      background: 'none',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      color: '#fca5a5',
                      padding: '0.6rem 0.85rem',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    ✕ Cancelar
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!arqueoExacto}
                  onClick={() => setStep(3)}
                  style={{
                    background: arqueoExacto ? '#16a34a' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.75rem 1.25rem',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '0.88rem',
                    cursor: arqueoExacto ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: arqueoExacto ? '0 4px 12px rgba(22, 163, 74, 0.4)' : 'none'
                  }}
                >
                  Arqueo Exacto - Ensobrar <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* PASO 3: PROTOCOLO DE ENSOBRADO COMPACTO */}
          {/* ------------------------------------------------------------- */}
          {step === 3 && (
            <div>
              <div style={{ textAlign: 'center', maxWidth: '500px', margin: '0 auto 1rem auto' }}>
                <div style={{ display: 'inline-block', background: 'rgba(142, 71, 133, 0.25)', border: '1px solid #8e4785', borderRadius: '16px', padding: '0.25rem 0.8rem', color: '#ffffff', fontSize: '0.8rem', fontWeight: '700', marginBottom: '0.5rem' }}>
                  CÓDIGO ASIGNADO: {codigoSobre}
                </div>
                <h2 style={{ fontSize: '1.2rem', fontWeight: '700', color: '#ffffff', marginBottom: '0.25rem' }}>
                  Protocolo de Ensobrado y Sellado
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  Prepara el sobre antes de tomar las fotografías de seguridad.
                </p>
              </div>

              {/* Tarjeta Unificada Compacta de 3 Pasos */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '0.85rem', marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.25)', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '700', flexShrink: 0 }}>
                    1
                  </span>
                  <span style={{ fontSize: '0.82rem', color: '#ffffff' }}>
                    Mete los billetes contados (<strong>{formatCurrency(montoDeclaradoNum)}</strong>) en un sobre o caja.
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(234, 179, 8, 0.25)', color: '#facc15', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '700', flexShrink: 0 }}>
                    2
                  </span>
                  <span style={{ fontSize: '0.82rem', color: '#ffffff' }}>
                    Sella todas las solapas con <strong>cinta adhesiva firme</strong> de forma segura.
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'rgba(142, 71, 133, 0.25)', color: '#c084fc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '700', flexShrink: 0 }}>
                    3
                  </span>
                  <span style={{ fontSize: '0.82rem', color: '#ffffff' }}>
                    Escribe con marcador en el frente: <strong style={{ color: '#e879f9' }}>{codigoSobre}</strong> y <strong style={{ color: '#ffffff' }}>{profile.nombre_empresa || profile.nombre_completo}</strong>.
                  </span>
                </div>

              </div>

              {/* Checkbox de Confirmación */}
              <div style={{ background: 'rgba(142, 71, 133, 0.12)', border: '1px solid #8e4785', borderRadius: '10px', padding: '0.75rem 0.85rem', marginBottom: '1.25rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.82rem', color: '#ffffff' }}>
                  <input
                    type="checkbox"
                    checked={confirmEnsobrado}
                    onChange={(e) => setConfirmEnsobrado(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: '#8e4785', cursor: 'pointer', flexShrink: 0 }}
                  />
                  <span>
                    He colocado los billetes, sellado el paquete y escrito el código <strong>{codigoSobre}</strong>.
                  </span>
                </label>
              </div>

              {/* Botones de Navegación */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'var(--text-secondary)', padding: '0.6rem 0.9rem', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }}
                  >
                    <ArrowLeft size={14} /> Billetes
                  </button>

                  <button
                    type="button"
                    onClick={handleCancelarOperacion}
                    style={{
                      background: 'none',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      color: '#fca5a5',
                      padding: '0.6rem 0.85rem',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    ✕ Cancelar
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!confirmEnsobrado}
                  onClick={() => setStep(4)}
                  style={{
                    background: confirmEnsobrado ? '#8e4785' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.75rem 1.25rem',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '0.88rem',
                    cursor: confirmEnsobrado ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: confirmEnsobrado ? '0 4px 12px rgba(142, 71, 133, 0.4)' : 'none'
                  }}
                >
                  Continuar a Fotos <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* PASO 4: FOTOS DE FRENTE/DORSO, MODALIDAD Y DECLARACIÓN */}
          {/* ------------------------------------------------------------- */}
          {step === 4 && (
            <div>
              <div style={{ textAlign: 'center', maxWidth: '500px', margin: '0 auto 1rem auto' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: '700', color: '#ffffff', marginBottom: '0.25rem' }}>
                  Fotos del Sobre y Modalidad
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  Toma dos fotos claras del sobre cerrado para garantizar su trazabilidad física.
                </p>
              </div>

              {/* Grid de Fotos Frente y Dorso */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
                
                {/* FOTO 1: FRENTE */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '10px', padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#ffffff' }}>1. Frente (Código {codigoSobre})</span>
                  </div>

                  {fotoFrentePreview ? (
                    <div style={{ position: 'relative' }}>
                      <img src={fotoFrentePreview} alt="Frente" style={{ width: '100%', height: '130px', objectFit: 'cover', borderRadius: '6px' }} />
                      <button
                        type="button"
                        onClick={() => { setFotoFrente(null); setFotoFrentePreview(null); }}
                        style={{ position: 'absolute', top: '0.4rem', right: '0.4rem', background: 'rgba(239, 68, 68, 0.9)', border: 'none', color: '#ffffff', padding: '0.25rem 0.45rem', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '130px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', cursor: 'pointer' }}>
                      <Camera size={30} style={{ color: '#8e4785', marginBottom: '0.35rem' }} />
                      <span style={{ fontSize: '0.8rem', color: '#ffffff', fontWeight: '600' }}>Tomar Foto Frente</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Código visible</span>
                      <input type="file" accept="image/*" capture="environment" onChange={(e) => handleFotoChange('frente', e)} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>

                {/* FOTO 2: DORSO */}
                <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '10px', padding: '0.75rem', textAlign: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: '700', color: '#ffffff' }}>2. Dorso (Sellado)</span>
                  </div>

                  {fotoDorsoPreview ? (
                    <div style={{ position: 'relative' }}>
                      <img src={fotoDorsoPreview} alt="Dorso" style={{ width: '100%', height: '130px', objectFit: 'cover', borderRadius: '6px' }} />
                      <button
                        type="button"
                        onClick={() => { setFotoDorso(null); setFotoDorsoPreview(null); }}
                        style={{ position: 'absolute', top: '0.4rem', right: '0.4rem', background: 'rgba(239, 68, 68, 0.9)', border: 'none', color: '#ffffff', padding: '0.25rem 0.45rem', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : (
                    <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '130px', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', cursor: 'pointer' }}>
                      <Camera size={30} style={{ color: '#8e4785', marginBottom: '0.35rem' }} />
                      <span style={{ fontSize: '0.8rem', color: '#ffffff', fontWeight: '600' }}>Tomar Foto Dorso</span>
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Cinta visible</span>
                      <input type="file" accept="image/*" capture="environment" onChange={(e) => handleFotoChange('dorso', e)} style={{ display: 'none' }} />
                    </label>
                  )}
                </div>

              </div>

              {/* Selector de Modalidad de Entrega */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  Modalidad de Entrega a LAMDA:
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' }}>
                  <div
                    onClick={() => setModalidadEntrega('CHOFER')}
                    style={{
                      border: modalidadEntrega === 'CHOFER' ? '2px solid #8e4785' : '1px solid rgba(255,255,255,0.1)',
                      background: modalidadEntrega === 'CHOFER' ? 'rgba(142, 71, 133, 0.15)' : 'rgba(255,255,255,0.02)',
                      borderRadius: '8px',
                      padding: '0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem'
                    }}
                  >
                    <Truck size={20} style={{ color: modalidadEntrega === 'CHOFER' ? '#c084fc' : 'var(--text-muted)' }} />
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.85rem', color: '#ffffff' }}>Retiro por Chofer</strong>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>En próxima visita / entrega</span>
                    </div>
                  </div>

                  <div
                    onClick={() => setModalidadEntrega('LOCAL')}
                    style={{
                      border: modalidadEntrega === 'LOCAL' ? '2px solid #8e4785' : '1px solid rgba(255,255,255,0.1)',
                      background: modalidadEntrega === 'LOCAL' ? 'rgba(142, 71, 133, 0.15)' : 'rgba(255,255,255,0.02)',
                      borderRadius: '8px',
                      padding: '0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem'
                    }}
                  >
                    <Store size={20} style={{ color: modalidadEntrega === 'LOCAL' ? '#c084fc' : 'var(--text-muted)' }} />
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.85rem', color: '#ffffff' }}>Entrega en Mostrador</strong>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Lo acerco al local central</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Observaciones opcionales */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                  Observaciones (Opcional):
                </label>
                <input
                  type="text"
                  placeholder="Ej: Lo deja el encargado de turno..."
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem',
                    borderRadius: '6px',
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              {/* Botones de Finalización */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    disabled={subiendo}
                    onClick={() => setStep(3)}
                    style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'var(--text-secondary)', padding: '0.6rem 0.9rem', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }}
                  >
                    <ArrowLeft size={14} /> Ensobrado
                  </button>

                  <button
                    type="button"
                    disabled={subiendo}
                    onClick={handleCancelarOperacion}
                    style={{
                      background: 'none',
                      border: '1px solid rgba(239, 68, 68, 0.35)',
                      color: '#fca5a5',
                      padding: '0.6rem 0.85rem',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    ✕ Cancelar
                  </button>
                </div>

                <button
                  type="button"
                  disabled={subiendo || !fotoFrente || !fotoDorso}
                  onClick={handleFinalizarSobre}
                  style={{
                    background: (!subiendo && fotoFrente && fotoDorso) ? '#16a34a' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    border: 'none',
                    padding: '0.75rem 1.4rem',
                    borderRadius: '8px',
                    fontWeight: '700',
                    fontSize: '0.92rem',
                    cursor: (!subiendo && fotoFrente && fotoDorso) ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    boxShadow: (!subiendo && fotoFrente && fotoDorso) ? '0 4px 14px rgba(22, 163, 74, 0.4)' : 'none'
                  }}
                >
                  {subiendo ? (
                    <>
                      <Loader2 size={16} className="spinner" /> Registrando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} /> Declarar Sobre Listo ({formatCurrency(montoDeclaradoNum)})
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ========================================================================= */}
      {/* VISTA 2: HISTORIAL DE SOBRES DECLARADOS */}
      {/* ========================================================================= */}
      {activeTab === 'historial' && (
        <div>
          {/* Barra de estado y filtro de cancelados */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Sobres registrados: <strong>{sobresVisibles.length}</strong>
            </span>

            {sobresCanceladosCount > 0 && (
              <button
                type="button"
                onClick={() => setMostrarCancelados(!mostrarCancelados)}
                style={{
                  background: 'none',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: 'var(--text-muted)',
                  padding: '0.3rem 0.6rem',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}
              >
                <Filter size={12} /> {mostrarCancelados ? 'Ocultar cancelados' : `Mostrar cancelados (${sobresCanceladosCount})`}
              </button>
            )}
          </div>

          {loadingSobres ? (
            <div className="spinner-container" style={{ padding: '2.5rem 0', textAlign: 'center' }}>
              <Loader2 className="spinner" />
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.4rem', fontSize: '0.85rem' }}>Cargando sobres...</p>
            </div>
          ) : sobresVisibles.length === 0 ? (
            <div style={{ background: 'var(--surface-color, #1e293b)', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '2.5rem 1.25rem', textAlign: 'center' }}>
              <Banknote size={42} style={{ color: 'var(--text-muted)', margin: '0 auto 0.75rem auto' }} />
              <h3 style={{ fontSize: '1.1rem', color: '#ffffff', marginBottom: '0.4rem' }}>No tienes sobres activos</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                Cuando prepares un pago en efectivo ensobrado o se lo derives a un encargado, podrás seguirlo aquí.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setActiveTab('nuevo')}
                  style={{ background: '#8e4785', color: '#ffffff', border: 'none', padding: '0.65rem 1.25rem', borderRadius: '8px', fontWeight: '700', fontSize: '0.88rem', cursor: 'pointer' }}
                >
                  + Preparar Sobre
                </button>
                <button
                  onClick={handleAbrirModalDerivacion}
                  style={{ background: 'rgba(142, 71, 133, 0.25)', border: '1px solid #8e4785', color: '#ffffff', padding: '0.65rem 1.25rem', borderRadius: '8px', fontWeight: '700', fontSize: '0.88rem', cursor: 'pointer' }}
                >
                  👥 Derivar a Colaborador
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.85rem' }}>
              {sobresVisibles.map((s) => {
                const estadoBadge = {
                  'PENDIENTE_ENSOBRADO': { bg: 'rgba(234, 179, 8, 0.15)', color: '#facc15', border: '#eab308', label: '🟡 Pendiente Colaborador' },
                  'PREPARADO': { bg: 'rgba(22, 163, 74, 0.15)', color: '#4ade80', border: '#16a34a', label: '🟢 Listo (Sellado)' },
                  'EN_TRANSITO': { bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: '#3b82f6', label: '🔵 En Chofer' },
                  'RECIBIDO_LOCAL': { bg: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', border: '#a855f7', label: '🟣 En Conteo' },
                  'ACREDITADO': { bg: 'rgba(22, 163, 74, 0.15)', color: '#4ade80', border: '#16a34a', label: '🟢 Acreditado' },
                  'OBSERVADO': { bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '#ef4444', label: '🔴 Observado' },
                  'CANCELADO': { bg: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', border: 'rgba(255,255,255,0.1)', label: '⚪ Cancelado' }
                }[s.estado] || { bg: 'rgba(255,255,255,0.05)', color: '#ffffff', border: 'none', label: s.estado };

                const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                const baseAppUrl = isLocalHost ? 'https://proud-darkness-ac3d.miserrano75.workers.dev' : window.location.origin;
                const linkPublico = s.token_publico ? `${baseAppUrl}/#ensobrado/${s.token_publico}` : '';

                return (
                  <div
                    key={s.id}
                    style={{
                      background: 'var(--surface-color, #1e293b)',
                      border: s.estado === 'PENDIENTE_ENSOBRADO' ? '1px dashed #eab308' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px',
                      padding: '1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      opacity: s.estado === 'CANCELADO' ? 0.6 : 1
                    }}
                  >
                    <div>
                      {/* Cabecera Tarjeta */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.65rem' }}>
                        <div>
                          <strong style={{ fontSize: '1.05rem', color: '#ffffff', display: 'block' }}>{s.codigo_sobre}</strong>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {new Date(s.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>
                        <span style={{
                          background: estadoBadge.bg,
                          color: estadoBadge.color,
                          border: `1px solid ${estadoBadge.border}`,
                          fontSize: '0.72rem',
                          fontWeight: '700',
                          padding: '0.18rem 0.55rem',
                          borderRadius: '5px'
                        }}>
                          {estadoBadge.label}
                        </span>
                      </div>

                      {/* Monto y Modalidad */}
                      <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '0.65rem 0.75rem', marginBottom: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block' }}>
                            {s.estado === 'PENDIENTE_ENSOBRADO' ? 'Monto Solicitado' : 'Monto Declarado'}
                          </span>
                          <strong style={{ fontSize: '1.15rem', color: '#4ade80' }}>
                            {parseFloat(s.monto_declarado) > 0 ? formatCurrency(s.monto_declarado) : 'A definir'}
                          </strong>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'block' }}>Modalidad</span>
                          <strong style={{ fontSize: '0.78rem', color: '#ffffff' }}>
                            {s.modalidad_entrega === 'CHOFER' ? '🚚 Chofer' : '🏬 Local'}
                          </strong>
                        </div>
                      </div>

                      {s.colaborador_nombre && (
                        <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <Users size={13} style={{ color: '#e879f9' }} /> Derivado a: <strong>{s.colaborador_nombre}</strong>
                          </div>
                          {s.colaborador_email && (
                            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: '1.2rem' }}>
                              ✉️ {s.colaborador_email}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Acciones de la Tarjeta */}
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.65rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => handleVerDetalleSobre(s)}
                        style={{ flex: 1, background: 'rgba(255,255,255,0.08)', border: 'none', color: '#ffffff', padding: '0.45rem', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
                      >
                        <Eye size={13} /> Detalle
                      </button>

                      {s.estado === 'PENDIENTE_ENSOBRADO' && linkPublico && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleReenviarEmail(s)}
                            style={{ background: 'rgba(2, 132, 199, 0.15)', border: '1px solid #0284c7', color: '#38bdf8', padding: '0.45rem 0.65rem', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer' }}
                            title="Enviar / Reenviar por Correo Electrónico"
                          >
                            <Mail size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const montoTxt = parseFloat(s.monto_declarado) > 0 ? `$ ${parseFloat(s.monto_declarado).toLocaleString('es-AR')}` : 'el pago';
                              const msg = encodeURIComponent(`Hola *${s.colaborador_nombre || ''}*! Te recordamos el link para preparar el sobre de efectivo por *${montoTxt}*:\n${linkPublico}\nCódigo: *${s.codigo_sobre}*`);
                              const telDest = s.colaborador_telefono ? (s.colaborador_telefono.startsWith('54') ? s.colaborador_telefono : `549${s.colaborador_telefono}`) : '';
                              window.open(`https://api.whatsapp.com/send?${telDest ? `phone=${telDest}&` : ''}text=${msg}`, '_blank');
                            }}
                            style={{ background: 'rgba(37, 211, 102, 0.15)', border: '1px solid #25D366', color: '#25D366', padding: '0.45rem 0.65rem', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer' }}
                            title="Reenviar Link WhatsApp"
                          >
                            <MessageSquare size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(linkPublico);
                              Swal.fire('Copiado', 'Enlace público copiado al portapapeles.', 'info');
                            }}
                            style={{ background: 'rgba(142, 71, 133, 0.2)', border: '1px solid #8e4785', color: '#ffffff', padding: '0.45rem 0.65rem', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer' }}
                            title="Copiar Enlace"
                          >
                            <Copy size={13} />
                          </button>
                        </>
                      )}

                      {s.estado === 'PREPARADO' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCambiarModalidadSobre(s)}
                            style={{ background: 'rgba(142, 71, 133, 0.2)', border: '1px solid #8e4785', color: '#e879f9', padding: '0.45rem 0.65rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                            title={`Cambiar a ${s.modalidad_entrega === 'CHOFER' ? 'Entrega en Local' : 'Retiro por Chofer'}`}
                          >
                            <RefreshCw size={12} /> {s.modalidad_entrega === 'CHOFER' ? 'A Local' : 'A Chofer'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReenviarWhatsApp(s)}
                            style={{ background: 'rgba(37, 211, 102, 0.15)', border: '1px solid #25D366', color: '#25D366', padding: '0.45rem 0.65rem', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer' }}
                            title="Reenviar Aviso a LAMDA por WhatsApp"
                          >
                            <MessageSquare size={13} />
                          </button>
                        </>
                      )}

                      {(s.estado === 'PREPARADO' || s.estado === 'PENDIENTE_ENSOBRADO') && (
                        <button
                          type="button"
                          onClick={() => handleCancelarSobre(s)}
                          style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#ef4444', padding: '0.45rem 0.65rem', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer' }}
                          title="Cancelar Sobre"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}

                      {s.recibo_url && (
                        <button
                          type="button"
                          onClick={() => window.open(s.recibo_url, '_blank')}
                          style={{ background: 'rgba(142, 71, 133, 0.2)', border: '1px solid #8e4785', color: '#ffffff', padding: '0.45rem 0.65rem', borderRadius: '6px', fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <FileText size={13} /> Recibo
                        </button>
                      )}
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
