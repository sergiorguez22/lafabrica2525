// Calendario importado, compartido entre dispositivos.
// Se guarda como JSON en Vercel Blob (almacén "lafabrica-datos"). Cada guardado crea un archivo nuevo
// (así no hay caché que sirva una versión vieja) y se conservan los 3 últimos como copia.

const { put, list, del } = require('@vercel/blob');

const PREFIJO = process.env.CAL_PREFIX || 'calendario/import-2627/';
const MAX_ITEMS = 2000;
const MAX_BYTES = 600 * 1024;
const CAMPOS_TEXTO = ['equipo', 'rival', 'competicion', 'jornada', 'fecha', 'hora', 'estadio', 'origen'];
const CAMPOS_BOOL = ['local', 'torneo', 'entreno'];

function limpiar(items) {
  if (!Array.isArray(items)) return null;
  return items.slice(0, MAX_ITEMS).map(function (m) {
    var o = {};
    if (!m || typeof m !== 'object') return null;
    CAMPOS_TEXTO.forEach(function (k) { if (m[k] != null) o[k] = String(m[k]).slice(0, 160); });
    CAMPOS_BOOL.forEach(function (k) { if (m[k]) o[k] = true; });
    if (!o.local) o.local = false;
    return (o.equipo || o.rival) && /^\d{2}\/\d{2}\/\d{4}$/.test(o.fecha || '') ? o : null;
  }).filter(Boolean);
}

async function ultimo() {
  var r = await list({ prefix: PREFIJO, limit: 100 });
  var blobs = (r.blobs || []).slice().sort(function (a, b) { return new Date(b.uploadedAt) - new Date(a.uploadedAt); });
  return { actual: blobs[0] || null, antiguos: blobs.slice(3) };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    if (req.method === 'GET') {
      var u = await ultimo();
      if (!u.actual) return res.status(200).end(JSON.stringify({ items: [], actualizado: null }));
      var f = await fetch(u.actual.url, { cache: 'no-store' });
      if (!f.ok) throw new Error('lectura ' + f.status);
      var data = await f.json();
      return res.status(200).end(JSON.stringify({ items: data.items || [], actualizado: data.actualizado || null, por: data.por || '' }));
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      var body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      var items = body ? limpiar(body.items) : null;
      if (!items) return res.status(400).end(JSON.stringify({ error: 'Formato no válido' }));
      var datos = { items: items, actualizado: new Date().toISOString(), por: String(body.por || '').slice(0, 40) };
      var texto = JSON.stringify(datos);
      if (Buffer.byteLength(texto) > MAX_BYTES) return res.status(413).end(JSON.stringify({ error: 'Demasiados datos' }));
      await put(PREFIJO + Date.now() + '.json', texto, { access: 'public', addRandomSuffix: true, contentType: 'application/json' });
      try { var v = await ultimo(); if (v.antiguos.length) await del(v.antiguos.map(function (b) { return b.url; })); } catch (e) {}
      return res.status(200).end(JSON.stringify({ ok: true, n: items.length, actualizado: datos.actualizado }));
    }
    res.setHeader('Allow', 'GET, PUT, POST');
    return res.status(405).end(JSON.stringify({ error: 'Método no permitido' }));
  } catch (e) {
    return res.status(500).end(JSON.stringify({ error: 'No se pudo acceder al almacenamiento', detalle: String(e && e.message || e).slice(0, 200) }));
  }
};
