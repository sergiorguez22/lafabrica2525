// Usuarios de La Fábrica: se guardan en el servidor (Vercel Blob) con la contraseña cifrada (scrypt + sal).
// La contraseña se comprueba aquí; en la página no hay ni contraseñas ni sus versiones cifradas.
// Acciones (POST, JSON): login · nombres · listar · crear · resetear · borrar · migrar

const { put, list, del } = require('@vercel/blob');
const crypto = require('crypto');

const PREFIJO = process.env.USR_PREFIX || 'usuarios/lista/';
const ADMINS = ['SergioRguez'];
const SESION_HORAS = 12;

function clave() { return crypto.createHash('sha256').update('lf-sesion:' + (process.env.BLOB_READ_WRITE_TOKEN || '')).digest(); }
function b64(buf) { return Buffer.from(buf).toString('base64url'); }
function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function esAdmin(u) { return ADMINS.indexOf(u) >= 0; }

function cifrar(password) {
  var sal = crypto.randomBytes(16);
  return 'scrypt$' + sal.toString('hex') + '$' + crypto.scryptSync(String(password), sal, 32).toString('hex');
}
function comprobar(password, guardado) {
  var p = String(guardado || '').split('$');
  try {
    if (p[0] === 'scrypt' && p.length === 3) {
      var esperado = Buffer.from(p[2], 'hex'), dado = crypto.scryptSync(String(password), Buffer.from(p[1], 'hex'), 32);
      return esperado.length === dado.length && crypto.timingSafeEqual(esperado, dado);
    }
    if (p[0] === 'sha256' && p.length === 2) {            // usuarios antiguos creados en el navegador
      var e2 = Buffer.from(p[1], 'hex'), d2 = crypto.createHash('sha256').update(String(password)).digest();
      return e2.length === d2.length && crypto.timingSafeEqual(e2, d2);
    }
  } catch (e) {}
  return false;
}

function crearToken(usuario) {
  var datos = b64(JSON.stringify({ u: usuario, exp: Date.now() + SESION_HORAS * 3600 * 1000 }));
  return datos + '.' + b64(crypto.createHmac('sha256', clave()).update(datos).digest());
}
function leerToken(token) {
  try {
    var p = String(token || '').split('.');
    if (p.length !== 2) return null;
    var firma = Buffer.from(p[1], 'base64url'), buena = crypto.createHmac('sha256', clave()).update(p[0]).digest();
    if (firma.length !== buena.length || !crypto.timingSafeEqual(firma, buena)) return null;
    var d = JSON.parse(Buffer.from(p[0], 'base64url').toString('utf8'));
    return d && d.exp > Date.now() ? d.u : null;
  } catch (e) { return null; }
}

async function leer() {
  var r = await list({ prefix: PREFIJO, limit: 100 });
  var blobs = (r.blobs || []).slice().sort(function (a, b) { return new Date(b.uploadedAt) - new Date(a.uploadedAt); });
  if (!blobs.length) return [];
  var f = await fetch(blobs[0].url, { cache: 'no-store' });
  if (!f.ok) throw new Error('lectura ' + f.status);
  var d = await f.json();
  return Array.isArray(d.usuarios) ? d.usuarios : [];
}
async function guardar(usuarios) {
  await put(PREFIJO + Date.now() + '.json', JSON.stringify({ usuarios: usuarios, actualizado: new Date().toISOString() }), { access: 'public', addRandomSuffix: true, contentType: 'application/json' });
  try {
    var r = await list({ prefix: PREFIJO, limit: 100 });
    var viejos = (r.blobs || []).slice().sort(function (a, b) { return new Date(b.uploadedAt) - new Date(a.uploadedAt); }).slice(3);
    if (viejos.length) await del(viejos.map(function (b) { return b.url; }));
  } catch (e) {}
}
function buscar(usuarios, nombre) {
  var exacto = usuarios.filter(function (u) { return u.usuario === nombre; });
  if (exacto.length) return exacto[0];
  var parecido = usuarios.filter(function (u) { return norm(u.usuario) === norm(nombre); });   // sin distinguir mayúsculas ni tildes
  return parecido.length === 1 ? parecido[0] : null;
}
function publico(u) { return { usuario: u.usuario, nombre: u.nombre || null, creado_por: u.creado_por || null, created_at: u.created_at || null, admin: esAdmin(u.usuario) }; }

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  function fin(codigo, obj) { return res.status(codigo).end(JSON.stringify(obj)); }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fin(405, { error: 'Método no permitido' }); }
  var b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== 'object') return fin(400, { error: 'Formato no válido' });
  try {
    if (b.accion === 'login') {
      var todos = await leer();
      var u = buscar(todos, String(b.usuario || '').slice(0, 60));
      var ok = !!u && comprobar(String(b.password || '').slice(0, 200), u.hash);
      if (!ok) { await new Promise(function (r) { setTimeout(r, 400); }); return fin(401, { ok: false }); }
      if (String(u.hash).indexOf('sha256$') === 0) { u.hash = cifrar(b.password); try { await guardar(todos); } catch (e) {} }   // se mejora el cifrado al entrar
      return fin(200, { ok: true, usuario: u.usuario, admin: esAdmin(u.usuario), token: crearToken(u.usuario) });
    }

    var quien = leerToken(b.token);
    if (!quien) return fin(401, { error: 'Sesión caducada. Vuelve a entrar.' });
    var lista = await leer();
    if (!buscar(lista, quien)) return fin(401, { error: 'Sesión no válida.' });

    if (b.accion === 'nombres') return fin(200, { ok: true, nombres: lista.map(function (x) { return x.usuario; }) });

    if (!esAdmin(quien)) return fin(403, { error: 'Solo el administrador puede gestionar usuarios.' });

    if (b.accion === 'listar') return fin(200, { ok: true, usuarios: lista.map(publico) });

    if (b.accion === 'crear') {
      var nuevo = String(b.usuario || '').trim(), pass = String(b.password || '');
      if (!/^[A-Za-z0-9._-]{3,30}$/.test(nuevo)) return fin(400, { error: 'El usuario solo puede tener letras, números, punto, guion o guion bajo (3-30).' });
      if (pass.length < 6 || pass.length > 200) return fin(400, { error: 'La contraseña debe tener al menos 6 caracteres.' });
      if (lista.some(function (x) { return norm(x.usuario) === norm(nuevo); })) return fin(409, { error: 'Ese usuario ya existe.' });
      var rec = { usuario: nuevo, nombre: String(b.nombre || '').trim().slice(0, 80) || null, hash: cifrar(pass), creado_por: quien, created_at: new Date().toISOString() };
      lista.unshift(rec); await guardar(lista);
      return fin(200, { ok: true, usuario: publico(rec) });
    }

    if (b.accion === 'resetear' || b.accion === 'borrar') {
      var obj = lista.filter(function (x) { return x.usuario === String(b.usuario || ''); })[0];
      if (!obj) return fin(404, { error: 'Ese usuario no existe.' });
      if (b.accion === 'resetear') {
        var np = String(b.password || '');
        if (np.length < 6 || np.length > 200) return fin(400, { error: 'La contraseña debe tener al menos 6 caracteres.' });
        obj.hash = cifrar(np); await guardar(lista);
        return fin(200, { ok: true });
      }
      if (obj.usuario === quien) return fin(400, { error: 'No puedes eliminar tu propio usuario.' });
      if (esAdmin(obj.usuario) && lista.filter(function (x) { return esAdmin(x.usuario); }).length <= 1) return fin(400, { error: 'No se puede eliminar al único administrador.' });
      await guardar(lista.filter(function (x) { return x !== obj; }));
      return fin(200, { ok: true });
    }

    if (b.accion === 'migrar') {                              // usuarios que solo estaban guardados en un navegador
      var entran = (Array.isArray(b.usuarios) ? b.usuarios : []).slice(0, 100), añadidos = [];
      entran.forEach(function (m) {
        var n = String(m && m.usuario || '').trim(), h = String(m && m.hash || '');
        if (!/^[A-Za-z0-9._-]{3,30}$/.test(n) || !/^[a-f0-9]{64}$/.test(h)) return;
        if (lista.some(function (x) { return norm(x.usuario) === norm(n); })) return;
        lista.push({ usuario: n, nombre: String(m.nombre || '').trim().slice(0, 80) || null, hash: 'sha256$' + h, creado_por: String(m.creado_por || quien).slice(0, 40), created_at: m.created_at || new Date().toISOString() });
        añadidos.push(n);
      });
      if (añadidos.length) await guardar(lista);
      return fin(200, { ok: true, añadidos: añadidos });
    }

    return fin(400, { error: 'Acción desconocida' });
  } catch (e) {
    return fin(500, { error: 'No se pudo acceder al almacenamiento', detalle: String(e && e.message || e).slice(0, 200) });
  }
}

module.exports = handler;
module.exports._interno = { cifrar: cifrar, comprobar: comprobar, leer: leer, guardar: guardar, PREFIJO: PREFIJO };
