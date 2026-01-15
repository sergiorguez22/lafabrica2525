ificaciones · JS
Copiar

const cheerio = require('cheerio');

const COMPETITIONS = {
  'segunda-rfef-g5': {
    url: 'https://futbolme.com/resultados-directo/torneo/segunda-federacion-grupo-5/3061/',
    name: 'Segunda Federación - Grupo 5',
    team: 'Real Madrid C',
    aliases: ['Real Madrid CF C', 'Real Madrid C']
  },
  'primera-rfef-g1': {
    url: 'https://futbolme.com/resultados-directo/torneo/primera-federacion-grupo-1/3055/',
    name: '1ª RFEF - Grupo 1',
    team: 'Castilla',
    aliases: ['Real Madrid Castilla', 'Castilla', 'Real Madrid-Castilla']
  },
  'div-honor-juv-g5': {
    url: 'https://futbolme.com/resultados-directo/torneo/division-de-honor-juvenil-grupo-5/38/',
    name: 'División de Honor Juvenil - Grupo 5',
    team: 'Juvenil A',
    aliases: ['Real Madrid Juvenil A', 'Real Madrid CF Juvenil A', 'Real Madrid']
  },
  'liga-nac-juv-g5': {
    url: 'https://futbolme.com/resultados-directo/torneo/liga-nacional-juvenil-grupo-5/92/',
    name: 'Liga Nacional Juvenil - Grupo 5',
    team: 'Juvenil B',
    aliases: ['Real Madrid Juvenil B', 'Real Madrid CF Juvenil B', 'Real Madrid B']
  },
  'pref-aut-juv-g1': {
    url: 'https://futbolme.com/resultados-directo/torneo/1adivision-aut-grupo-1/4010/',
    name: 'Primera División Autonómica Juvenil - Grupo 1',
    team: 'Juvenil C',
    aliases: ['Real Madrid Juvenil C', 'Real Madrid C Juvenil', 'Real Madrid C']
  }
};

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-ES,es;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}

function parseClasificacion(html, targetTeamAliases) {
  const $ = cheerio.load(html);
  const clasificacion = [];
  let teamPosition = null;
  let teamStats = null;

  $('table tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 9) {
      const pos = parseInt($(cells[0]).text().trim());
      const equipo = $(cells[1]).text().trim().replace(/\s+/g, ' ');
      const pts = parseInt($(cells[2]).text().trim());
      const pj = parseInt($(cells[3]).text().trim());
      const pg = parseInt($(cells[4]).text().trim());
      const pe = parseInt($(cells[5]).text().trim());
      const pp = parseInt($(cells[6]).text().trim());
      const gf = parseInt($(cells[7]).text().trim());
      const gc = parseInt($(cells[8]).text().trim());

      if (!isNaN(pos) && equipo) {
        const entry = { pos, equipo, pj, pg, pe, pp, gf, gc, pts };
        clasificacion.push(entry);

        if (targetTeamAliases.some(alias =>
          equipo.toLowerCase().includes(alias.toLowerCase()) ||
          alias.toLowerCase().includes(equipo.toLowerCase())
        )) {
          teamPosition = pos;
          teamStats = { pj, pg, pe, pp, gf, gc, pts };
        }
      }
    }
  });

  return { clasificacion: clasificacion.sort((a, b) => a.pos - b.pos), teamPosition, teamStats };
}

async function scrapeCompetition(competitionId) {
  const config = COMPETITIONS[competitionId];
  if (!config) throw new Error(`Competición no encontrada: ${competitionId}`);

  const html = await fetchPage(config.url);
  const { clasificacion, teamPosition, teamStats } = parseClasificacion(html, config.aliases);

  return {
    competitionId,
    name: config.name,
    team: config.team,
    timestamp: new Date().toISOString(),
    posicion: teamPosition,
    estadisticas: teamStats,
    clasificacion
  };
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  const { id } = req.query;

  try {
    // Si se pide una competición específica
    if (id && id !== 'all') {
      const data = await scrapeCompetition(id);
      return res.status(200).json(data);
    }

    // Si se piden todas (para La Fábrica)
    const equipos = {};
    const competitionIds = ['segunda-rfef-g5', 'primera-rfef-g1', 'div-honor-juv-g5', 'liga-nac-juv-g5', 'pref-aut-juv-g1'];
    
    for (const compId of competitionIds) {
      try {
        equipos[COMPETITIONS[compId].team] = await scrapeCompetition(compId);
        // Pequeña pausa entre requests
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        equipos[COMPETITIONS[compId].team] = { error: e.message };
      }
    }

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      equipos
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
