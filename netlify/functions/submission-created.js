// Se ejecuta automáticamente cada vez que Netlify recibe un envío de formulario.
// Para el Libro de Reclamaciones: asigna el número correlativo de la Hoja de Reclamación
// y envía una copia al correo del consumidor, con copia oculta al proveedor
// (art. 4-B del Reglamento del Libro de Reclamaciones, D.S. 011-2011-PCM).
//
// Variables de entorno (Netlify > Site configuration > Environment variables):
//   RESEND_API_KEY           clave de la API de Resend (resend.com)
//   LR_FROM                  remitente verificado, p. ej. "3VIP Libro de Reclamaciones <reclamaciones@3vip.pe>"
//   LR_BCC                   correo del proveedor que recibe copia de cada hoja
//   LR_PROVEEDOR_NOMBRE      opcional: reemplaza el nombre del proveedor (p. ej., al constituir la empresa)
//   LR_PROVEEDOR_RUC         opcional: reemplaza el RUC
//   LR_PROVEEDOR_DOMICILIO   opcional: reemplaza el domicilio del establecimiento

const FORM = 'libro-reclamaciones';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fila(k, v) {
  return `<tr><td style="border:1px solid #ccc;padding:6px;width:32%;color:#555;">${esc(k)}</td>`
    + `<td style="border:1px solid #ccc;padding:6px;">${esc(v)}</td></tr>`;
}

function tabla(titulo, filas) {
  return `<table style="border-collapse:collapse;width:100%;margin:0 0 14px;font:14px Arial,sans-serif;">`
    + `<tr><th colspan="2" style="text-align:left;background:#eee;padding:6px;">${esc(titulo)}</th></tr>${filas}</table>`;
}

function hojaHtml(d, numero, fecha, prov) {
  const rep = d.menor_de_edad === 'Sí'
    ? fila('Padre, madre o representante', `${d.representante_nombre} · ${d.representante_domicilio} · ${d.representante_telefono} · ${d.representante_email}`)
    : '';
  return `<div style="font:14px Arial,sans-serif;color:#222;max-width:720px;">`
    + `<h2 style="margin:0 0 4px;">LIBRO DE RECLAMACIONES</h2>`
    + `<p style="margin:0 0 12px;"><strong>HOJA DE RECLAMACIÓN N.° ${esc(numero)}</strong><br>`
    + `Fecha y hora: ${esc(fecha)}<br>${esc(prov.nombre)} · RUC ${esc(prov.ruc)}<br>${esc(prov.domicilio)}</p>`
    + tabla('1. Identificación del consumidor reclamante',
      fila('Nombre', d.nombre) + fila('Domicilio', d.domicilio) + fila(d.tipo_documento, d.documento)
      + fila('Teléfono / correo', `${d.telefono} · ${d.email}`) + rep)
    + tabla('2. Identificación del bien contratado',
      fila(d.bien_tipo, d.descripcion_bien) + fila('Monto reclamado', d.monto_reclamado ? `S/ ${d.monto_reclamado}` : '—'))
    + tabla('3. Detalle de la reclamación y pedido del consumidor',
      fila('Tipo', d.tipo) + fila('Detalle', d.detalle) + fila('Pedido', d.pedido)
      + fila('Respuesta por', d.medio_respuesta) + fila('Conformidad del consumidor', 'Sí, declarada al registrar'))
    + tabla('4. Observaciones y acciones adoptadas por el proveedor',
      fila('Observaciones y acciones', '') + fila('Fecha de comunicación de la respuesta', ''))
    + `<p style="font-size:12px;color:#555;">Reclamo: disconformidad relacionada a los productos o servicios. `
    + `Queja: disconformidad no relacionada a los productos o servicios; o malestar o descontento respecto a la atención al público.</p>`
    + `<p style="font-size:12px;color:#555;">La formulación del reclamo no impide acudir a otras vías de solución de controversias `
    + `ni es requisito previo para interponer una denuncia ante el INDECOPI. El proveedor debe dar respuesta al reclamo o queja `
    + `en un plazo no mayor a quince (15) días hábiles, el cual es improrrogable.</p>`
    + `<p style="font-size:12px;color:#555;">Destinatario: consumidor.</p></div>`;
}

exports.handler = async (event) => {
  let payload;
  try {
    ({ payload } = JSON.parse(event.body));
  } catch (e) {
    return { statusCode: 400, body: 'payload inválido' };
  }
  if (!payload || payload.form_name !== FORM) return { statusCode: 200, body: 'otro formulario' };

  const d = payload.data || {};
  const creado = new Date(payload.created_at || Date.now());
  const anio = creado.toLocaleString('en-US', { timeZone: 'America/Lima', year: 'numeric' });
  const numero = `${String(payload.number).padStart(9, '0')}-${anio}`;
  const fecha = creado.toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'long', timeStyle: 'medium' });
  const prov = {
    nombre: process.env.LR_PROVEEDOR_NOMBRE || 'Erik Jonathan Chuquispuma Martinez',
    ruc: process.env.LR_PROVEEDOR_RUC || '10472256276',
    domicilio: process.env.LR_PROVEEDOR_DOMICILIO || 'Establecimiento virtual: https://3vip.pe · Lima, Perú',
  };

  console.log(`Hoja de Reclamación ${numero} registrada el ${fecha}`);

  if (!process.env.RESEND_API_KEY || !process.env.LR_FROM) {
    console.error('Falta configurar RESEND_API_KEY o LR_FROM: no se envió la copia al consumidor');
    return { statusCode: 200, body: 'sin configuración de correo' };
  }

  const destinatarios = [d.email];
  if (d.menor_de_edad === 'Sí' && d.representante_email) destinatarios.push(d.representante_email);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.LR_FROM,
      to: destinatarios.filter(Boolean),
      bcc: process.env.LR_BCC ? [process.env.LR_BCC] : undefined,
      reply_to: process.env.LR_BCC || undefined,
      subject: `Hoja de Reclamación N.° ${numero}`,
      html: hojaHtml(d, numero, fecha, prov),
    }),
  });

  if (!res.ok) {
    console.error(`No se pudo enviar la Hoja ${numero}: ${res.status} ${await res.text()}`);
    return { statusCode: 502, body: 'error al enviar el correo' };
  }
  return { statusCode: 200, body: `Hoja ${numero} enviada` };
};
