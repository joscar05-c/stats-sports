import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ESPN_BASE = "https://site.api.espn.com/apis";
const EXTERNAL_SOURCE = "espn";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const LEAGUE_CATALOG: Record<
  string,
  { slug: string; name: string; short_name: string; country: string; logo_url: string }
> = {
  "eng.1": {
    slug: "premier-league",
    name: "English Premier League",
    short_name: "Premier League",
    country: "Inglaterra",
    logo_url: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
  },
  "esp.1": {
    slug: "laliga",
    name: "Spanish LALIGA",
    short_name: "LaLiga",
    country: "España",
    logo_url: "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png",
  },
  "ita.1": {
    slug: "serie-a",
    name: "Italian Serie A",
    short_name: "Serie A",
    country: "Italia",
    logo_url: "https://a.espncdn.com/i/leaguelogos/soccer/500/12.png",
  },
  "ger.1": {
    slug: "bundesliga",
    name: "German Bundesliga",
    short_name: "Bundesliga",
    country: "Alemania",
    logo_url: "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png",
  },
  "fra.1": {
    slug: "ligue-1",
    name: "French Ligue 1",
    short_name: "Ligue 1",
    country: "Francia",
    logo_url: "https://a.espncdn.com/i/leaguelogos/soccer/500/9.png",
  },
  "uefa.champions": {
    slug: "champions-league",
    name: "UEFA Champions League",
    short_name: "Champions League",
    country: "Europa",
    logo_url: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png",
  },
};

function safeInt(val: unknown, def = 0): number {
  if (val === null || val === undefined || val === "" || val === "--") return def;
  const s = String(val).trim().replace(/^\+/, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : def;
}

function safeFloat(val: unknown): number | null {
  if (val === null || val === undefined || val === "" || val === "--" || val === "-") return null;
  const n = Number(String(val).trim().replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

function parseLineNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "" || val === "--") return null;
  let s = String(val).trim();
  if (!s) return null;
  if (s.toUpperCase() === "PK" || s.toUpperCase() === "EVEN") return 0.0;
  if (/^[ouOU]/.test(s)) s = s.slice(1);
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseAmericanOdds(val: unknown): number | null {
  if (val === null || val === undefined || val === "" || val === "--") return null;
  const s = String(val).trim().toUpperCase();
  if (!s) return null;
  if (s === "EVEN") return 100;
  const n = Number(s.replace(/^\+/, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function normalizeColor(hexVal?: string | null): string | null {
  if (!hexVal) return null;
  const c = hexVal.trim().replace(/^#/, "");
  return c.length === 3 || c.length === 6 ? `#${c.toLowerCase()}` : null;
}

function mapMatchStatus(statusObj: any): [string, string] {
  const stType = statusObj?.type ?? {};
  const state = stType.state ?? "pre";
  const name = String(stType.name ?? "");
  const detail = String(stType.shortDetail || stType.detail || "");
  if (name.includes("POSTPONED") || name.includes("CANCELED")) return ["postponed", detail];
  if (state === "in") return ["live", detail];
  if (state === "post" || stType.completed) return ["final", detail];
  return ["scheduled", detail];
}

function extractSoccerOdds(oddsList?: any[] | null): Record<string, any> | null {
  const entry = Array.isArray(oddsList) && oddsList.length > 0 ? oddsList[0] : null;
  if (!entry || typeof entry !== "object") return null;
  const prov = entry.provider ?? {};
  const ps = entry.pointSpread ?? {};
  const homePs = ps.home ?? {};
  const awayPs = ps.away ?? {};
  const tot = entry.total ?? {};
  const overTot = tot.over ?? {};
  const underTot = tot.under ?? {};
  const ml = entry.moneyline ?? {};
  const homeMl = ml.home ?? {};
  const awayMl = ml.away ?? {};
  const drawMl = ml.draw ?? {};
  const drawOddsObj = entry.drawOdds ?? {};

  const payload: Record<string, any> = {
    provider: prov.displayName || prov.name || "Sportsbook",
    details: entry.details ?? null,
    home_spread: parseLineNum(homePs?.close?.line),
    away_spread: parseLineNum(awayPs?.close?.line),
    open_home_spread: parseLineNum(homePs?.open?.line),
    home_spread_odds: parseAmericanOdds(homePs?.close?.odds),
    away_spread_odds: parseAmericanOdds(awayPs?.close?.odds),
    over_under: parseLineNum(overTot?.close?.line) ?? safeFloat(entry.overUnder),
    open_over_under: parseLineNum(overTot?.open?.line),
    over_odds: parseAmericanOdds(overTot?.close?.odds),
    under_odds: parseAmericanOdds(underTot?.close?.odds),
    home_moneyline: parseAmericanOdds(homeMl?.close?.odds),
    away_moneyline: parseAmericanOdds(awayMl?.close?.odds),
    draw_moneyline: parseAmericanOdds(drawMl?.close?.odds) ?? parseAmericanOdds(drawOddsObj.moneyLine),
    open_home_moneyline: parseAmericanOdds(homeMl?.open?.odds),
    open_away_moneyline: parseAmericanOdds(awayMl?.open?.odds),
  };
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== null && v !== undefined) cleaned[k] = v;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

function extractTeamMatchStats(statList: any[]): Record<string, any> {
  const smap: Record<string, any> = {};
  for (const s of statList ?? []) {
    if (s?.name) smap[s.name] = s.displayValue;
  }
  return {
    possession_pct: safeFloat(smap.possessionPct),
    shots: safeInt(smap.totalShots, 0),
    shots_on_target: safeInt(smap.shotsOnTarget, 0),
    corners: safeInt(smap.wonCorners, 0),
    fouls: safeInt(smap.foulsCommitted, 0),
    yellow_cards: safeInt(smap.yellowCards, 0),
    red_cards: safeInt(smap.redCards, 0),
    offsides: safeInt(smap.offsides, 0),
    saves: safeInt(smap.saves, 0),
    shot_pct: safeFloat(smap.shotPct),
  };
}

function extractKeyEvents(rawEvents: any[]): any[] {
  const out: any[] = [];
  for (const ev of rawEvents ?? []) {
    const etype = String(ev?.type?.text ?? "").trim();
    if (!etype) continue;
    const low = etype.toLowerCase();
    let kind: string | null = null;
    if (low.includes("own goal")) kind = "own_goal";
    else if (low.includes("penalty") && low.includes("scored")) kind = "penalty";
    else if (low.includes("goal") && !low.includes("missed")) kind = "goal";
    else if (low.includes("red card")) kind = "red";
    else if (low.includes("yellow card")) kind = "yellow";
    if (!kind) continue;

    const participants = ev?.participants ?? [];
    out.push({
      kind,
      label: etype,
      minute: String(ev?.clock?.displayValue ?? ""),
      team_abbr: ev?.team?.abbreviation ?? null,
      player: participants[0]?.athlete?.displayName ?? null,
      assist: participants[1]?.athlete?.displayName ?? null,
    });
  }
  return out;
}

function normalizePersonName(val?: string | null): string {
  if (!val) return "";
  return val
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FPL_TO_ESPN_ABBR: Record<string, string> = {
  MCI: "MNC",
  MUN: "MAN",
};

async function buildFplPhotoResolver(
  leagueCode: string,
): Promise<(fullName: string, teamAbbr?: string | null) => string | null> {
  if (leagueCode !== "eng.1" && leagueCode !== "uefa.champions") return () => null;
  try {
    const fpl = await fetchJson("https://fantasy.premierleague.com/api/bootstrap-static/");
    const teamAbbrById: Record<number, string> = {};
    for (const t of fpl?.teams ?? []) {
      const abbr = String(t?.short_name ?? "").toUpperCase();
      if (t?.id && abbr) teamAbbrById[Number(t.id)] = FPL_TO_ESPN_ABBR[abbr] ?? abbr;
    }

    const byTeamFull = new Map<string, string>();
    const byTeamWeb = new Map<string, string>();
    const byTeamLast = new Map<string, string[]>();
    const byGlobalFull = new Map<string, string>();

    for (const el of fpl?.elements ?? []) {
      const code = el?.code;
      if (!code) continue;
      const url = `https://resources.premierleague.com/premierleague25/photos/players/110x140/${code}.png`;
      const abbr = teamAbbrById[Number(el.team)] ?? "";
      const full = normalizePersonName(`${el.first_name ?? ""} ${el.second_name ?? ""}`);
      const web = normalizePersonName(el.web_name);
      const sec = normalizePersonName(el.second_name);

      if (abbr && full) byTeamFull.set(`${abbr}|${full}`, url);
      if (abbr && web) byTeamWeb.set(`${abbr}|${web}`, url);
      if (full && !byGlobalFull.has(full)) byGlobalFull.set(full, url);
      if (abbr && sec) {
        const lastTok = sec.split(" ").pop() ?? sec;
        const key = `${abbr}|${lastTok}`;
        const arr = byTeamLast.get(key) ?? [];
        arr.push(url);
        byTeamLast.set(key, arr);
      }
    }

    return (fullName: string, teamAbbr?: string | null): string | null => {
      const nFull = normalizePersonName(fullName);
      if (!nFull) return null;
      const abbr = (teamAbbr ?? "").toUpperCase();
      if (abbr) {
        const exact = byTeamFull.get(`${abbr}|${nFull}`) ?? byTeamWeb.get(`${abbr}|${nFull}`);
        if (exact) return exact;
        const toks = nFull.split(" ");
        const lastTok = toks[toks.length - 1];
        const firstLast = toks.length >= 2 ? `${toks[0]} ${lastTok}` : nFull;
        const flMatch = byTeamFull.get(`${abbr}|${firstLast}`);
        if (flMatch) return flMatch;
        const lastCandidates = byTeamLast.get(`${abbr}|${lastTok}`) ?? [];
        if (lastCandidates.length === 1) return lastCandidates[0];
        // Also try prefix match inside same team (e.g. "Gabriel Martinelli" vs "Gabriel")
        for (const [k, u] of byTeamFull.entries()) {
          if (!k.startsWith(`${abbr}|`)) continue;
          const kName = k.slice(abbr.length + 1);
          if (kName.includes(nFull) || nFull.includes(kName)) return u;
        }
      }
      return byGlobalFull.get(nFull) ?? null;
    };
  } catch {
    return () => null;
  }
}

async function fetchJson(url: string): Promise<any> {
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "CourtVisionStats/1.0 (+https://github.com)",
      Accept: "application/json",
    },
  });
  if (!resp.ok) throw new Error(`ESPN HTTP ${resp.status} for ${url}`);
  return await resp.json();
}

class SupabaseRest {
  base: string;
  key: string;
  constructor(url: string, serviceKey: string) {
    this.base = url.replace(/\/$/, "") + "/rest/v1";
    this.key = serviceKey;
  }

  async request(method: string, path: string, body?: any, extraHeaders?: Record<string, string>): Promise<any> {
    const headers: Record<string, string> = {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(extraHeaders ?? {}),
    };
    const resp = await fetch(`${this.base}/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Supabase REST ${method} ${path} -> ${resp.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }

  async selectAll(table: string, params = ""): Promise<any[]> {
    const rows: any[] = [];
    let offset = 0;
    const limit = 1000;
    while (true) {
      const sep = params ? "&" : "";
      const chunk =
        (await this.request("GET", `${table}?${params}${sep}limit=${limit}&offset=${offset}`, undefined, {
          Prefer: "count=none",
        })) ?? [];
      rows.push(...chunk);
      if (chunk.length < limit) break;
      offset += limit;
    }
    return rows;
  }

  async upsertOnConflict(table: string, rows: any[], onConflict: string, batch = 300): Promise<any[]> {
    const out: any[] = [];
    for (let i = 0; i < rows.length; i += batch) {
      const chunk = rows.slice(i, i + batch);
      const res = await this.request(
        "POST",
        `${table}?on_conflict=${encodeURIComponent(onConflict)}`,
        chunk,
        { Prefer: "resolution=merge-duplicates,return=representation" },
      );
      if (Array.isArray(res)) out.push(...res);
    }
    return out;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const sbUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!sbUrl || !sbKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const reqUrl = new URL(req.url);
    let bodyParams: Record<string, any> = {};
    if (req.method === "POST") {
      try {
        bodyParams = await req.json();
      } catch {
        bodyParams = {};
      }
    }

    const leagueCode = String(bodyParams.league ?? reqUrl.searchParams.get("league") ?? "eng.1");
    const meta = LEAGUE_CATALOG[leagueCode];
    if (!meta) {
      return new Response(JSON.stringify({ ok: false, error: `Unsupported league: ${leagueCode}` }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const backfillSeason = Boolean(bodyParams.backfill_season ?? false);
    const daysBack = Math.min(120, Math.max(0, safeInt(bodyParams.days_back ?? reqUrl.searchParams.get("days_back"), 5)));
    const daysAhead = Math.min(21, Math.max(0, safeInt(bodyParams.days_ahead ?? reqUrl.searchParams.get("days_ahead"), 14)));

    const sb = new SupabaseRest(sbUrl, sbKey);
    const nowIso = new Date().toISOString();

    const [teamsJson, standingsJson, defaultSb] = await Promise.all([
      fetchJson(`${ESPN_BASE}/site/v2/sports/soccer/${leagueCode}/teams`),
      fetchJson(`${ESPN_BASE}/v2/sports/soccer/${leagueCode}/standings`),
      fetchJson(`${ESPN_BASE}/site/v2/sports/soccer/${leagueCode}/scoreboard`),
    ]);

    let seasonYear = 2026;
    let seasonName = "2026-27";
    const s0 = standingsJson?.seasons?.[0];
    if (s0) {
      seasonYear = safeInt(s0.year, seasonYear);
      seasonName = s0.seasonYears || s0.displayName || seasonName;
    }

    const leagueRows = await sb.upsertOnConflict(
      "leagues",
      [
        {
          slug: meta.slug,
          name: meta.name,
          short_name: meta.short_name,
          country: meta.country,
          sport: "football",
          source_type: "api",
          external_source: EXTERNAL_SOURCE,
          external_id: leagueCode,
          logo_url: meta.logo_url,
          is_public: true,
        },
      ],
      "slug",
    );
    const leagueId = leagueRows[0].id;

    const seasonRows = await sb.upsertOnConflict(
      "seasons",
      [{ league_id: leagueId, name: seasonName, season_year: seasonYear, is_current: true }],
      "league_id,season_year",
    );
    const seasonId = seasonRows[0].id;

    // Teams upsert
    const existingTeams = await sb.selectAll(
      "teams",
      `league_id=eq.${leagueId}&external_source=eq.${EXTERNAL_SOURCE}&select=id,external_id`,
    );
    const teamIdMap: Record<string, number> = {};
    for (const r of existingTeams) {
      if (r.external_id) teamIdMap[String(r.external_id)] = r.id;
    }

    const rawTeams: any[] = teamsJson?.sports?.[0]?.leagues?.[0]?.teams ?? [];
    const validTeamIds = new Set<string>();
    const teamAbbrByExtId: Record<string, string> = {};
    const newTeams: any[] = [];
    const teamUpdates: Array<{ id: number; payload: any }> = [];

    for (const item of rawTeams) {
      const t = item?.team ?? {};
      const tid = String(t.id ?? "");
      if (!tid) continue;
      validTeamIds.add(tid);
      const abbr = t.abbreviation || tid.slice(0, 3).toUpperCase();
      teamAbbrByExtId[tid] = abbr;
      const payload = {
        league_id: leagueId,
        external_source: EXTERNAL_SOURCE,
        external_id: tid,
        name: t.displayName || t.name || tid,
        short_name: t.shortDisplayName || t.nickname || t.name || tid,
        abbreviation: abbr,
        city: t.location ?? null,
        primary_color: normalizeColor(t.color),
        alternate_color: normalizeColor(t.alternateColor),
        logo_url: t.logos?.[0]?.href ?? null,
        is_active: true,
      };
      if (teamIdMap[tid]) teamUpdates.push({ id: teamIdMap[tid], payload });
      else newTeams.push(payload);
    }

    await Promise.all(
      teamUpdates.map((u) => sb.request("PATCH", `teams?id=eq.${u.id}`, u.payload, { Prefer: "return=minimal" })),
    );
    if (newTeams.length > 0) {
      const inserted = await sb.request("POST", "teams", newTeams);
      for (const r of inserted ?? []) teamIdMap[String(r.external_id)] = r.id;
    }

    // Standings upsert
    const standingPayloads: any[] = [];
    for (const child of standingsJson?.children ?? []) {
      for (const entry of child?.standings?.entries ?? []) {
        const tidExt = String(entry?.team?.id ?? "");
        const tid = teamIdMap[tidExt];
        if (!tid) continue;
        const smap: Record<string, any> = {};
        for (const s of entry?.stats ?? []) {
          if (s?.name) smap[s.name] = s.displayValue ?? s.value;
        }
        const played = safeInt(smap.gamesPlayed, 0);
        const wins = safeInt(smap.wins, 0);
        const draws = safeInt(smap.ties, 0);
        const losses = safeInt(smap.losses, 0);
        const points = safeInt(smap.points, 0);
        const gf = safeInt(smap.pointsFor, 0);
        const ga = safeInt(smap.pointsAgainst, 0);
        const gd = safeInt(smap.pointDifferential, gf - ga);
        const rank = safeInt(smap.rank, 0) || null;
        const winPct = played > 0 ? Number(((wins + 0.5 * draws) / played).toFixed(3)) : 0;
        standingPayloads.push({
          league_id: leagueId,
          season_id: seasonId,
          team_id: tid,
          conference: null,
          playoff_seed: rank,
          played,
          wins,
          draws,
          losses,
          points,
          goals_for: gf,
          goals_against: ga,
          goal_diff: gd,
          win_pct: winPct,
          ppg: played > 0 ? Number((gf / played).toFixed(2)) : 0,
          oppg: played > 0 ? Number((ga / played).toFixed(2)) : 0,
          diff: gd,
          updated_at: nowIso,
        });
      }
    }
    if (standingPayloads.length > 0) {
      await sb.upsertOnConflict("team_standings", standingPayloads, "season_id,team_id");
    }

    // Players lookup
    const existingPlayers = await sb.selectAll(
      "players",
      `league_id=eq.${leagueId}&external_source=eq.${EXTERNAL_SOURCE}&select=id,external_id,full_name,team_id,headshot_url`,
    );
    const playerIdMap: Record<string, number> = {};
    const teamAbbrByDbId: Record<number, string> = {};
    for (const [extId, dbId] of Object.entries(teamIdMap)) {
      if (teamAbbrByExtId[extId]) teamAbbrByDbId[dbId] = teamAbbrByExtId[extId];
    }
    for (const r of existingPlayers) {
      if (r.external_id) playerIdMap[String(r.external_id)] = r.id;
    }

    const resolveFplPhoto = await buildFplPhotoResolver(leagueCode);

    const discoveredPlayers: Record<string, any> = {};

    // Fetch full squad rosters if league has no players yet or explicit sync_rosters requested
    if (existingPlayers.length === 0 || bodyParams.sync_rosters) {
      const extIds = Array.from(validTeamIds);
      for (let i = 0; i < extIds.length; i += 10) {
        const batch = extIds.slice(i, i + 10);
        await Promise.all(
          batch.map(async (extTid) => {
            try {
              const rj = await fetchJson(`${ESPN_BASE}/site/v2/sports/soccer/${leagueCode}/teams/${extTid}/roster`);
              for (const ath of rj?.athletes ?? []) {
                const pid = String(ath?.id ?? "");
                if (!pid) continue;
                discoveredPlayers[pid] = {
                  external_source: EXTERNAL_SOURCE,
                  external_id: pid,
                  team_external_id: extTid,
                  first_name: ath.firstName ?? null,
                  last_name: ath.lastName ?? null,
                  full_name: ath.displayName || ath.fullName || `Player ${pid}`,
                  jersey_number: ath.jersey !== undefined && ath.jersey !== null ? String(ath.jersey) : null,
                  position: ath?.position?.abbreviation ?? ath?.position?.name ?? null,
                  height_display: ath.displayHeight ?? null,
                  weight_display: ath.displayWeight ?? null,
                  age: safeInt(ath.age, 0) || null,
                  country: ath?.citizenshipCountry?.abbreviation ?? ath?.citizenship ?? null,
                  headshot_url: ath?.headshot?.href ?? null,
                  status: "active",
                  is_active: true,
                };
              }
            } catch {
              // ignore individual roster error
            }
          }),
        );
      }
    }

    // Calendar matchdays within range
    const nowPetMs = Date.now() - 5 * 3600 * 1000;
    const todayStr = new Date(nowPetMs).toISOString().slice(0, 10);
    const minStr = backfillSeason
      ? `${seasonYear}-07-01`
      : new Date(nowPetMs - daysBack * 86400000).toISOString().slice(0, 10);
    const maxStr = new Date(nowPetMs + daysAhead * 86400000).toISOString().slice(0, 10);

    const calRaw: any[] = defaultSb?.leagues?.[0]?.calendar ?? [];
    const targetDates: string[] = [];
    const seenDates = new Set<string>();
    for (const c of calRaw) {
      if (typeof c !== "string") continue;
      const dStr = c.slice(0, 10);
      if (dStr.length !== 10 || seenDates.has(dStr)) continue;
      if (dStr >= minStr && dStr <= maxStr) {
        seenDates.add(dStr);
        targetDates.push(dStr);
      }
    }
    if (targetDates.length === 0) {
      // Structured calendar (e.g. UEFA Champions League): scan window dates (Tue-Thu for UCL backfill)
      const startDateStr = backfillSeason ? `${seasonYear}-09-01` : minStr;
      let cursor = new Date(`${startDateStr}T12:00:00Z`).getTime();
      const endMs = new Date(`${maxStr}T12:00:00Z`).getTime();
      while (cursor <= endMs) {
        const dt = new Date(cursor);
        const dow = dt.getUTCDay(); // 0=Sun..6=Sat
        const dStr = dt.toISOString().slice(0, 10);
        if (!backfillSeason || leagueCode !== "uefa.champions" || dow === 2 || dow === 3 || dow === 4) {
          targetDates.push(dStr);
        }
        cursor += 86400000;
      }
      if (targetDates.length === 0) targetDates.push(todayStr);
    }

    const gamesByExt: Record<string, any> = {};
    for (let i = 0; i < targetDates.length; i += 10) {
      const batch = targetDates.slice(i, i + 10);
      const sbList = await Promise.all(
        batch.map(async (dStr) => {
          const ymd = dStr.replace(/-/g, "");
          const sbJson = await fetchJson(`${ESPN_BASE}/site/v2/sports/soccer/${leagueCode}/scoreboard?dates=${ymd}`);
          return { dStr, sbJson };
        }),
      );
      for (const { dStr, sbJson } of sbList) {
        for (const ev of sbJson?.events ?? []) {
          const evId = String(ev?.id ?? "");
          if (!evId) continue;
          const comp = ev?.competitions?.[0];
          if (!comp) continue;
          const competitors: any[] = comp.competitors ?? [];
          const home = competitors.find((c) => c.homeAway === "home");
          const away = competitors.find((c) => c.homeAway === "away");
          if (!home || !away) continue;
          const htExt = String(home?.team?.id ?? "");
          const atExt = String(away?.team?.id ?? "");
          if (!validTeamIds.has(htExt) || !validTeamIds.has(atExt)) continue;

          const stObj = comp.status || ev.status || {};
          const [status, statusDetail] = mapMatchStatus(stObj);
          const tipoffAt = ev.date || `${dStr}T00:00:00Z`;
          let localDate = dStr;
          try {
            localDate = new Date(new Date(tipoffAt).getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
          } catch {
            localDate = dStr;
          }

          gamesByExt[evId] = {
            external_source: EXTERNAL_SOURCE,
            external_id: evId,
            game_date: localDate,
            tipoff_at: tipoffAt,
            status,
            status_detail: statusDetail,
            period: safeInt(stObj.period, 0),
            clock: stObj.displayClock ?? null,
            home_team_ext_id: htExt,
            away_team_ext_id: atExt,
            home_score: safeInt(home.score, 0),
            away_score: safeInt(away.score, 0),
            venue: comp?.venue?.fullName ?? null,
            odds: extractSoccerOdds(comp.odds),
            sport_stats: null,
          };
        }
      }
    }

    // Summaries for final/live matches
    const toSummarize = Object.values(gamesByExt).filter((g) => g.status === "final" || g.status === "live");
    const statsRows: any[] = [];
    for (let i = 0; i < toSummarize.length; i += 10) {
      const batch = toSummarize.slice(i, i + 10);
      const batchStats = await Promise.all(
        batch.map(async (g) => {
          const eid = g.external_id;
          let summ: any = null;
          try {
            summ = await fetchJson(`${ESPN_BASE}/site/v2/sports/soccer/${leagueCode}/summary?event=${eid}`);
          } catch {
            return [];
          }
          const pickOdds = extractSoccerOdds(summ?.odds ?? summ?.pickcenter);
          if (pickOdds) g.odds = { ...(g.odds ?? {}), ...pickOdds };

          let homeStats: any = {};
          let awayStats: any = {};
          for (const bt of summ?.boxscore?.teams ?? []) {
            const tid = String(bt?.team?.id ?? "");
            const parsed = extractTeamMatchStats(bt?.statistics ?? []);
            if (tid === g.home_team_ext_id) homeStats = parsed;
            else if (tid === g.away_team_ext_id) awayStats = parsed;
          }
          const keyEvents = extractKeyEvents(summ?.keyEvents ?? []);
          if (Object.keys(homeStats).length > 0 || Object.keys(awayStats).length > 0 || keyEvents.length > 0) {
            g.sport_stats = { home: homeStats, away: awayStats, events: keyEvents };
          }

          const out: any[] = [];
          for (const ros of summ?.rosters ?? []) {
            const tid = String(ros?.team?.id ?? "");
            if (!validTeamIds.has(tid)) continue;
            for (const prow of ros?.roster ?? []) {
              const ath = prow?.athlete ?? {};
              const pid = String(ath?.id ?? "");
              if (!pid) continue;
              if (!discoveredPlayers[pid]) {
                discoveredPlayers[pid] = {
                  external_source: EXTERNAL_SOURCE,
                  external_id: pid,
                  team_external_id: tid,
                  first_name: ath.firstName ?? null,
                  last_name: ath.lastName ?? null,
                  full_name: ath.displayName || ath.shortName || `Player ${pid}`,
                  jersey_number: prow.jersey !== undefined && prow.jersey !== null ? String(prow.jersey) : null,
                  position: prow?.position?.abbreviation ?? null,
                  headshot_url: ath?.headshot?.href ?? null,
                  status: "active",
                  is_active: true,
                };
              }
              const smap: Record<string, number> = {};
              for (const s of prow?.stats ?? []) {
                if (s?.name) smap[s.name] = safeInt(s.value, 0);
              }
              const appearances = smap.appearances ?? 0;
              const subIns = smap.subIns ?? 0;
              const isStarter = Boolean(prow.starter);
              const dnp = appearances === 0 && subIns === 0 && !isStarter;
              const mins = dnp ? 0 : isStarter ? 90 : 25;
              out.push({
                game_external_id: eid,
                team_external_id: tid,
                player_external_id: pid,
                minutes: mins,
                starter: isStarter,
                did_not_play: dnp,
                dnp_reason: dnp ? "Suplente sin minutos" : null,
                sport_stats: {
                  appearances,
                  sub_ins: subIns,
                  goals: smap.totalGoals ?? 0,
                  assists: smap.goalAssists ?? 0,
                  shots: smap.totalShots ?? 0,
                  shots_on_target: smap.shotsOnTarget ?? 0,
                  yellow_cards: smap.yellowCards ?? 0,
                  red_cards: smap.redCards ?? 0,
                  fouls_committed: smap.foulsCommitted ?? 0,
                  fouls_suffered: smap.foulsSuffered ?? 0,
                  saves: smap.saves ?? 0,
                  shots_faced: smap.shotsFaced ?? 0,
                  goals_conceded: smap.goalsConceded ?? 0,
                  own_goals: smap.ownGoals ?? 0,
                },
              });
            }
          }
          return out;
        }),
      );
      for (const rows of batchStats) statsRows.push(...rows);
    }

    // Insert newly discovered players & fill missing Premier League headshots
    const newPlayers: any[] = [];
    for (const p of Object.values(discoveredPlayers)) {
      if (!playerIdMap[p.external_id]) {
        const abbr = teamAbbrByExtId[p.team_external_id] ?? null;
        const resolvedPhoto = p.headshot_url ?? resolveFplPhoto(p.full_name, abbr);
        newPlayers.push({
          league_id: leagueId,
          team_id: teamIdMap[p.team_external_id] ?? null,
          external_source: EXTERNAL_SOURCE,
          external_id: p.external_id,
          first_name: p.first_name,
          last_name: p.last_name,
          full_name: p.full_name,
          jersey_number: p.jersey_number,
          position: p.position,
          height_display: p.height_display ?? null,
          weight_display: p.weight_display ?? null,
          age: p.age ?? null,
          country: p.country ?? null,
          headshot_url: resolvedPhoto,
          status: "active",
          is_active: true,
          updated_at: nowIso,
        });
      }
    }
    for (let i = 0; i < newPlayers.length; i += 300) {
      const inserted = await sb.request("POST", "players", newPlayers.slice(i, i + 300));
      for (const r of inserted ?? []) playerIdMap[String(r.external_id)] = r.id;
    }

    const headshotPatches: Array<{ id: number; headshot_url: string }> = [];
    for (const ep of existingPlayers) {
      if (ep.headshot_url) continue;
      const abbr = ep.team_id ? teamAbbrByDbId[ep.team_id] ?? null : null;
      const photo = resolveFplPhoto(ep.full_name, abbr);
      if (photo) headshotPatches.push({ id: ep.id, headshot_url: photo });
    }
    for (let i = 0; i < headshotPatches.length; i += 25) {
      await Promise.all(
        headshotPatches.slice(i, i + 25).map((u) =>
          sb.request(
            "PATCH",
            `players?id=eq.${u.id}`,
            { headshot_url: u.headshot_url, updated_at: nowIso },
            { Prefer: "return=minimal" },
          ),
        ),
      );
    }

    // Sync games
    const existingGames = await sb.selectAll(
      "games",
      `league_id=eq.${leagueId}&external_source=eq.${EXTERNAL_SOURCE}&select=id,external_id`,
    );
    const gameIdMap: Record<string, number> = {};
    for (const r of existingGames) {
      if (r.external_id) gameIdMap[String(r.external_id)] = r.id;
    }

    const newGames: any[] = [];
    const gameUpdates: Array<{ id: number; payload: any }> = [];
    for (const g of Object.values(gamesByExt)) {
      const ht = teamIdMap[g.home_team_ext_id];
      const at = teamIdMap[g.away_team_ext_id];
      if (!ht || !at) continue;
      const basePayload: Record<string, any> = {
        league_id: leagueId,
        season_id: seasonId,
        external_source: EXTERNAL_SOURCE,
        external_id: g.external_id,
        game_date: g.game_date,
        tipoff_at: g.tipoff_at,
        status: g.status,
        status_detail: g.status_detail,
        period: g.period,
        clock: g.clock,
        home_team_id: ht,
        away_team_id: at,
        home_score: g.home_score,
        away_score: g.away_score,
        venue: g.venue,
        updated_at: nowIso,
      };
      const gid = gameIdMap[g.external_id];
      if (gid) {
        if (g.odds !== null) basePayload.odds = g.odds;
        if (g.sport_stats !== null) basePayload.sport_stats = g.sport_stats;
        gameUpdates.push({ id: gid, payload: basePayload });
      } else {
        // PostgREST bulk INSERT requires identical keys across all rows in the array
        basePayload.odds = g.odds ?? null;
        basePayload.sport_stats = g.sport_stats ?? null;
        newGames.push(basePayload);
      }
    }

    for (let i = 0; i < gameUpdates.length; i += 15) {
      await Promise.all(
        gameUpdates
          .slice(i, i + 15)
          .map((item) => sb.request("PATCH", `games?id=eq.${item.id}`, item.payload, { Prefer: "return=minimal" })),
      );
    }
    for (let i = 0; i < newGames.length; i += 200) {
      const inserted = await sb.request("POST", "games", newGames.slice(i, i + 200));
      for (const r of inserted ?? []) gameIdMap[String(r.external_id)] = r.id;
    }

    // Player stats bulk upsert
    const statPayloads: any[] = [];
    for (const r of statsRows) {
      const gid = gameIdMap[r.game_external_id];
      const tid = teamIdMap[r.team_external_id];
      const pid = playerIdMap[r.player_external_id];
      if (!gid || !tid || !pid) continue;
      statPayloads.push({
        league_id: leagueId,
        game_id: gid,
        team_id: tid,
        player_id: pid,
        minutes: r.minutes,
        pts: r.sport_stats.goals,
        ast: r.sport_stats.assists,
        starter: r.starter,
        did_not_play: r.did_not_play,
        dnp_reason: r.dnp_reason,
        sport_stats: r.sport_stats,
        updated_at: nowIso,
      });
    }
    if (statPayloads.length > 0) {
      await sb.upsertOnConflict("player_game_stats", statPayloads, "game_id,player_id", 300);
    }

    const msg = `Synced ${Object.keys(gamesByExt).length} matches (${targetDates[0]}..${targetDates[targetDates.length - 1]}), ${statPayloads.length} player stats`;
    await sb.request(
      "POST",
      "sync_runs",
      [
        {
          source: EXTERNAL_SOURCE,
          league_slug: meta.slug,
          status: "success",
          games_synced: Object.keys(gamesByExt).length,
          stats_synced: statPayloads.length,
          message: msg,
        },
      ],
      { Prefer: "return=minimal" },
    );

    return new Response(
      JSON.stringify({
        ok: true,
        league: meta.slug,
        season: seasonName,
        games_synced: Object.keys(gamesByExt).length,
        stats_synced: statPayloads.length,
        players_inserted: newPlayers.length,
        headshots_updated: headshotPatches.length,
        synced_at: nowIso,
      }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
