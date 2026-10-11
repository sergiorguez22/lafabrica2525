// Mantiene activa la base de datos de Supabase (el plan gratuito la pausa tras ~1 semana sin uso).
// Lo llama a diario el cron de Vercel (vercel.json). Hace una lectura mínima y no devuelve datos.
// La dirección y la clave pública se leen de la propia web publicada, para no duplicarlas aquí.

const WEB = 'https://lafabricarm.vercel.app/index.html';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    var html = await (await fetch(WEB, { cache: 'no-store' })).text();
    var m = /createClient\('([^']+)','([^']+)'\)/.exec(html);
    if (!m) throw new Error('No se encontró la configuración de la base de datos en la web');
    var r = await fetch(m[1] + '/rest/v1/proyecciones?select=equipo&limit=1', { headers: { apikey: m[2], Authorization: 'Bearer ' + m[2] } });
    return res.status(r.ok ? 200 : 502).end(JSON.stringify({ ok: r.ok, estado: r.status, fecha: new Date().toISOString() }));
  } catch (e) {
    return res.status(500).end(JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 200), fecha: new Date().toISOString() }));
  }
};
