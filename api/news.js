// Noticias de la cantera del Real Madrid, leídas en el servidor (sin proxies de terceros).
// Fuentes: Google Noticias (búsqueda de los últimos 30 días) y el RSS de cantera de Bernabéu Digital.

const QUERY = '"Real Madrid" (cantera OR Castilla OR "Juvenil A" OR "Real Madrid C" OR "La Fábrica" OR "Youth League") when:30d';

const FEEDS = [
  { url: 'https://news.google.com/rss/search?q=' + encodeURIComponent(QUERY) + '&hl=es&gl=ES&ceid=ES:es', fuente: null },
  { url: 'https://www.bernabeudigital.com/rss/?section=4', fuente: 'Bernabéu Digital' }
];

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
    .replace(/&amp;/g, '&');
}
function stripHtml(s) { return decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function tag(xml, name) {
  var m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}
function fmtDate(d) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

async function fetchText(url) {
  var ctrl = new AbortController();
  var t = setTimeout(function () { ctrl.abort(); }, 8000);
  try {
    var r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LaFabricaBot/1.0)', 'Accept': 'application/rss+xml, application/xml, text/xml' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

function parseFeed(xml, fuenteFija) {
  var items = [];
  var parts = xml.split(/<item[\s>]/i).slice(1);
  parts.forEach(function (raw) {
    var it = raw.split(/<\/item>/i)[0];
    var titulo = stripHtml(tag(it, 'title'));
    var url = stripHtml(tag(it, 'link'));
    var fecha = new Date(stripHtml(tag(it, 'pubDate')));
    var fuente = fuenteFija || stripHtml(tag(it, 'source'));
    if (!fuenteFija && fuente && titulo.endsWith(' - ' + fuente)) titulo = titulo.slice(0, -(' - ' + fuente).length);
    var resumen = stripHtml(tag(it, 'description'));
    if (!fuenteFija) resumen = ''; // en Google Noticias la descripción solo repite el titular
    if (resumen.length > 180) resumen = resumen.slice(0, 177) + '...';
    if (!titulo || !url || isNaN(fecha)) return;
    items.push({ titulo: titulo, url: url, fecha: fmtDate(fecha), ts: fecha.getTime(), fuente: fuente || 'Prensa', resumen: resumen });
  });
  return items;
}

module.exports = async function handler(req, res) {
  var all = [];
  var errores = [];
  await Promise.all(FEEDS.map(async function (f) {
    try { var parsed = parseFeed(await fetchText(f.url), f.fuente); Array.prototype.push.apply(all, parsed); }
    catch (e) { errores.push(f.url.split('/')[2] + ': ' + e.message); }
  }));
  var seen = {};
  var items = all
    .sort(function (a, b) { return b.ts - a.ts; })
    .filter(function (it) {
      var k = it.titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 60);
      if (seen[k]) return false; seen[k] = true; return true;
    })
    .slice(0, 40);
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(items.length ? 200 : 502).end(JSON.stringify({ status: items.length ? 'ok' : 'error', actualizado: new Date().toISOString(), errores: errores, items: items }));
};
