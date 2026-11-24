import type {
  FootballPlayerSeasonAverage,
  FootballTeamMatchStats,
  FootballTeamSeasonAverage,
  Game,
  PlayerGameStat,
  TeamStanding,
} from '../types/database';
import {
  americanToImpliedProb,
  checkPlayerAvailability,
  computeEffectivenessFromCounts,
  computePropOddsFromConfidence,
  computeSampleStdDev,
  computeTeamRestDays,
  evaluatePropStatus,
  getConfidenceTier,
  normalCdf,
  poissonAtLeast,
  selectPlayableSafeCandidate,
  smoothEmpiricalRate,
  type FootballMarketCategory,
  type FootballPlayerMetric,
  type GamePropsEffectivenessSummary,
  type MatchupBettingInsight,
  type PropContextBadge,
  type PropLiveStatus,
  type PropRecommendation,
  type TeamRecentSummary,
} from './betting';

export interface FootballPropContextInput {
  game: Game;
  homeStanding: TeamStanding | null;
  awayStanding: TeamStanding | null;
  homeTeamAvg: FootballTeamSeasonAverage | null;
  awayTeamAvg: FootballTeamSeasonAverage | null;
  homeRecent: TeamRecentSummary;
  awayRecent: TeamRecentSummary;
  homeRecentGames: Game[];
  awayRecentGames: Game[];
  keyPlayers: FootballPlayerSeasonAverage[];
  playerRecentLogs: PlayerGameStat[];
  playerStatuses?: Record<number, string>;
}

export interface FootballMatchProjections {
  homeGoals: number;
  awayGoals: number;
  totalGoals: number;
  htTotalGoals: number | null;
  bttsPct: number | null;
  over25Pct: number | null;
  homeCorners: number | null;
  awayCorners: number | null;
  totalCorners: number | null;
  homeFouls: number | null;
  awayFouls: number | null;
  totalFouls: number | null;
  homeCards: number | null;
  awayCards: number | null;
  totalCards: number | null;
  homeShots: number | null;
  awayShots: number | null;
  totalShots: number | null;
  homeSot: number | null;
  awaySot: number | null;
  totalSot: number | null;
  totalOffsides: number | null;
  totalSaves: number | null;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
}

export const FOOTBALL_MARKET_CATEGORY_TABS: Array<{
  key: 'all' | FootballMarketCategory;
  label: string;
}> = [
  { key: 'all', label: 'Todos' },
  { key: 'goals', label: 'Goles' },
  { key: 'corners', label: 'Córners' },
  { key: 'fouls', label: 'Faltas' },
  { key: 'cards', label: 'Tarjetas' },
  { key: 'shots', label: 'Remates' },
  { key: 'result', label: '1X2' },
  { key: 'other', label: 'Otros' },
  { key: 'player', label: 'Jugadores' },
];

export const FOOTBALL_PLAYER_METRIC_DEFS: Array<{
  key: FootballPlayerMetric;
  label: string;
  short: string;
}> = [
  { key: 'shots', label: 'Remates Totales', short: 'REM' },
  { key: 'sot', label: 'Remates al Arco', short: 'ARCO' },
  { key: 'goals', label: 'Goles', short: 'GOL' },
  { key: 'assists', label: 'Asistencias', short: 'AST' },
  { key: 'goal_contrib', label: 'Gol + Asistencia', short: 'G+A' },
  { key: 'fouls_committed', label: 'Faltas Cometidas', short: 'FC' },
  { key: 'fouls_suffered', label: 'Faltas Recibidas', short: 'FR' },
  { key: 'yellow_cards', label: 'Tarjetas Amarillas', short: 'TA' },
  { key: 'saves', label: 'Atajadas (ARQ)', short: 'ATAJ' },
];

export function getFootballPlayerSeasonAvg(
  player: FootballPlayerSeasonAverage | null | undefined,
  metric: FootballPlayerMetric,
): number | null {
  if (!player) return null;
  const gp = Math.max(1, player.gp || 0);
  switch (metric) {
    case 'goals':
      return Number(player.goals_pg ?? player.goals / gp);
    case 'assists':
      return Number(player.assists_pg ?? player.assists / gp);
    case 'goal_contrib':
      return Number(player.goal_contrib_pg ?? (player.goals + player.assists) / gp);
    case 'shots':
      return Number(player.shots_pg ?? player.shots / gp);
    case 'sot':
      return Number(player.sot_pg ?? player.shots_on_target / gp);
    case 'fouls_committed':
      return Number(player.fouls_committed_pg ?? player.fouls_committed / gp);
    case 'fouls_suffered':
      return Number(player.fouls_suffered_pg ?? player.fouls_suffered / gp);
    case 'yellow_cards':
      return Number(player.yellow_cards_pg ?? player.yellow_cards / gp);
    case 'saves':
      return Number(player.saves_pg ?? player.saves / gp);
  }
}

export function getFootballPlayerStatValue(
  row: PlayerGameStat,
  metric: FootballPlayerMetric,
): number {
  const ss = row.sport_stats;
  switch (metric) {
    case 'goals':
      return Number(ss?.goals ?? row.pts ?? 0);
    case 'assists':
      return Number(ss?.assists ?? row.ast ?? 0);
    case 'goal_contrib':
      return Number(ss?.goals ?? row.pts ?? 0) + Number(ss?.assists ?? row.ast ?? 0);
    case 'shots':
      return Number(ss?.shots ?? 0);
    case 'sot':
      return Number(ss?.shots_on_target ?? 0);
    case 'fouls_committed':
      return Number(ss?.fouls_committed ?? 0);
    case 'fouls_suffered':
      return Number(ss?.fouls_suffered ?? 0);
    case 'yellow_cards':
      return Number(ss?.yellow_cards ?? 0);
    case 'saves':
      return Number(ss?.saves ?? 0);
  }
}

export function hasFootballBoxTracking(game: Game): boolean {
  const hs = game.sport_stats?.home;
  const as_ = game.sport_stats?.away;
  if (!hs || !as_) return false;
  return (
    Number(hs.shots ?? 0) +
      Number(as_.shots ?? 0) +
      Number(hs.corners ?? 0) +
      Number(as_.corners ?? 0) +
      Number(hs.fouls ?? 0) +
      Number(as_.fouls ?? 0) >
    0
  );
}

export function extractTeamMatchStat(
  game: Game,
  teamId: number,
  key: keyof FootballTeamMatchStats,
): number | null {
  const isCardKey = key === 'yellow_cards' || key === 'red_cards';
  if (!isCardKey && !hasFootballBoxTracking(game)) return null;
  const hs = game.sport_stats?.home;
  const as_ = game.sport_stats?.away;
  if (!hs || !as_) return null;
  const side = game.home_team_id === teamId ? hs : game.away_team_id === teamId ? as_ : null;
  if (!side || side[key] == null) return null;
  return Number(side[key]);
}

export function extractMatchTotalStat(
  game: Game,
  key: keyof FootballTeamMatchStats,
): number | null {
  const isCardKey = key === 'yellow_cards' || key === 'red_cards';
  if (!isCardKey && !hasFootballBoxTracking(game)) return null;
  const hs = game.sport_stats?.home;
  const as_ = game.sport_stats?.away;
  if (!hs || !as_) return null;
  if (hs[key] == null || as_[key] == null) return null;
  return Number(hs[key]) + Number(as_[key]);
}

function parseMinuteBase(minuteStr?: string | null): number | null {
  if (!minuteStr) return null;
  const m = /(\d+)/.exec(minuteStr);
  return m ? Number(m[1]) : null;
}

export function extractHalfTimeGoals(
  game: Game,
): { home: number; away: number; total: number } | null {
  if (
    Array.isArray(game.home_linescores) &&
    game.home_linescores.length > 0 &&
    Array.isArray(game.away_linescores) &&
    game.away_linescores.length > 0
  ) {
    const h = Number(game.home_linescores[0] ?? 0);
    const a = Number(game.away_linescores[0] ?? 0);
    if (Number.isFinite(h) && Number.isFinite(a)) {
      return { home: h, away: a, total: h + a };
    }
  }

  if (game.status === 'final' && game.home_score === 0 && game.away_score === 0) {
    return { home: 0, away: 0, total: 0 };
  }

  const events = game.sport_stats?.events ?? [];
  const goalEvents = events.filter(
    (e) => e.kind === 'goal' || e.kind === 'penalty' || e.kind === 'own_goal',
  );
  if (goalEvents.length > 0) {
    let htGoals = 0;
    for (const ev of goalEvents) {
      const min = parseMinuteBase(ev.minute);
      if (min != null && min <= 45) {
        htGoals += 1;
      }
    }
    return { home: htGoals, away: 0, total: htGoals };
  }

  return null;
}

interface FootballPoissonOutcome {
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  p1X: number;
  pX2: number;
  pOver15: number;
  pOver25: number;
  pUnder35: number;
  pBtts: number;
}

function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let term = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    term = (term * lambda) / i;
  }
  return term;
}

function computePoissonMatchOutcome(
  lambdaHomeRaw: number,
  lambdaAwayRaw: number,
  odds?: Game['odds'],
): FootballPoissonOutcome {
  const lambdaHome = Math.max(0.35, Math.min(3.5, lambdaHomeRaw));
  const lambdaAway = Math.max(0.35, Math.min(3.5, lambdaAwayRaw));
  const lambdaTotal = lambdaHome + lambdaAway;

  let pHomePois = 0;
  let pDrawPois = 0;
  let pAwayPois = 0;
  let pOver15 = 0;
  let pOver25 = 0;
  let pUnder35 = 0;

  for (let i = 0; i <= 7; i++) {
    const pi = poissonPmf(lambdaHome, i);
    for (let j = 0; j <= 7; j++) {
      const p = pi * poissonPmf(lambdaAway, j);
      if (i > j) pHomePois += p;
      else if (i === j) pDrawPois += p;
      else pAwayPois += p;
      const tot = i + j;
      if (tot >= 2) pOver15 += p;
      if (tot >= 3) pOver25 += p;
      if (tot <= 3) pUnder35 += p;
    }
  }

  const mass = pHomePois + pDrawPois + pAwayPois || 1;
  pHomePois /= mass;
  pDrawPois /= mass;
  pAwayPois /= mass;

  let pHome = pHomePois;
  let pDraw = pDrawPois;
  let pAway = pAwayPois;

  // Blend with normalized 3-way sportsbook odds when available (markets price injuries/motivation)
  const impH = americanToImpliedProb(odds?.home_moneyline);
  const impD = americanToImpliedProb(odds?.draw_moneyline);
  const impA = americanToImpliedProb(odds?.away_moneyline);
  if (impH != null && impD != null && impA != null && impH + impD + impA > 0) {
    const bookSum = impH + impD + impA;
    pHome = 0.55 * (impH / bookSum) + 0.45 * pHomePois;
    pDraw = 0.55 * (impD / bookSum) + 0.45 * pDrawPois;
    pAway = 0.55 * (impA / bookSum) + 0.45 * pAwayPois;
  }

  const pBtts = (1 - Math.exp(-lambdaHome)) * (1 - Math.exp(-lambdaAway));

  return {
    lambdaHome,
    lambdaAway,
    lambdaTotal,
    pHome,
    pDraw,
    pAway,
    p1X: pHome + pDraw,
    pX2: pAway + pDraw,
    pOver15,
    pOver25,
    pUnder35,
    pBtts,
  };
}

function clampConf(val: number): number {
  return Math.max(51, Math.min(91, Math.round(val)));
}

function avgNums(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function collectRecentTeamStat(
  teamId: number,
  games: Game[],
  key: keyof FootballTeamMatchStats,
): number[] {
  const out: number[] = [];
  for (const g of games) {
    if (g.status !== 'final') continue;
    const v = extractTeamMatchStat(g, teamId, key);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function collectRecentMatchStat(
  games: Game[],
  key: keyof FootballTeamMatchStats,
): number[] {
  const out: number[] = [];
  for (const g of games) {
    if (g.status !== 'final') continue;
    const v = extractMatchTotalStat(g, key);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function collectRecentTeamGoals(teamId: number, games: Game[]): number[] {
  const out: number[] = [];
  for (const g of games) {
    if (g.status !== 'final') continue;
    out.push(g.home_team_id === teamId ? g.home_score : g.away_score);
  }
  return out;
}

function blendTwo(a: number | null, b: number | null, wA = 0.65): number | null {
  if (a != null && b != null) return Number((a * wA + b * (1 - wA)).toFixed(2));
  return a ?? b;
}

function projectSplitPair(
  homeForSeason: number | null | undefined,
  homeAgainstSeason: number | null | undefined,
  awayForSeason: number | null | undefined,
  awayAgainstSeason: number | null | undefined,
  homeRecentAvg: number | null,
  awayRecentAvg: number | null,
): { home: number | null; away: number | null; total: number | null } {
  const hSeason =
    homeForSeason != null && awayAgainstSeason != null
      ? (Number(homeForSeason) + Number(awayAgainstSeason)) / 2
      : homeForSeason != null
        ? Number(homeForSeason)
        : null;
  const aSeason =
    awayForSeason != null && homeAgainstSeason != null
      ? (Number(awayForSeason) + Number(homeAgainstSeason)) / 2
      : awayForSeason != null
        ? Number(awayForSeason)
        : null;

  const home = blendTwo(hSeason, homeRecentAvg, 0.65);
  const away = blendTwo(aSeason, awayRecentAvg, 0.65);
  const total =
    home != null && away != null ? Number((home + away).toFixed(2)) : null;
  return { home, away, total };
}

function computeBttsRate(_teamId: number, games: Game[]): { hits: number; tracked: number; rate: number } {
  const finals = games.filter((g) => g.status === 'final');
  if (finals.length === 0) return { hits: 0, tracked: 0, rate: 0 };
  const hits = finals.filter((g) => g.home_score > 0 && g.away_score > 0).length;
  return { hits, tracked: finals.length, rate: hits / finals.length };
}

function resolveExpectedLambdas(input: FootballPropContextInput): {
  lambdaHome: number | null;
  lambdaAway: number | null;
  poisson: FootballPoissonOutcome | null;
} {
  const { game, homeStanding, awayStanding, homeTeamAvg, awayTeamAvg, homeRecent, awayRecent } = input;
  const homeGfSeason =
    homeTeamAvg?.home_gf_pg != null && homeTeamAvg?.gf_pg != null
      ? Number(homeTeamAvg.home_gf_pg) * 0.4 + Number(homeTeamAvg.gf_pg) * 0.6
      : homeTeamAvg?.gf_pg ??
        (homeStanding?.ppg != null ? Number(homeStanding.ppg) : null) ??
        (homeRecent.gamesCount > 0 ? homeRecent.avgFor : null);
  const homeGaSeason =
    homeTeamAvg?.home_ga_pg != null && homeTeamAvg?.ga_pg != null
      ? Number(homeTeamAvg.home_ga_pg) * 0.4 + Number(homeTeamAvg.ga_pg) * 0.6
      : homeTeamAvg?.ga_pg ??
        (homeStanding?.oppg != null ? Number(homeStanding.oppg) : null) ??
        (homeRecent.gamesCount > 0 ? homeRecent.avgAgainst : null);
  const awayGfSeason =
    awayTeamAvg?.away_gf_pg != null && awayTeamAvg?.gf_pg != null
      ? Number(awayTeamAvg.away_gf_pg) * 0.4 + Number(awayTeamAvg.gf_pg) * 0.6
      : awayTeamAvg?.gf_pg ??
        (awayStanding?.ppg != null ? Number(awayStanding.ppg) : null) ??
        (awayRecent.gamesCount > 0 ? awayRecent.avgFor : null);
  const awayGaSeason =
    awayTeamAvg?.away_ga_pg != null && awayTeamAvg?.ga_pg != null
      ? Number(awayTeamAvg.away_ga_pg) * 0.4 + Number(awayTeamAvg.ga_pg) * 0.6
      : awayTeamAvg?.ga_pg ??
        (awayStanding?.oppg != null ? Number(awayStanding.oppg) : null) ??
        (awayRecent.gamesCount > 0 ? awayRecent.avgAgainst : null);

  if (homeGfSeason == null || homeGaSeason == null || awayGfSeason == null || awayGaSeason == null) {
    return { lambdaHome: null, lambdaAway: null, poisson: null };
  }

  const homeGf = homeRecent.gamesCount >= 3 ? homeGfSeason * 0.72 + homeRecent.avgFor * 0.28 : homeGfSeason;
  const homeGa = homeRecent.gamesCount >= 3 ? homeGaSeason * 0.72 + homeRecent.avgAgainst * 0.28 : homeGaSeason;
  const awayGf = awayRecent.gamesCount >= 3 ? awayGfSeason * 0.72 + awayRecent.avgFor * 0.28 : awayGfSeason;
  const awayGa = awayRecent.gamesCount >= 3 ? awayGaSeason * 0.72 + awayRecent.avgAgainst * 0.28 : awayGaSeason;

  const poisson = computePoissonMatchOutcome(
    ((homeGf + awayGa) / 2) * 1.07,
    ((awayGf + homeGa) / 2) * 0.93,
    game.odds,
  );
  return {
    lambdaHome: poisson.lambdaHome,
    lambdaAway: poisson.lambdaAway,
    poisson,
  };
}

export function computeFootballMatchProjections(
  input: FootballPropContextInput,
): FootballMatchProjections {
  const { game, homeTeamAvg, awayTeamAvg, homeRecentGames, awayRecentGames } = input;
  const { poisson } = resolveExpectedLambdas(input);

  const homeGoals = poisson ? Number(poisson.lambdaHome.toFixed(2)) : 1.35;
  const awayGoals = poisson ? Number(poisson.lambdaAway.toFixed(2)) : 1.1;
  const totalGoals = Number((homeGoals + awayGoals).toFixed(2));

  // 1st Half Goals
  const homeHtFinals = homeRecentGames.map(extractHalfTimeGoals).filter((x): x is NonNullable<typeof x> => x != null);
  const awayHtFinals = awayRecentGames.map(extractHalfTimeGoals).filter((x): x is NonNullable<typeof x> => x != null);
  const htSeasonHome =
    homeTeamAvg?.ht_gf_pg != null && awayTeamAvg?.ht_ga_pg != null
      ? (Number(homeTeamAvg.ht_gf_pg) + Number(awayTeamAvg.ht_ga_pg)) / 2
      : null;
  const htSeasonAway =
    awayTeamAvg?.ht_gf_pg != null && homeTeamAvg?.ht_ga_pg != null
      ? (Number(awayTeamAvg.ht_gf_pg) + Number(homeTeamAvg.ht_ga_pg)) / 2
      : null;
  const htFromRecent =
    homeHtFinals.length >= 2 && awayHtFinals.length >= 2
      ? (homeHtFinals.reduce((s, r) => s + r.total, 0) / homeHtFinals.length +
          awayHtFinals.reduce((s, r) => s + r.total, 0) / awayHtFinals.length) /
        2
      : null;
  const htFromSeason = htSeasonHome != null && htSeasonAway != null ? htSeasonHome + htSeasonAway : null;
  const htTotalGoals =
    blendTwo(htFromSeason, htFromRecent, 0.65) ?? Number((totalGoals * 0.44).toFixed(2));

  // BTTS & Over 2.5
  const homeBttsRec = computeBttsRate(game.home_team_id, homeRecentGames);
  const awayBttsRec = computeBttsRate(game.away_team_id, awayRecentGames);
  const recentBttsRate =
    homeBttsRec.tracked >= 3 && awayBttsRec.tracked >= 3
      ? (homeBttsRec.rate + awayBttsRec.rate) / 2
      : null;
  const blendedBtts =
    poisson && recentBttsRate != null
      ? (poisson.pBtts * 0.65 + recentBttsRate * 0.35) * 100
      : homeTeamAvg?.btts_pct != null && awayTeamAvg?.btts_pct != null
        ? (Number(homeTeamAvg.btts_pct) + Number(awayTeamAvg.btts_pct)) / 2
        : poisson
          ? poisson.pBtts * 100
          : null;

  const over25Season =
    homeTeamAvg?.over_25_pct != null && awayTeamAvg?.over_25_pct != null
      ? (Number(homeTeamAvg.over_25_pct) + Number(awayTeamAvg.over_25_pct)) / 2
      : null;
  const over25Pct =
    poisson && over25Season != null
      ? poisson.pOver25 * 60 + over25Season * 0.4
      : over25Season ?? (poisson ? poisson.pOver25 * 100 : null);

  // Corners, Fouls, Yellow Cards, Shots, SOT, Offsides, Saves
  const corners = projectSplitPair(
    homeTeamAvg?.corners_pg,
    homeTeamAvg?.corners_against_pg,
    awayTeamAvg?.corners_pg,
    awayTeamAvg?.corners_against_pg,
    avgNums(collectRecentTeamStat(game.home_team_id, homeRecentGames, 'corners')),
    avgNums(collectRecentTeamStat(game.away_team_id, awayRecentGames, 'corners')),
  );
  const fouls = projectSplitPair(
    homeTeamAvg?.fouls_pg,
    homeTeamAvg?.fouls_drawn_pg,
    awayTeamAvg?.fouls_pg,
    awayTeamAvg?.fouls_drawn_pg,
    avgNums(collectRecentTeamStat(game.home_team_id, homeRecentGames, 'fouls')),
    avgNums(collectRecentTeamStat(game.away_team_id, awayRecentGames, 'fouls')),
  );
  const cards = projectSplitPair(
    homeTeamAvg?.yellow_cards_pg,
    homeTeamAvg?.cards_against_pg,
    awayTeamAvg?.yellow_cards_pg,
    awayTeamAvg?.cards_against_pg,
    avgNums(collectRecentTeamStat(game.home_team_id, homeRecentGames, 'yellow_cards')),
    avgNums(collectRecentTeamStat(game.away_team_id, awayRecentGames, 'yellow_cards')),
  );
  const shots = projectSplitPair(
    homeTeamAvg?.shots_pg,
    homeTeamAvg?.shots_against_pg,
    awayTeamAvg?.shots_pg,
    awayTeamAvg?.shots_against_pg,
    avgNums(collectRecentTeamStat(game.home_team_id, homeRecentGames, 'shots')),
    avgNums(collectRecentTeamStat(game.away_team_id, awayRecentGames, 'shots')),
  );
  const sot = projectSplitPair(
    homeTeamAvg?.sot_pg,
    homeTeamAvg?.sot_against_pg,
    awayTeamAvg?.sot_pg,
    awayTeamAvg?.sot_against_pg,
    avgNums(collectRecentTeamStat(game.home_team_id, homeRecentGames, 'shots_on_target')),
    avgNums(collectRecentTeamStat(game.away_team_id, awayRecentGames, 'shots_on_target')),
  );

  const hOff = blendTwo(
    homeTeamAvg?.offsides_pg != null ? Number(homeTeamAvg.offsides_pg) : null,
    avgNums(collectRecentTeamStat(game.home_team_id, homeRecentGames, 'offsides')),
  );
  const aOff = blendTwo(
    awayTeamAvg?.offsides_pg != null ? Number(awayTeamAvg.offsides_pg) : null,
    avgNums(collectRecentTeamStat(game.away_team_id, awayRecentGames, 'offsides')),
  );
  const totalOffsides = hOff != null && aOff != null ? Number((hOff + aOff).toFixed(2)) : null;

  const hSaves = blendTwo(
    homeTeamAvg?.saves_pg != null ? Number(homeTeamAvg.saves_pg) : null,
    avgNums(collectRecentTeamStat(game.home_team_id, homeRecentGames, 'saves')),
  );
  const aSaves = blendTwo(
    awayTeamAvg?.saves_pg != null ? Number(awayTeamAvg.saves_pg) : null,
    avgNums(collectRecentTeamStat(game.away_team_id, awayRecentGames, 'saves')),
  );
  const totalSaves = hSaves != null && aSaves != null ? Number((hSaves + aSaves).toFixed(2)) : null;

  return {
    homeGoals,
    awayGoals,
    totalGoals,
    htTotalGoals,
    bttsPct: blendedBtts != null ? Number(blendedBtts.toFixed(1)) : null,
    over25Pct: over25Pct != null ? Number(over25Pct.toFixed(1)) : null,
    homeCorners: corners.home,
    awayCorners: corners.away,
    totalCorners: corners.total,
    homeFouls: fouls.home,
    awayFouls: fouls.away,
    totalFouls: fouls.total,
    homeCards: cards.home,
    awayCards: cards.away,
    totalCards: cards.total,
    homeShots: shots.home,
    awayShots: shots.away,
    totalShots: shots.total,
    homeSot: sot.home,
    awaySot: sot.away,
    totalSot: sot.total,
    totalOffsides,
    totalSaves,
    homeWinProb: Number(((poisson?.pHome ?? 0.42) * 100).toFixed(1)),
    drawProb: Number(((poisson?.pDraw ?? 0.27) * 100).toFixed(1)),
    awayWinProb: Number(((poisson?.pAway ?? 0.31) * 100).toFixed(1)),
  };
}

export function buildFootballMatchupInsight(
  game: Game,
  homeStanding: TeamStanding | null,
  awayStanding: TeamStanding | null,
  homeTeamAvg: FootballTeamSeasonAverage | null,
  awayTeamAvg: FootballTeamSeasonAverage | null,
  homeRecent: TeamRecentSummary,
  awayRecent: TeamRecentSummary,
  homeRecentGames?: Game[],
  awayRecentGames?: Game[],
): MatchupBettingInsight {
  const odds = game.odds;
  const homeRestDays = homeRecentGames ? computeTeamRestDays(game.game_date, homeRecentGames) : null;
  const awayRestDays = awayRecentGames ? computeTeamRestDays(game.game_date, awayRecentGames) : null;

  const proj = computeFootballMatchProjections({
    game,
    homeStanding,
    awayStanding,
    homeTeamAvg,
    awayTeamAvg,
    homeRecent,
    awayRecent,
    homeRecentGames: homeRecentGames ?? [],
    awayRecentGames: awayRecentGames ?? [],
    keyPlayers: [],
    playerRecentLogs: [],
  });

  const homeGf = homeTeamAvg?.gf_pg ?? (homeStanding?.ppg != null ? Number(homeStanding.ppg) : null);
  const homeGa = homeTeamAvg?.ga_pg ?? (homeStanding?.oppg != null ? Number(homeStanding.oppg) : null);
  const awayGf = awayTeamAvg?.gf_pg ?? (awayStanding?.ppg != null ? Number(awayStanding.ppg) : null);
  const awayGa = awayTeamAvg?.ga_pg ?? (awayStanding?.oppg != null ? Number(awayStanding.oppg) : null);

  let expectedTotalSeason: number | null = null;
  if (homeGf != null && homeGa != null && awayGf != null && awayGa != null) {
    const homeExp = (homeGf + awayGa) / 2;
    const awayExp = (awayGf + homeGa) / 2;
    expectedTotalSeason = Number((homeExp + awayExp).toFixed(2));
  }

  let expectedTotalRecent: number | null = null;
  if (homeRecent.gamesCount > 0 && awayRecent.gamesCount > 0) {
    const homeExpR = (homeRecent.avgFor + awayRecent.avgAgainst) / 2;
    const awayExpR = (awayRecent.avgFor + homeRecent.avgAgainst) / 2;
    expectedTotalRecent = Number((homeExpR + awayExpR).toFixed(2));
  }

  const refTotal = expectedTotalRecent ?? expectedTotalSeason;
  const totalLine = odds?.over_under ?? 2.5;
  const totalEdge = refTotal != null ? Number((refTotal - totalLine).toFixed(2)) : null;

  let projectedHomeMargin: number | null = null;
  if (homeGf != null && homeGa != null && awayGf != null && awayGa != null) {
    const homeExp = (homeGf + awayGa) / 2 + 0.18;
    const awayExp = (awayGf + homeGa) / 2;
    projectedHomeMargin = Number((homeExp - awayExp).toFixed(2));
  } else if (homeRecent.gamesCount > 0 && awayRecent.gamesCount > 0) {
    projectedHomeMargin = Number(((homeRecent.avgMargin - awayRecent.avgMargin) / 2 + 0.18).toFixed(2));
  }

  const spreadEdgeHome =
    odds?.home_spread != null && projectedHomeMargin != null
      ? Number((projectedHomeMargin + odds.home_spread).toFixed(2))
      : null;

  const movements: string[] = [];
  const signals: MatchupBettingInsight['signals'] = [];

  if (totalEdge != null) {
    if (totalEdge >= 0.35) {
      signals.push({
        title: `Tendencia Alta Goles (O/U ${totalLine})`,
        detail: `Proyección combinada de ${refTotal?.toFixed(2)} goles/partido (+${totalEdge.toFixed(2)} sobre la línea).`,
        tone: 'over',
      });
    } else if (totalEdge <= -0.35) {
      signals.push({
        title: `Tendencia Baja Goles (O/U ${totalLine})`,
        detail: `Duelo cerrado proyectado en ${refTotal?.toFixed(2)} goles (${totalEdge.toFixed(2)} vs línea).`,
        tone: 'under',
      });
    }
  }

  if (proj.totalCorners != null) {
    if (proj.totalCorners >= 10.5) {
      signals.push({
        title: `Ritmo Alto en Córners (~${proj.totalCorners.toFixed(1)})`,
        detail: `${game.home_team.abbreviation} (${proj.homeCorners?.toFixed(1)}) y ${game.away_team.abbreviation} (${proj.awayCorners?.toFixed(1)}) acumulan alto volumen por bandas.`,
        tone: 'over',
      });
    } else if (proj.totalCorners <= 7.5) {
      signals.push({
        title: `Bajo Volumen de Córners (~${proj.totalCorners.toFixed(1)})`,
        detail: `Ambos conjuntos generan pocas llegadas al tiro de esquina por encuentro.`,
        tone: 'under',
      });
    }
  }

  if (proj.totalFouls != null && proj.totalFouls >= 25.5) {
    signals.push({
      title: `Duelo Friccionado (~${proj.totalFouls.toFixed(1)} Faltas)`,
      detail: `${game.home_team.abbreviation} (${proj.homeFouls?.toFixed(1)}) + ${game.away_team.abbreviation} (${proj.awayFouls?.toFixed(1)}) superan el promedio de infracciones.`,
      tone: 'neutral',
    });
  }

  if (proj.totalCards != null && proj.totalCards >= 4.8) {
    signals.push({
      title: `Alta Tensión Disciplinaria (~${proj.totalCards.toFixed(1)} TA)`,
      detail: `Tendencia elevada de amonestaciones entre ${game.away_team.abbreviation} (${proj.awayCards?.toFixed(1)}) y ${game.home_team.abbreviation} (${proj.homeCards?.toFixed(1)}).`,
      tone: 'neutral',
    });
  }

  const homeBttsRate = computeBttsRate(game.home_team_id, homeRecentGames ?? []);
  const awayBttsRate = computeBttsRate(game.away_team_id, awayRecentGames ?? []);
  if (homeBttsRate.tracked >= 3 && awayBttsRate.tracked >= 3) {
    const combinedPct = Math.round(((homeBttsRate.rate + awayBttsRate.rate) / 2) * 100);
    if (combinedPct >= 62) {
      signals.push({
        title: 'Ambos Equipos Anotan (BTTS Sí)',
        detail: `Frecuencia combinada de BTTS del ${combinedPct}% en últimos encuentros.`,
        tone: 'over',
      });
    } else if (combinedPct <= 35) {
      signals.push({
        title: 'Portería a Cero Probable (BTTS No)',
        detail: `Solo ${combinedPct}% de partidos recientes terminaron con gol de ambos lados.`,
        tone: 'under',
      });
    }
  }

  const homeProb = americanToImpliedProb(odds?.home_moneyline);
  const awayProb = americanToImpliedProb(odds?.away_moneyline);
  if (homeProb != null && awayProb != null) {
    if (homeProb >= 58) {
      signals.push({
        title: `Local Favorito (${game.home_team.abbreviation})`,
        detail: `Probabilidad implícita de victoria local: ${homeProb.toFixed(1)}% en mercado 1X2.`,
        tone: 'home',
      });
    } else if (awayProb >= 52) {
      signals.push({
        title: `Visita Favorita (${game.away_team.abbreviation})`,
        detail: `Probabilidad implícita visitante: ${awayProb.toFixed(1)}% en mercado 1X2.`,
        tone: 'away',
      });
    }
  }

  if (homeRestDays != null && homeRestDays <= 2) {
    movements.push(`${game.home_team.abbreviation} llega con poco descanso (${homeRestDays} días entre partidos).`);
  }
  if (awayRestDays != null && awayRestDays <= 2) {
    movements.push(`${game.away_team.abbreviation} juega con recuperación corta (${awayRestDays} días).`);
  }

  return {
    expectedTotalSeason,
    expectedTotalRecent,
    totalEdge,
    projectedHomeMargin,
    spreadEdgeHome,
    homeRestDays,
    awayRestDays,
    movements,
    signals,
  };
}

function calibrateCountProbability(
  proj: number,
  line: number,
  pick: 'OVER' | 'UNDER',
  recentVals: number[],
  priorSd: number,
): { pCal: number; hits: number; empRate: number } {
  const pModel =
    proj <= 18
      ? (() => {
          const k = Math.floor(line) + 1;
          const pOver = poissonAtLeast(Math.max(0.2, proj), k);
          return pick === 'OVER' ? pOver : 1 - pOver;
        })()
      : (() => {
          const sd = computeSampleStdDev(recentVals, priorSd);
          const edge = pick === 'OVER' ? proj - line : line - proj;
          return normalCdf(edge / Math.max(0.75, sd));
        })();

  const hits = recentVals.filter((v) => (pick === 'OVER' ? v > line : v < line)).length;
  const empRate = recentVals.length > 0 ? hits / recentVals.length : pModel;
  const smoothedEmp = smoothEmpiricalRate(hits, recentVals.length, pModel);
  const pCal =
    recentVals.length >= 6
      ? 0.52 * pModel + 0.48 * smoothedEmp
      : recentVals.length >= 4
        ? 0.65 * pModel + 0.35 * smoothedEmp
        : pModel;

  return { pCal, hits, empRate };
}

interface CountMarketConfig {
  idPrefix: string;
  idSuffix: string;
  category: FootballMarketCategory;
  marketLabel: string;
  safeLabel: string;
  subjectName: string;
  teamAbbr: string;
  teamId?: number;
  unitLabel: string;
  proj: number;
  recentVals: number[];
  priorSd: number;
  minLine: number;
  maxSafeStepDown?: number;
  safeMinCal?: number;
  valueMinCal?: number;
  badgeTone: PropContextBadge['tone'];
  detailPrefix: string;
  rationaleOver: (line: number, projVal: number, hitTxt: string) => string;
  rationaleUnder: (line: number, projVal: number, hitTxt: string) => string;
}

function emitCalibratedCountMarketProps(cfg: CountMarketConfig): PropRecommendation[] {
  const out: PropRecommendation[] = [];
  const recAvg = avgNums(cfg.recentVals);
  const maxStep = cfg.maxSafeStepDown ?? (cfg.proj >= 14 ? 4 : cfg.proj >= 6 ? 2 : 1);
  const safeMinCal = cfg.safeMinCal ?? 0.66;
  const valueMinCal = cfg.valueMinCal ?? 0.56;

  // Build candidate SAFE lines (both Over below proj and Under above proj) and pick playable sweet spot 67%-82%
  const safeCandidates: PropRecommendation[] = [];
  const candidateSafeSpecs: Array<{ line: number; pick: 'OVER' | 'UNDER' }> = [];

  const overAnchor = Math.floor(cfg.proj) - 0.5;
  for (let s = 0; s <= maxStep; s++) {
    const line = overAnchor - s;
    if (line >= cfg.minLine) {
      candidateSafeSpecs.push({ line, pick: 'OVER' });
    }
  }
  if (cfg.proj <= 18) {
    const underAnchor = Math.ceil(cfg.proj) + 0.5;
    for (let s = 1; s <= maxStep; s++) {
      candidateSafeSpecs.push({ line: underAnchor + s, pick: 'UNDER' });
    }
  }

  for (const spec of candidateSafeSpecs) {
    const { pCal, hits, empRate } = calibrateCountProbability(
      cfg.proj,
      spec.line,
      spec.pick,
      cfg.recentVals,
      cfg.priorSd,
    );
    const cappedCal = Math.min(0.86, pCal);
    if (cappedCal < safeMinCal) continue;
    if (cfg.recentVals.length >= 4 && empRate < 0.58) continue;

    const conf = clampConf(cappedCal * 100);
    const oddsVal = computePropOddsFromConfidence(conf);
    const hitTxt =
      cfg.recentVals.length > 0
        ? `acierto ${hits}/${cfg.recentVals.length}`
        : `proy. ${cfg.proj.toFixed(1)}`;
    safeCandidates.push({
      id: `${cfg.idPrefix}_safe_${cfg.idSuffix}`,
      scope: 'team',
      strategy: 'safe',
      marketCategory: cfg.category,
      teamId: cfg.teamId,
      projectedValue: Number(cfg.proj.toFixed(2)),
      marketLabel: cfg.safeLabel,
      subjectName: cfg.subjectName,
      teamAbbr: cfg.teamAbbr,
      statSummary: `${cfg.detailPrefix}${recAvg != null ? ` · Rec. ${recAvg.toFixed(1)}` : ''}`,
      marketLineText: `Línea Segura: ${spec.pick === 'OVER' ? '+' : '-'}${spec.line} ${cfg.unitLabel} · Cuota ${oddsVal.decimal.toFixed(2)}x`,
      lineValue: spec.line,
      pick: spec.pick,
      pickLabel: `${spec.pick === 'OVER' ? 'Más de' : 'Menos de'} ${spec.line} ${cfg.unitLabel}`,
      rationale:
        spec.pick === 'OVER'
          ? cfg.rationaleOver(spec.line, cfg.proj, hitTxt)
          : cfg.rationaleUnder(spec.line, cfg.proj, hitTxt),
      confidence: conf,
      confidenceTier: getConfidenceTier(conf),
      estimatedOddsAmerican: oddsVal.american,
      estimatedMultiplier: oddsVal.decimal,
      contextBadges: [
        { label: 'Línea Segura', tone: 'emerald' },
        { label: `Proy. ${cfg.proj.toFixed(1)}`, tone: cfg.badgeTone },
      ],
    });
  }

  const chosenSafe = selectPlayableSafeCandidate(safeCandidates);
  if (chosenSafe) out.push(chosenSafe);

  // Build VALUE line near the natural projection (different from chosenSafe.lineValue)
  const stdFloor = Math.max(cfg.minLine, Math.floor(cfg.proj) + 0.5);
  const valCandidateLines = Array.from(
    new Set([stdFloor - 1, stdFloor, stdFloor + 1].filter((l) => l >= cfg.minLine)),
  );
  let bestVal: { rec: PropRecommendation; score: number } | null = null;

  for (const vLine of valCandidateLines) {
    if (chosenSafe && Math.abs(chosenSafe.lineValue - vLine) < 0.01) continue;
    const pick: 'OVER' | 'UNDER' = cfg.proj >= vLine ? 'OVER' : 'UNDER';
    const { pCal, hits, empRate } = calibrateCountProbability(
      cfg.proj,
      vLine,
      pick,
      cfg.recentVals,
      cfg.priorSd,
    );
    const cappedCal = Math.min(0.73, pCal);
    if (cappedCal < valueMinCal) continue;
    if (cfg.recentVals.length >= 4 && empRate < 0.45) continue;

    const conf = clampConf(cappedCal * 100);
    const oddsVal = computePropOddsFromConfidence(conf);
    const hitTxt =
      cfg.recentVals.length > 0
        ? `acierto ${hits}/${cfg.recentVals.length}`
        : `proy. ${cfg.proj.toFixed(1)}`;
    const score = cappedCal - Math.abs(cfg.proj - vLine) * 0.02;

    if (!bestVal || score > bestVal.score) {
      bestVal = {
        score,
        rec: {
          id: `${cfg.idPrefix}_val_${cfg.idSuffix}`,
          scope: 'team',
          strategy: 'value',
          marketCategory: cfg.category,
          teamId: cfg.teamId,
          projectedValue: Number(cfg.proj.toFixed(2)),
          marketLabel: cfg.marketLabel,
          subjectName: cfg.subjectName,
          teamAbbr: cfg.teamAbbr,
          statSummary: `${cfg.detailPrefix}${recAvg != null ? ` · Rec. ${recAvg.toFixed(1)}` : ''}`,
          marketLineText: `O/U ${vLine} ${cfg.unitLabel} · Cuota ${oddsVal.decimal.toFixed(2)}x`,
          lineValue: vLine,
          pick,
          pickLabel: `${pick === 'OVER' ? 'Más de' : 'Menos de'} ${vLine} ${cfg.unitLabel}`,
          rationale:
            pick === 'OVER'
              ? cfg.rationaleOver(vLine, cfg.proj, hitTxt)
              : cfg.rationaleUnder(vLine, cfg.proj, hitTxt),
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [{ label: `Proy. ${cfg.proj.toFixed(1)}`, tone: cfg.badgeTone }],
        },
      };
    }
  }

  if (bestVal) out.push(bestVal.rec);
  return out;
}

export function buildFootballPropsRecommendations(
  input: FootballPropContextInput,
): PropRecommendation[] {
  const {
    game,
    homeTeamAvg,
    awayTeamAvg,
    homeRecent,
    awayRecent,
    homeRecentGames,
    awayRecentGames,
    keyPlayers,
    playerRecentLogs,
    playerStatuses,
  } = input;
  const recs: PropRecommendation[] = [];

  const totalLine = game.odds?.over_under ?? 2.5;
  const { poisson } = resolveExpectedLambdas(input);
  const proj = computeFootballMatchProjections(input);
  const matchupTitle = `${game.away_team.short_name} vs ${game.home_team.short_name}`;
  const matchupAbbr = `${game.away_team.abbreviation}/${game.home_team.abbreviation}`;
  const combinedGames = [...awayRecentGames, ...homeRecentGames].filter((g) => g.status === 'final');

  if (poisson) {
    const homeBtts = computeBttsRate(game.home_team_id, homeRecentGames);
    const awayBtts = computeBttsRate(game.away_team_id, awayRecentGames);
    const recentBttsRate =
      homeBtts.tracked >= 3 && awayBtts.tracked >= 3
        ? (homeBtts.rate + awayBtts.rate) / 2
        : poisson.pBtts;

    // 1. SAFE: Doble Oportunidad (1X o X2)
    const favor1X = poisson.p1X >= poisson.pX2;
    const bestDcProb = Math.min(0.9, favor1X ? poisson.p1X : poisson.pX2);
    if (bestDcProb >= 0.72) {
      const dcTeam = favor1X ? game.home_team : game.away_team;
      const conf = clampConf(bestDcProb * 100);
      const oddsVal = computePropOddsFromConfidence(conf);
      recs.push({
        id: `fb_dc_safe_${game.id}`,
        scope: 'team',
        strategy: 'safe',
        marketCategory: 'result',
        teamId: dcTeam.id,
        projectedValue: Number((bestDcProb * 100).toFixed(1)),
        marketLabel: 'Doble Oportunidad · Segura',
        subjectName: `${game.away_team.abbreviation} @ ${game.home_team.abbreviation}`,
        teamAbbr: dcTeam.abbreviation,
        statSummary: `Poisson 1X: ${Math.round(poisson.p1X * 100)}% · X2: ${Math.round(poisson.pX2 * 100)}% (λ ${poisson.lambdaHome.toFixed(2)}–${poisson.lambdaAway.toFixed(2)})`,
        marketLineText: `Doble Oportunidad · Cuota ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: Number((bestDcProb * 100).toFixed(1)),
        pick: 'DC',
        pickLabel: favor1X
          ? `1X (${game.home_team.abbreviation} o Emp.)`
          : `X2 (${game.away_team.abbreviation} o Emp.)`,
        rationale: `Modelo Poisson + cuotas estima ${Math.round(bestDcProb * 100)}% de probabilidad de no derrota para ${dcTeam.short_name}.`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [
          { label: 'Línea Segura', tone: 'emerald' },
          { label: `${favor1X ? '1X' : 'X2'} ${Math.round(bestDcProb * 100)}%`, tone: 'cyan' },
        ],
      });
    }

    // 2. ML (1X2) & Sin Empate (DNB) & Hándicap Asiático
    const bestMlHome = poisson.pHome >= poisson.pAway;
    const mlProb = bestMlHome ? poisson.pHome : poisson.pAway;
    const otherMlProb = bestMlHome ? poisson.pAway : poisson.pHome;
    const mlTeam = bestMlHome ? game.home_team : game.away_team;
    const mlBookOdds = bestMlHome ? game.odds?.home_moneyline : game.odds?.away_moneyline;
    const mlImplied = americanToImpliedProb(mlBookOdds);

    if (mlProb >= 0.62) {
      const conf = clampConf(Math.min(86, mlProb * 100));
      const oddsVal = computePropOddsFromConfidence(conf, mlBookOdds);
      recs.push({
        id: `fb_ml_safe_${game.id}`,
        scope: 'team',
        strategy: 'safe',
        marketCategory: 'result',
        teamId: mlTeam.id,
        projectedValue: Number((mlProb * 100).toFixed(1)),
        marketLabel: 'Ganador 1X2 · Segura',
        subjectName: mlTeam.short_name,
        teamAbbr: mlTeam.abbreviation,
        statSummary: `Probabilidad estimada: ${Math.round(mlProb * 100)}% (Goles esp. ${poisson.lambdaHome.toFixed(2)}–${poisson.lambdaAway.toFixed(2)})`,
        marketLineText: `Cuota 1X2: ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: Number((mlProb * 100).toFixed(1)),
        pick: 'ML',
        pickLabel: `Gana ${mlTeam.abbreviation}`,
        rationale: `${mlTeam.short_name} presenta superioridad ofensiva/defensiva clara (≥62% prob. victoria directa).`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [{ label: 'Favorito Sólido', tone: 'emerald' }],
      });
    } else if ((mlImplied != null && mlProb * 100 - mlImplied >= 4 && mlProb >= 0.48) || mlProb >= 0.52) {
      const conf = clampConf(Math.min(67, mlProb * 100));
      const oddsVal = computePropOddsFromConfidence(conf, mlBookOdds);
      recs.push({
        id: `fb_ml_val_${game.id}`,
        scope: 'team',
        strategy: 'value',
        marketCategory: 'result',
        teamId: mlTeam.id,
        projectedValue: Number((mlProb * 100).toFixed(1)),
        marketLabel: 'Ganador 1X2 (Valor)',
        subjectName: mlTeam.short_name,
        teamAbbr: mlTeam.abbreviation,
        statSummary:
          mlImplied != null
            ? `Poisson ${Math.round(mlProb * 100)}% vs implícita casa ${Math.round(mlImplied)}%`
            : `Poisson ${Math.round(mlProb * 100)}% de triunfo directo`,
        marketLineText: `Cuota 1X2: ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: Number((mlImplied ?? 50).toFixed(1)),
        pick: 'ML',
        pickLabel: `Gana ${mlTeam.abbreviation}`,
        rationale:
          mlImplied != null
            ? `Modelo proyecta +${(mlProb * 100 - mlImplied).toFixed(1)}% de valor frente a la cuota de victoria directa.`
            : `${mlTeam.short_name} lidera el modelo Poisson 1X2 en goles esperados (${poisson.lambdaHome.toFixed(2)}–${poisson.lambdaAway.toFixed(2)}).`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [{ label: '1X2 90m', tone: 'cyan' }],
      });
    }

    const dnbProb = mlProb / Math.max(0.01, mlProb + otherMlProb);
    if (dnbProb >= 0.59) {
      const isSafeDnb = dnbProb >= 0.72;
      const conf = clampConf(Math.min(84, dnbProb * 100));
      const oddsVal = computePropOddsFromConfidence(conf);
      recs.push({
        id: `fb_dnb_${isSafeDnb ? 'safe' : 'val'}_${game.id}`,
        scope: 'team',
        strategy: isSafeDnb ? 'safe' : 'value',
        marketCategory: 'result',
        teamId: mlTeam.id,
        projectedValue: Number((dnbProb * 100).toFixed(1)),
        marketLabel: isSafeDnb ? 'Sin Empate (DNB) · Segura' : 'Apuesta Sin Empate (DNB)',
        subjectName: mlTeam.short_name,
        teamAbbr: mlTeam.abbreviation,
        statSummary: `${Math.round(dnbProb * 100)}% sin empate (empate reembolsa)`,
        marketLineText: `DNB (0.0) · Cuota ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: Number((dnbProb * 100).toFixed(1)),
        pick: 'ML',
        pickLabel: `${mlTeam.abbreviation} Sin Empate`,
        rationale: `${mlTeam.short_name} domina la expectativa goleadora con protección de reembolso ante igualdad.`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [
          ...(isSafeDnb ? [{ label: 'Línea Segura', tone: 'emerald' as const }] : []),
          { label: `DNB ${Math.round(dnbProb * 100)}%`, tone: 'cyan' },
        ],
      });
    }

    if (game.odds?.home_spread != null && game.odds?.away_spread != null) {
      const projHomeMargin = poisson.lambdaHome - poisson.lambdaAway;
      const homeSpreadEdge = projHomeMargin + game.odds.home_spread;
      const pickHome = homeSpreadEdge >= 0;
      const chosenTeam = pickHome ? game.home_team : game.away_team;
      const line = pickHome ? game.odds.home_spread : game.odds.away_spread;
      const edge = Math.abs(homeSpreadEdge);
      if (edge >= 0.14) {
        const spConf = clampConf(Math.min(76, 55 + edge * 18));
        const spOdds = computePropOddsFromConfidence(
          spConf,
          pickHome ? game.odds.home_spread_odds : game.odds.away_spread_odds,
        );
        recs.push({
          id: `fb_spread_val_${game.id}`,
          scope: 'team',
          strategy: 'value',
          marketCategory: 'result',
          teamId: chosenTeam.id,
          projectedValue: Number((pickHome ? projHomeMargin : -projHomeMargin).toFixed(2)),
          marketLabel: 'Hándicap Asiático',
          subjectName: chosenTeam.short_name,
          teamAbbr: chosenTeam.abbreviation,
          statSummary: `Margen esp. ${projHomeMargin >= 0 ? '+' : ''}${projHomeMargin.toFixed(2)} vs línea ${line > 0 ? `+${line}` : line}`,
          marketLineText: `Hándicap ${line > 0 ? `+${line}` : line} · Cuota ${spOdds.decimal.toFixed(2)}x`,
          lineValue: line,
          pick: 'SPREAD',
          pickLabel: `${chosenTeam.abbreviation} ${line > 0 ? `+${line}` : line}`,
          rationale: `Margen Poisson esperado favorable para ${chosenTeam.short_name} frente a la línea ${line > 0 ? `+${line}` : line}.`,
          confidence: spConf,
          confidenceTier: getConfidenceTier(spConf),
          estimatedOddsAmerican: spOdds.american,
          estimatedMultiplier: spOdds.decimal,
          contextBadges: [{ label: `Edge ${edge.toFixed(2)} G`, tone: 'cyan' }],
        });
      }
    }

    // 3A. SAFE Total Goles: Más de 1.5 o Menos de 3.5 (calibración Poisson)
    const preferOver15 = poisson.lambdaTotal >= 2.65 || poisson.pOver15 >= poisson.pUnder35;
    const safeGoalProb = Math.min(0.89, preferOver15 ? poisson.pOver15 : poisson.pUnder35);
    if (safeGoalProb >= 0.74) {
      const conf = clampConf(safeGoalProb * 100);
      const oddsVal = computePropOddsFromConfidence(conf);
      const safeLine = preferOver15 ? 1.5 : 3.5;
      recs.push({
        id: `fb_total_safe_${game.id}`,
        scope: 'team',
        strategy: 'safe',
        marketCategory: 'goals',
        projectedValue: Number(poisson.lambdaTotal.toFixed(2)),
        marketLabel: 'Total Goles · Segura',
        subjectName: matchupTitle,
        teamAbbr: matchupAbbr,
        statSummary: `Poisson λ=${poisson.lambdaTotal.toFixed(2)} goles · Prob. real ${conf}%`,
        marketLineText: `Línea Segura: ${preferOver15 ? '+1.5' : '-3.5'} Goles · Cuota ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: safeLine,
        pick: preferOver15 ? 'OVER' : 'UNDER',
        pickLabel: preferOver15 ? 'Más de 1.5 goles' : 'Menos de 3.5 goles',
        rationale: preferOver15
          ? `Distribución Poisson (λ=${poisson.lambdaTotal.toFixed(2)}) otorga ${conf}% de probabilidad a al menos 2 goles.`
          : `Ritmo contenido (λ=${poisson.lambdaTotal.toFixed(2)}) otorga ${conf}% de probabilidad a máximo 3 goles totales.`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [
          { label: 'Línea Segura', tone: 'emerald' },
          { label: `λ ${poisson.lambdaTotal.toFixed(2)} G`, tone: 'cyan' },
        ],
      });
    }

    // 3B. VALUE Total Goles frente a línea estándar (e.g. O/U 2.5)
    const overLineK = Math.floor(totalLine) + 1;
    const pOverStd = totalLine === 2.5 ? poisson.pOver25 : poissonAtLeast(poisson.lambdaTotal, overLineK);
    const pUnderStd = 1 - pOverStd;
    const isOverStd = pOverStd >= pUnderStd;
    const bestStdProb = Math.max(pOverStd, pUnderStd);
    if (bestStdProb >= 0.59) {
      const conf = clampConf(Math.min(72, bestStdProb * 100));
      const bookOdds = isOverStd ? game.odds?.over_odds : game.odds?.under_odds;
      const oddsVal = computePropOddsFromConfidence(conf, bookOdds);
      recs.push({
        id: `fb_total_val_${game.id}`,
        scope: 'team',
        strategy: 'value',
        marketCategory: 'goals',
        projectedValue: Number(poisson.lambdaTotal.toFixed(2)),
        marketLabel: 'Total Goles del Partido',
        subjectName: matchupTitle,
        teamAbbr: matchupAbbr,
        statSummary: `Poisson λ=${poisson.lambdaTotal.toFixed(2)} G · Prob. ${isOverStd ? 'Over' : 'Under'} ${totalLine}: ${conf}%`,
        marketLineText: `O/U ${totalLine} · Cuota ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: totalLine,
        pick: isOverStd ? 'OVER' : 'UNDER',
        pickLabel: `${isOverStd ? 'Más de' : 'Menos de'} ${totalLine} goles`,
        rationale: `Frecuencia combinada de goles proyecta ${conf}% de acierto para la línea estándar ${totalLine}.`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [{ label: `λ ${poisson.lambdaTotal.toFixed(2)} G`, tone: isOverStd ? 'emerald' : 'cyan' }],
      });
    }

    // 3C. Goles por Equipo (Local & Visita — Safe & Value)
    for (const side of [
      {
        team: game.home_team,
        exp: poisson.lambdaHome,
        recVals: collectRecentTeamGoals(game.home_team_id, homeRecentGames),
      },
      {
        team: game.away_team,
        exp: poisson.lambdaAway,
        recVals: collectRecentTeamGoals(game.away_team_id, awayRecentGames),
      },
    ]) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_goals',
          idSuffix: String(side.team.id),
          category: 'goals',
          marketLabel: 'Goles por Equipo',
          safeLabel: 'Goles por Equipo · Segura',
          subjectName: side.team.short_name,
          teamAbbr: side.team.abbreviation,
          teamId: side.team.id,
          unitLabel: 'Goles',
          proj: side.exp,
          recentVals: side.recVals,
          priorSd: 1.1,
          minLine: 0.5,
          maxSafeStepDown: 1,
          safeMinCal: 0.68,
          valueMinCal: 0.57,
          badgeTone: 'emerald',
          detailPrefix: `λ equipo ${side.exp.toFixed(2)} G`,
          rationaleOver: (line, p, hitTxt) =>
            `${side.team.short_name} proyecta λ=${p.toFixed(2)} goles propios frente a defensa rival (${hitTxt}) sobre ${line}.`,
          rationaleUnder: (line, p, hitTxt) =>
            `${side.team.short_name} con techo bajo (λ=${p.toFixed(2)} G) bajo ${line} (${hitTxt}).`,
        }),
      );
    }

    // 3D. BTTS (Safe / Value)
    const blendedBtts = poisson.pBtts * 0.65 + recentBttsRate * 0.35;
    const bttsYes = blendedBtts >= 0.62;
    const bttsNo = blendedBtts <= 0.38;
    if (bttsYes || bttsNo) {
      const bttsProb = bttsYes ? blendedBtts : 1 - blendedBtts;
      const conf = clampConf(Math.min(76, bttsProb * 100));
      const oddsVal = computePropOddsFromConfidence(conf);
      recs.push({
        id: `fb_btts_val_${game.id}`,
        scope: 'team',
        strategy: conf >= 72 ? 'safe' : 'value',
        marketCategory: 'goals',
        projectedValue: Number((blendedBtts * 100).toFixed(1)),
        marketLabel: 'Ambos Equipos Anotan (BTTS)',
        subjectName: `${game.away_team.abbreviation} @ ${game.home_team.abbreviation}`,
        teamAbbr: 'BTTS',
        statSummary: `Poisson ${(poisson.pBtts * 100).toFixed(0)}% · Reciente ${game.home_team.abbreviation} ${homeBtts.hits}/${homeBtts.tracked}, ${game.away_team.abbreviation} ${awayBtts.hits}/${awayBtts.tracked}`,
        marketLineText: `Sí / No · Cuota ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: 0.5,
        pick: bttsYes ? 'OVER' : 'UNDER',
        pickLabel: bttsYes ? 'Ambos Anotan: SÍ' : 'Ambos Anotan: NO',
        rationale: bttsYes
          ? `Ambos ataques superan umbral de anotación mutua (${conf}% prob. calibrada).`
          : `Alta probabilidad de al menos una portería a cero (${conf}% prob. BTTS No).`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [{ label: `BTTS ${Math.round(blendedBtts * 100)}%`, tone: bttsYes ? 'emerald' : 'amber' }],
      });
    }

    // 3E. Goles 1er Tiempo (1T)
    if (proj.htTotalGoals != null) {
      const htVals = combinedGames
        .map(extractHalfTimeGoals)
        .filter((x): x is NonNullable<typeof x> => x != null)
        .map((x) => x.total);
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_ht_goals',
          idSuffix: String(game.id),
          category: 'goals',
          marketLabel: 'Goles 1er Tiempo (1T)',
          safeLabel: 'Goles 1T · Segura',
          subjectName: matchupTitle,
          teamAbbr: '1T',
          unitLabel: 'Goles 1T',
          proj: proj.htTotalGoals,
          recentVals: htVals,
          priorSd: 0.9,
          minLine: 0.5,
          maxSafeStepDown: 1,
          safeMinCal: 0.67,
          valueMinCal: 0.57,
          badgeTone: 'cyan',
          detailPrefix: `Proy. 1er tiempo ${proj.htTotalGoals.toFixed(2)} G`,
          rationaleOver: (_line, p, hitTxt) => `Se esperan ${p.toFixed(2)} goles en primera mitad (${hitTxt}).`,
          rationaleUnder: (line, p, hitTxt) => `Primeros tiempos cerrados (~${p.toFixed(2)} G en 1T) bajo ${line} (${hitTxt}).`,
        }),
      );
    }
  }

  // 4. CORNERS MARKETS (Total + Per Team, only when boxscore tracked)
  if (proj.totalCorners != null && proj.totalCorners >= 4) {
    recs.push(
      ...emitCalibratedCountMarketProps({
        idPrefix: 'fb_corners_total',
        idSuffix: String(game.id),
        category: 'corners',
        marketLabel: 'Total Córners del Partido',
        safeLabel: 'Total Córners · Segura',
        subjectName: matchupTitle,
        teamAbbr: matchupAbbr,
        unitLabel: 'Córners',
        proj: proj.totalCorners,
        recentVals: collectRecentMatchStat(combinedGames, 'corners'),
        priorSd: 3.1,
        minLine: 6.5,
        badgeTone: 'cyan',
        detailPrefix: `${game.home_team.abbreviation} ${(proj.homeCorners ?? 0).toFixed(1)} + ${game.away_team.abbreviation} ${(proj.awayCorners ?? 0).toFixed(1)}`,
        rationaleOver: (line, p, hitTxt) => `Volumen ofensivo proyecta ${p.toFixed(1)} córners totales frente a ${line} (${hitTxt}).`,
        rationaleUnder: (line, p, hitTxt) => `Cruces cerrados proyectan ${p.toFixed(1)} córners por debajo de ${line} (${hitTxt}).`,
      }),
    );

    if (proj.homeCorners != null) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_corners',
          idSuffix: String(game.home_team_id),
          category: 'corners',
          marketLabel: 'Córners por Equipo',
          safeLabel: 'Córners Equipo · Segura',
          subjectName: game.home_team.short_name,
          teamAbbr: game.home_team.abbreviation,
          teamId: game.home_team_id,
          unitLabel: 'Córners',
          proj: proj.homeCorners,
          recentVals: collectRecentTeamStat(game.home_team_id, homeRecentGames, 'corners'),
          priorSd: 2.3,
          minLine: 2.5,
          badgeTone: 'cyan',
          detailPrefix: `Prom. ${Number(homeTeamAvg?.corners_pg ?? proj.homeCorners).toFixed(1)} Cór/PJ`,
          rationaleOver: (line, p, hitTxt) => `${game.home_team.short_name} promedia ${p.toFixed(1)} córners esperados en casa frente a ${line} (${hitTxt}).`,
          rationaleUnder: (line, p, hitTxt) => `Poca producción de córners (${p.toFixed(1)} proy.) bajo ${line} (${hitTxt}).`,
        }),
      );
    }

    if (proj.awayCorners != null) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_corners',
          idSuffix: String(game.away_team_id),
          category: 'corners',
          marketLabel: 'Córners por Equipo',
          safeLabel: 'Córners Equipo · Segura',
          subjectName: game.away_team.short_name,
          teamAbbr: game.away_team.abbreviation,
          teamId: game.away_team_id,
          unitLabel: 'Córners',
          proj: proj.awayCorners,
          recentVals: collectRecentTeamStat(game.away_team_id, awayRecentGames, 'corners'),
          priorSd: 2.2,
          minLine: 2.5,
          badgeTone: 'cyan',
          detailPrefix: `Prom. ${Number(awayTeamAvg?.corners_pg ?? proj.awayCorners).toFixed(1)} Cór/PJ`,
          rationaleOver: (line, _p, hitTxt) => `${game.away_team.short_name} supera ${line} tiros de esquina por presión ofensiva (${hitTxt}).`,
          rationaleUnder: (_line, p, hitTxt) => `${game.away_team.short_name} limitado a ~${p.toFixed(1)} córners como visita (${hitTxt}).`,
        }),
      );
    }
  }

  // 5. FOULS MARKETS (Total + Per Team)
  if (proj.totalFouls != null && proj.totalFouls >= 10) {
    recs.push(
      ...emitCalibratedCountMarketProps({
        idPrefix: 'fb_fouls_total',
        idSuffix: String(game.id),
        category: 'fouls',
        marketLabel: 'Total Faltas del Partido',
        safeLabel: 'Total Faltas · Segura',
        subjectName: matchupTitle,
        teamAbbr: matchupAbbr,
        unitLabel: 'Faltas',
        proj: proj.totalFouls,
        recentVals: collectRecentMatchStat(combinedGames, 'fouls'),
        priorSd: 4.8,
        minLine: 16.5,
        badgeTone: 'amber',
        detailPrefix: `${game.home_team.abbreviation} ${(proj.homeFouls ?? 0).toFixed(1)} + ${game.away_team.abbreviation} ${(proj.awayFouls ?? 0).toFixed(1)}`,
        rationaleOver: (line, p, hitTxt) => `Intensidad táctica proyecta ${p.toFixed(1)} faltas totales por encima de ${line} (${hitTxt}).`,
        rationaleUnder: (line, p, hitTxt) => `Juego fluido proyecta menos de ${line} infracciones (~${p.toFixed(1)}, ${hitTxt}).`,
      }),
    );

    if (proj.homeFouls != null) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_fouls',
          idSuffix: String(game.home_team_id),
          category: 'fouls',
          marketLabel: 'Faltas por Equipo',
          safeLabel: 'Faltas Equipo · Segura',
          subjectName: game.home_team.short_name,
          teamAbbr: game.home_team.abbreviation,
          teamId: game.home_team_id,
          unitLabel: 'Faltas',
          proj: proj.homeFouls,
          recentVals: collectRecentTeamStat(game.home_team_id, homeRecentGames, 'fouls'),
          priorSd: 3.1,
          minLine: 7.5,
          badgeTone: 'amber',
          detailPrefix: `Comete ${Number(homeTeamAvg?.fouls_pg ?? proj.homeFouls).toFixed(1)} Fal/PJ`,
          rationaleOver: (_line, p, hitTxt) => `${game.home_team.short_name} promedia ${p.toFixed(1)} faltas ante rivales que provocan contacto (${hitTxt}).`,
          rationaleUnder: (line, p, hitTxt) => `${game.home_team.short_name} mantiene juego limpio (~${p.toFixed(1)} faltas vs ${line}, ${hitTxt}).`,
        }),
      );
    }

    if (proj.awayFouls != null) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_fouls',
          idSuffix: String(game.away_team_id),
          category: 'fouls',
          marketLabel: 'Faltas por Equipo',
          safeLabel: 'Faltas Equipo · Segura',
          subjectName: game.away_team.short_name,
          teamAbbr: game.away_team.abbreviation,
          teamId: game.away_team_id,
          unitLabel: 'Faltas',
          proj: proj.awayFouls,
          recentVals: collectRecentTeamStat(game.away_team_id, awayRecentGames, 'fouls'),
          priorSd: 3.1,
          minLine: 7.5,
          badgeTone: 'amber',
          detailPrefix: `Comete ${Number(awayTeamAvg?.fouls_pg ?? proj.awayFouls).toFixed(1)} Fal/PJ`,
          rationaleOver: (line, p, hitTxt) => `${game.away_team.short_name} corta el juego visitante (~${p.toFixed(1)} faltas sobre ${line}, ${hitTxt}).`,
          rationaleUnder: (line, _p, hitTxt) => `Bajo desgaste defensivo proyecta menos de ${line} faltas (${hitTxt}).`,
        }),
      );
    }
  }

  // 6. YELLOW CARDS MARKETS (Total + Per Team)
  if (proj.totalCards != null && proj.totalCards >= 2.0) {
    recs.push(
      ...emitCalibratedCountMarketProps({
        idPrefix: 'fb_cards_total',
        idSuffix: String(game.id),
        category: 'cards',
        marketLabel: 'Tarjetas Amarillas (Total)',
        safeLabel: 'Amarillas Total · Segura',
        subjectName: matchupTitle,
        teamAbbr: matchupAbbr,
        unitLabel: 'TA',
        proj: proj.totalCards,
        recentVals: collectRecentMatchStat(combinedGames, 'yellow_cards'),
        priorSd: 1.8,
        minLine: 2.5,
        badgeTone: 'rose',
        detailPrefix: `${game.home_team.abbreviation} ${(proj.homeCards ?? 0).toFixed(1)} + ${game.away_team.abbreviation} ${(proj.awayCards ?? 0).toFixed(1)}`,
        rationaleOver: (line, p, hitTxt) => `Cruce disputado proyecta ${p.toFixed(1)} tarjetas amarillas combinadas sobre ${line} (${hitTxt}).`,
        rationaleUnder: (line, p, hitTxt) => `Baja incidencia disciplinaria proyecta ${p.toFixed(1)} TA bajo ${line} (${hitTxt}).`,
      }),
    );

    if (proj.homeCards != null) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_cards',
          idSuffix: String(game.home_team_id),
          category: 'cards',
          marketLabel: 'Tarjetas por Equipo',
          safeLabel: 'Tarjetas Equipo · Segura',
          subjectName: game.home_team.short_name,
          teamAbbr: game.home_team.abbreviation,
          teamId: game.home_team_id,
          unitLabel: 'TA',
          proj: proj.homeCards,
          recentVals: collectRecentTeamStat(game.home_team_id, homeRecentGames, 'yellow_cards'),
          priorSd: 1.2,
          minLine: 0.5,
          badgeTone: 'rose',
          detailPrefix: `Recibe ${Number(homeTeamAvg?.yellow_cards_pg ?? proj.homeCards).toFixed(2)} TA/PJ`,
          rationaleOver: (_line, p, hitTxt) => `${game.home_team.short_name} registra ~${p.toFixed(2)} amarillas por partido (${hitTxt}).`,
          rationaleUnder: (line, p, hitTxt) => `${game.home_team.short_name} mantiene disciplina (~${p.toFixed(2)} TA) bajo ${line} (${hitTxt}).`,
        }),
      );
    }

    if (proj.awayCards != null) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_cards',
          idSuffix: String(game.away_team_id),
          category: 'cards',
          marketLabel: 'Tarjetas por Equipo',
          safeLabel: 'Tarjetas Equipo · Segura',
          subjectName: game.away_team.short_name,
          teamAbbr: game.away_team.abbreviation,
          teamId: game.away_team_id,
          unitLabel: 'TA',
          proj: proj.awayCards,
          recentVals: collectRecentTeamStat(game.away_team_id, awayRecentGames, 'yellow_cards'),
          priorSd: 1.2,
          minLine: 0.5,
          badgeTone: 'rose',
          detailPrefix: `Recibe ${Number(awayTeamAvg?.yellow_cards_pg ?? proj.awayCards).toFixed(2)} TA/PJ`,
          rationaleOver: (_line, p, hitTxt) => `${game.away_team.short_name} proyecta ${p.toFixed(2)} amarillas jugando fuera (${hitTxt}).`,
          rationaleUnder: (line, p, hitTxt) => `${game.away_team.short_name} promedia ${p.toFixed(2)} TA, debajo de ${line} (${hitTxt}).`,
        }),
      );
    }
  }

  // 7. SHOTS & SHOTS ON TARGET MARKETS (Total + Per Team)
  if (proj.totalShots != null && proj.totalShots >= 12) {
    recs.push(
      ...emitCalibratedCountMarketProps({
        idPrefix: 'fb_shots_total',
        idSuffix: String(game.id),
        category: 'shots',
        marketLabel: 'Total Remates del Partido',
        safeLabel: 'Total Remates · Segura',
        subjectName: matchupTitle,
        teamAbbr: matchupAbbr,
        unitLabel: 'Remates',
        proj: proj.totalShots,
        recentVals: collectRecentMatchStat(combinedGames, 'shots'),
        priorSd: 5.2,
        minLine: 17.5,
        badgeTone: 'slate',
        detailPrefix: `${game.home_team.abbreviation} ${(proj.homeShots ?? 0).toFixed(1)} + ${game.away_team.abbreviation} ${(proj.awayShots ?? 0).toFixed(1)}`,
        rationaleOver: (line, p, hitTxt) => `Volumen ofensivo proyecta ${p.toFixed(1)} remates totales sobre ${line} (${hitTxt}).`,
        rationaleUnder: (line, p, hitTxt) => `Planteo táctico cerrado proyecta ${p.toFixed(1)} remates bajo ${line} (${hitTxt}).`,
      }),
    );

    if (proj.homeShots != null) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_shots',
          idSuffix: String(game.home_team_id),
          category: 'shots',
          marketLabel: 'Remates por Equipo',
          safeLabel: 'Remates Equipo · Segura',
          subjectName: game.home_team.short_name,
          teamAbbr: game.home_team.abbreviation,
          teamId: game.home_team_id,
          unitLabel: 'Remates',
          proj: proj.homeShots,
          recentVals: collectRecentTeamStat(game.home_team_id, homeRecentGames, 'shots'),
          priorSd: 3.6,
          minLine: 7.5,
          badgeTone: 'slate',
          detailPrefix: `Dispara ${Number(homeTeamAvg?.shots_pg ?? proj.homeShots).toFixed(1)}/PJ`,
          rationaleOver: (line, p, hitTxt) => `${game.home_team.short_name} promedia ${p.toFixed(1)} remates en casa frente a ${line} (${hitTxt}).`,
          rationaleUnder: (line, p, hitTxt) => `${game.home_team.short_name} queda limitado a ~${p.toFixed(1)} remates bajo ${line} (${hitTxt}).`,
        }),
      );
    }

    if (proj.awayShots != null) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_shots',
          idSuffix: String(game.away_team_id),
          category: 'shots',
          marketLabel: 'Remates por Equipo',
          safeLabel: 'Remates Equipo · Segura',
          subjectName: game.away_team.short_name,
          teamAbbr: game.away_team.abbreviation,
          teamId: game.away_team_id,
          unitLabel: 'Remates',
          proj: proj.awayShots,
          recentVals: collectRecentTeamStat(game.away_team_id, awayRecentGames, 'shots'),
          priorSd: 3.4,
          minLine: 6.5,
          badgeTone: 'slate',
          detailPrefix: `Dispara ${Number(awayTeamAvg?.shots_pg ?? proj.awayShots).toFixed(1)}/PJ`,
          rationaleOver: (_line, p, hitTxt) => `${game.away_team.short_name} remata ~${p.toFixed(1)} veces por encuentro (${hitTxt}).`,
          rationaleUnder: (_line, p, hitTxt) => `Defensa local restringe a ${game.away_team.short_name} (~${p.toFixed(1)} REM, ${hitTxt}).`,
        }),
      );
    }
  }

  if (proj.totalSot != null && proj.totalSot >= 4) {
    recs.push(
      ...emitCalibratedCountMarketProps({
        idPrefix: 'fb_sot_total',
        idSuffix: String(game.id),
        category: 'shots',
        marketLabel: 'Remates al Arco (Total)',
        safeLabel: 'Al Arco Total · Segura',
        subjectName: matchupTitle,
        teamAbbr: matchupAbbr,
        unitLabel: 'Al Arco',
        proj: proj.totalSot,
        recentVals: collectRecentMatchStat(combinedGames, 'shots_on_target'),
        priorSd: 2.8,
        minLine: 5.5,
        badgeTone: 'emerald',
        detailPrefix: `${game.home_team.abbreviation} ${(proj.homeSot ?? 0).toFixed(1)} + ${game.away_team.abbreviation} ${(proj.awaySot ?? 0).toFixed(1)}`,
        rationaleOver: (line, p, hitTxt) => `Puntería ofensiva proyecta ${p.toFixed(1)} remates a portería sobre ${line} (${hitTxt}).`,
        rationaleUnder: (line, p, hitTxt) => `Baja efectividad proyecta menos de ${line} disparos al arco (~${p.toFixed(1)}, ${hitTxt}).`,
      }),
    );

    if (proj.homeSot != null) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_sot',
          idSuffix: String(game.home_team_id),
          category: 'shots',
          marketLabel: 'Al Arco por Equipo',
          safeLabel: 'Al Arco Equipo · Segura',
          subjectName: game.home_team.short_name,
          teamAbbr: game.home_team.abbreviation,
          teamId: game.home_team_id,
          unitLabel: 'Al Arco',
          proj: proj.homeSot,
          recentVals: collectRecentTeamStat(game.home_team_id, homeRecentGames, 'shots_on_target'),
          priorSd: 1.9,
          minLine: 2.5,
          badgeTone: 'emerald',
          detailPrefix: `Puntería ${Number(homeTeamAvg?.sot_pg ?? proj.homeSot).toFixed(1)}/PJ`,
          rationaleOver: (_line, p, hitTxt) => `${game.home_team.short_name} proyecta ${p.toFixed(1)} remates a portería (${hitTxt}).`,
          rationaleUnder: (line, _p, hitTxt) => `${game.home_team.short_name} queda bajo ${line} tiros al arco (${hitTxt}).`,
        }),
      );
    }

    if (proj.awaySot != null) {
      recs.push(
        ...emitCalibratedCountMarketProps({
          idPrefix: 'fb_team_sot',
          idSuffix: String(game.away_team_id),
          category: 'shots',
          marketLabel: 'Al Arco por Equipo',
          safeLabel: 'Al Arco Equipo · Segura',
          subjectName: game.away_team.short_name,
          teamAbbr: game.away_team.abbreviation,
          teamId: game.away_team_id,
          unitLabel: 'Al Arco',
          proj: proj.awaySot,
          recentVals: collectRecentTeamStat(game.away_team_id, awayRecentGames, 'shots_on_target'),
          priorSd: 1.8,
          minLine: 1.5,
          badgeTone: 'emerald',
          detailPrefix: `Puntería ${Number(awayTeamAvg?.sot_pg ?? proj.awaySot).toFixed(1)}/PJ`,
          rationaleOver: (line, _p, hitTxt) => `${game.away_team.short_name} supera ${line} tiros al arco en sus cruces (${hitTxt}).`,
          rationaleUnder: (line, p, hitTxt) => `${game.away_team.short_name} proyecta ${p.toFixed(1)} al arco bajo ${line} (${hitTxt}).`,
        }),
      );
    }
  }

  // 8. OTHER TEAM MARKETS (Offsides & Saves)
  if (proj.totalOffsides != null && proj.totalOffsides >= 1.5) {
    recs.push(
      ...emitCalibratedCountMarketProps({
        idPrefix: 'fb_offsides_total',
        idSuffix: String(game.id),
        category: 'other',
        marketLabel: 'Fueras de Juego (Total)',
        safeLabel: 'Offsides · Segura',
        subjectName: matchupTitle,
        teamAbbr: matchupAbbr,
        unitLabel: 'Offsides',
        proj: proj.totalOffsides,
        recentVals: collectRecentMatchStat(combinedGames, 'offsides'),
        priorSd: 1.9,
        minLine: 1.5,
        badgeTone: 'slate',
        detailPrefix: 'Línea combinada de offside',
        rationaleOver: (line, p, hitTxt) => `Defensas adelantadas proyectan ${p.toFixed(1)} offsides sobre ${line} (${hitTxt}).`,
        rationaleUnder: (_line, p, hitTxt) => `Bloques bajos reducen fueras de juego (~${p.toFixed(1)}, ${hitTxt}).`,
      }),
    );
  }

  if (proj.totalSaves != null && proj.totalSaves >= 3.0) {
    recs.push(
      ...emitCalibratedCountMarketProps({
        idPrefix: 'fb_saves_total',
        idSuffix: String(game.id),
        category: 'other',
        marketLabel: 'Atajadas Combinadas',
        safeLabel: 'Atajadas · Segura',
        subjectName: matchupTitle,
        teamAbbr: matchupAbbr,
        unitLabel: 'Atajadas',
        proj: proj.totalSaves,
        recentVals: collectRecentMatchStat(combinedGames, 'saves'),
        priorSd: 2.3,
        minLine: 3.5,
        badgeTone: 'cyan',
        detailPrefix: 'Intervenciones de porteros',
        rationaleOver: (_line, p, hitTxt) => `Volumen de disparos al arco exige ~${p.toFixed(1)} atajadas (${hitTxt}).`,
        rationaleUnder: (line, _p, hitTxt) => `Pocos remates limpios proyectan menos de ${line} atajadas (${hitTxt}).`,
      }),
    );
  }

  // 9. PLAYER PROPS (Poisson + Titulares Regulares across all 9 metrics)
  const logsByPlayer = new Map<number, PlayerGameStat[]>();
  const allLoggedGameIds = new Set<number>();
  for (const log of playerRecentLogs) {
    allLoggedGameIds.add(log.game_id);
    const arr = logsByPlayer.get(log.player_id) ?? [];
    arr.push(log);
    logsByPlayer.set(log.player_id, arr);
  }

  const safePlayerPool: PropRecommendation[] = [];
  const valuePlayerPool: PropRecommendation[] = [];

  for (const p of keyPlayers) {
    if (p.gp < 4) continue;
    const startsRatio = p.gp > 0 ? p.starts / p.gp : 0;
    if (startsRatio < 0.6) continue;

    const isHome = p.team_id === game.home_team_id;
    const teamAbbr = isHome ? game.home_team.abbreviation : game.away_team.abbreviation;
    const pAllLogs = (logsByPlayer.get(p.player_id) ?? []).filter((r) => !r.did_not_play);
    const teamRecentGames = isHome ? homeRecentGames : awayRecentGames;
    const avail = checkPlayerAvailability({
      playerId: p.player_id,
      statusText: playerStatuses?.[p.player_id],
      playerLogs: pAllLogs,
      teamRecentGames,
      allLoggedGameIds,
      sport: 'football',
    });
    if (!avail.available) continue;

    const oppAvg = isHome ? awayTeamAvg : homeTeamAvg;
    const oppGa = oppAvg?.ga_pg ?? (isHome ? (awayRecent.gamesCount > 0 ? awayRecent.avgAgainst : null) : (homeRecent.gamesCount > 0 ? homeRecent.avgAgainst : null));
    const oppMod = oppGa != null ? Math.max(0.86, Math.min(1.16, 1 + (Number(oppGa) - 1.35) * 0.14)) : 1.0;

    const { safe, value } = buildCalibratedFootballPlayerCandidates({
      player: p,
      teamAbbr,
      pLogs: pAllLogs.slice(0, 10),
      oppMod,
      oppSotPg: oppAvg?.sot_pg != null ? Number(oppAvg.sot_pg) : null,
      allowSafe: !avail.questionable,
    });

    if (safe.length > 0) {
      const pickedSafe = selectPlayableSafeCandidate(safe);
      if (pickedSafe) safePlayerPool.push(pickedSafe);
    }
    if (value.length > 0) {
      value.sort((a, b) => b.confidence - a.confidence);
      valuePlayerPool.push(value[0]);
      if (value[1] && value[1].footballMetricKey !== value[0].footballMetricKey) {
        valuePlayerPool.push(value[1]);
      }
    }
  }

  safePlayerPool.sort((a, b) => b.confidence - a.confidence);
  valuePlayerPool.sort((a, b) => b.confidence - a.confidence);
  recs.push(...safePlayerPool.slice(0, 14), ...valuePlayerPool.slice(0, 12));

  return recs.sort((a, b) => b.confidence - a.confidence);
}

function buildCalibratedFootballPlayerCandidates(params: {
  player: FootballPlayerSeasonAverage;
  teamAbbr: string;
  pLogs: PlayerGameStat[];
  oppMod: number;
  oppSotPg: number | null;
  allowSafe: boolean;
}): { safe: PropRecommendation[]; value: PropRecommendation[] } {
  const { player: p, teamAbbr, pLogs, oppMod, oppSotPg, allowSafe } = params;
  const safe: PropRecommendation[] = [];
  const value: PropRecommendation[] = [];
  const gp = Math.max(1, p.gp);
  const startsRatio = p.gp > 0 ? p.starts / p.gp : 0;
  const isGoalkeeper = (p.position ?? '').toUpperCase() === 'G' || Number(p.saves_pg ?? p.saves / gp) >= 1.5;

  const blendCalProb = (pPois: number, empHits: number, total: number, maxCap: number): number => {
    const smoothed = smoothEmpiricalRate(empHits, total, pPois);
    if (total >= 5 && startsRatio >= 0.65) {
      return Math.min(maxCap, 0.46 * pPois + 0.54 * smoothed);
    }
    return Math.min(maxCap, total >= 4 ? 0.65 * pPois + 0.35 * smoothed : pPois);
  };

  if (isGoalkeeper) {
    const savesPg = Number(p.saves_pg ?? p.saves / gp);
    if (savesPg >= 1.8) {
      const recentSaves = pLogs.map((l) => getFootballPlayerStatValue(l, 'saves'));
      const recAvg =
        recentSaves.length > 0 ? recentSaves.reduce((a, b) => a + b, 0) / recentSaves.length : savesPg;
      const gkOppMod = oppSotPg != null ? Math.max(0.84, Math.min(1.22, oppSotPg / 4.2)) : 1.0;
      const lambdaSaves = Math.max(
        0.5,
        (recentSaves.length >= 3 ? savesPg * 0.7 + recAvg * 0.3 : savesPg) * gkOppMod,
      );

      let chosenSafeSaveLine: number | null = null;
      if (allowSafe) {
        const candidates = [
          { line: 3.5, targetK: 4, minPg: 3.6, minCal: 0.67 },
          { line: 2.5, targetK: 3, minPg: 2.6, minCal: 0.67 },
          { line: 1.5, targetK: 2, minPg: 1.8, minCal: 0.68 },
        ];
        for (const c of candidates) {
          if (savesPg < c.minPg) continue;
          const pPois = poissonAtLeast(lambdaSaves, c.targetK);
          const empHits = recentSaves.filter((v) => v >= c.targetK).length;
          const empRate = recentSaves.length > 0 ? empHits / recentSaves.length : pPois;
          const pCal = blendCalProb(pPois, empHits, recentSaves.length, 0.85);
          if (pCal >= c.minCal && (recentSaves.length < 4 || empRate >= 0.58)) {
            chosenSafeSaveLine = c.line;
            const conf = clampConf(pCal * 100);
            const oddsVal = computePropOddsFromConfidence(conf);
            safe.push({
              id: `fb_psaves_${p.player_id}_safe`,
              scope: 'player',
              strategy: 'safe',
              marketCategory: 'player',
              projectedValue: Number(lambdaSaves.toFixed(2)),
              marketLabel: 'Atajadas del Portero · Segura',
              subjectName: p.full_name,
              teamAbbr,
              playerId: p.player_id,
              footballMetricKey: 'saves',
              statSummary: `${savesPg.toFixed(1)} atajadas/PJ · Cumplió ${empHits}/${recentSaves.length || p.gp}`,
              marketLineText: `Línea Segura: +${c.line} Atajadas · Cuota ${oddsVal.decimal.toFixed(2)}x`,
              lineValue: c.line,
              pick: 'OVER',
              pickLabel: `Más de ${c.line} Atajadas`,
              rationale: `Volumen de paradas proyecta λ=${lambdaSaves.toFixed(2)} atajadas (${conf}% prob. Poisson).`,
              confidence: conf,
              confidenceTier: getConfidenceTier(conf),
              estimatedOddsAmerican: oddsVal.american,
              estimatedMultiplier: oddsVal.decimal,
              contextBadges: [
                { label: 'Línea Segura', tone: 'emerald' },
                { label: `${savesPg.toFixed(1)} ATAJ/PJ`, tone: 'cyan' },
              ],
            });
            break;
          }
        }
      }

      const valLine =
        chosenSafeSaveLine != null
          ? chosenSafeSaveLine + 1
          : savesPg >= 3.4
            ? 3.5
            : savesPg >= 2.4
              ? 2.5
              : 1.5;
      const valK = Math.ceil(valLine);
      const pPoisVal = poissonAtLeast(lambdaSaves, valK);
      const valHits = recentSaves.filter((v) => v >= valK).length;
      const valEmpRate = recentSaves.length > 0 ? valHits / recentSaves.length : pPoisVal;
      const pCalVal = blendCalProb(pPoisVal, valHits, recentSaves.length, 0.72);
      if (pCalVal >= 0.42 && (recentSaves.length < 4 || valEmpRate >= 0.4)) {
        const conf = Math.max(42, Math.min(72, Math.round(pCalVal * 100)));
        const oddsVal = computePropOddsFromConfidence(conf);
        value.push({
          id: `fb_psaves_${p.player_id}_val`,
          scope: 'player',
          strategy: 'value',
          marketCategory: 'player',
          projectedValue: Number(lambdaSaves.toFixed(2)),
          marketLabel: 'Atajadas del Portero',
          subjectName: p.full_name,
          teamAbbr,
          playerId: p.player_id,
          footballMetricKey: 'saves',
          statSummary: `${savesPg.toFixed(1)} atajadas/PJ (${p.saves} tot.)`,
          marketLineText: `O/U ${valLine} Atajadas · Cuota ${oddsVal.decimal.toFixed(2)}x`,
          lineValue: valLine,
          pick: 'OVER',
          pickLabel: `Más de ${valLine} Atajadas`,
          rationale: `Portero promedia ${savesPg.toFixed(1)} paradas y proyecta λ=${lambdaSaves.toFixed(2)} frente al ataque rival.`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [{ label: `${savesPg.toFixed(1)} ATAJ/PJ`, tone: 'cyan' }],
        });
      }
    }
    return { safe, value };
  }

  // 1. Remates Totales
  if (p.shots_pg >= 1.15) {
    const recentShots = pLogs.map((l) => getFootballPlayerStatValue(l, 'shots'));
    const recentAvg =
      recentShots.length > 0 ? recentShots.reduce((a, b) => a + b, 0) / recentShots.length : p.shots_pg;
    const lambdaShots = Math.max(
      0.4,
      (recentShots.length >= 3 ? p.shots_pg * 0.72 + recentAvg * 0.28 : p.shots_pg) * oppMod,
    );

    let chosenSafeShotLine: number | null = null;
    if (allowSafe) {
      let chosenShot: { line: number; pCal: number; empHits: number } | null = null;
      const midCandidates = [
        { line: 2.5, targetK: 3, minPg: 2.65, minCal: 0.67, minEmp: 0.6 },
        { line: 1.5, targetK: 2, minPg: 1.75, minCal: 0.66, minEmp: 0.6 },
      ];
      let empRate15 = 0;
      for (const c of midCandidates) {
        if (p.shots_pg < c.minPg) continue;
        const pPois = poissonAtLeast(lambdaShots, c.targetK);
        const empHits = recentShots.filter((v) => v >= c.targetK).length;
        const empRate = recentShots.length > 0 ? empHits / recentShots.length : pPois;
        if (c.line === 1.5) empRate15 = empRate;
        const pCal = blendCalProb(pPois, empHits, recentShots.length, 0.88);
        if (pCal >= c.minCal && (recentShots.length < 4 || empRate >= c.minEmp)) {
          chosenShot = { line: c.line, pCal, empHits };
          break;
        }
      }
      if (!chosenShot && (p.shots_pg < 1.85 || (recentShots.length >= 4 && empRate15 < 0.6))) {
        const pPois05 = poissonAtLeast(lambdaShots, 1);
        const empHits05 = recentShots.filter((v) => v >= 1).length;
        const empRate05 = recentShots.length > 0 ? empHits05 / recentShots.length : pPois05;
        const pCal05 = blendCalProb(pPois05, empHits05, recentShots.length, 0.83);
        if (pCal05 >= 0.68 && (recentShots.length < 4 || empRate05 >= 0.64)) {
          chosenShot = { line: 0.5, pCal: pCal05, empHits: empHits05 };
        }
      }
      if (chosenShot) {
        chosenSafeShotLine = chosenShot.line;
        const conf = clampConf(chosenShot.pCal * 100);
        const oddsVal = computePropOddsFromConfidence(conf);
        safe.push({
          id: `fb_shots_${p.player_id}_safe`,
          scope: 'player',
          strategy: 'safe',
          marketCategory: 'player',
          projectedValue: Number(lambdaShots.toFixed(2)),
          marketLabel: 'Remates Totales · Segura',
          subjectName: p.full_name,
          teamAbbr,
          playerId: p.player_id,
          footballMetricKey: 'shots',
          statSummary: `${p.shots_pg.toFixed(1)} REM/PJ (${p.starts}/${p.gp} tit.) · Cumplió ${chosenShot.empHits}/${recentShots.length || p.gp}`,
          marketLineText: `Línea Segura: +${chosenShot.line} REM · Cuota ${oddsVal.decimal.toFixed(2)}x`,
          lineValue: chosenShot.line,
          pick: 'OVER',
          pickLabel: `Más de ${chosenShot.line} Remates`,
          rationale: `Poisson λ=${lambdaShots.toFixed(2)} remates y titularidad regular (${p.starts}/${p.gp}) dan ${conf}% para +${chosenShot.line} REM.`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [
            { label: 'Línea Segura', tone: 'emerald' },
            { label: `${p.shots_pg.toFixed(1)} REM/PJ`, tone: 'slate' },
          ],
        });
      }
    }

    let valLine = p.shots_pg >= 2.6 ? 2.5 : 1.5;
    if (chosenSafeShotLine === 2.5) valLine = 3.5;
    else if (chosenSafeShotLine === 1.5) valLine = 2.5;
    else if (chosenSafeShotLine === 0.5) valLine = 1.5;
    const valK = Math.ceil(valLine);
    const pPoisVal = poissonAtLeast(lambdaShots, valK);
    const valHits = recentShots.filter((v) => v >= valK).length;
    const valEmpRate = recentShots.length > 0 ? valHits / recentShots.length : pPoisVal;
    const pCalVal = blendCalProb(pPoisVal, valHits, recentShots.length, 0.72);
    if (pCalVal >= 0.56 && (recentShots.length < 4 || valEmpRate >= 0.5)) {
      const conf = clampConf(pCalVal * 100);
      const oddsVal = computePropOddsFromConfidence(conf);
      value.push({
        id: `fb_shots_${p.player_id}_val`,
        scope: 'player',
        strategy: 'value',
        marketCategory: 'player',
        projectedValue: Number(lambdaShots.toFixed(2)),
        marketLabel: 'Remates Totales',
        subjectName: p.full_name,
        teamAbbr,
        playerId: p.player_id,
        footballMetricKey: 'shots',
        statSummary: `${p.shots_pg.toFixed(1)} REM/PJ (${p.starts}/${p.gp} tit.) · Reciente ${recentAvg.toFixed(1)}`,
        marketLineText: `O/U ${valLine} REM · Cuota ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: valLine,
        pick: 'OVER',
        pickLabel: `Más de ${valLine} Remates`,
        rationale: `Volumen de disparo proyecta λ=${lambdaShots.toFixed(2)} remates (${conf}% prob. Poisson de +${valLine}).`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [{ label: `${p.shots_pg.toFixed(1)} REM/PJ`, tone: 'slate' }],
      });
    }
  }

  // 2. Remates al Arco
  if (p.sot_pg >= 0.85 && allowSafe) {
    const recentSot = pLogs.map((l) => getFootballPlayerStatValue(l, 'sot'));
    const recentAvg =
      recentSot.length > 0 ? recentSot.reduce((a, b) => a + b, 0) / recentSot.length : p.sot_pg;
    const lambdaSot = Math.max(
      0.35,
      (recentSot.length >= 3 ? p.sot_pg * 0.72 + recentAvg * 0.28 : p.sot_pg) * oppMod,
    );
    const sotCandidates = [
      { line: 1.5, targetK: 2, minPg: 1.55, minCal: 0.67, minEmp: 0.6 },
      { line: 0.5, targetK: 1, minPg: 0.85, minCal: 0.68, minEmp: 0.6 },
    ];
    for (const c of sotCandidates) {
      if (p.sot_pg < c.minPg) continue;
      const pPois = poissonAtLeast(lambdaSot, c.targetK);
      const empHits = recentSot.filter((v) => v >= c.targetK).length;
      const empRate = recentSot.length > 0 ? empHits / recentSot.length : pPois;
      const pCal = blendCalProb(pPois, empHits, recentSot.length, 0.84);
      if (pCal >= c.minCal && (recentSot.length < 4 || empRate >= c.minEmp)) {
        const conf = clampConf(pCal * 100);
        const oddsVal = computePropOddsFromConfidence(conf);
        safe.push({
          id: `fb_sot_${p.player_id}_safe`,
          scope: 'player',
          strategy: 'safe',
          marketCategory: 'player',
          projectedValue: Number(lambdaSot.toFixed(2)),
          marketLabel: 'Remates al Arco · Segura',
          subjectName: p.full_name,
          teamAbbr,
          playerId: p.player_id,
          footballMetricKey: 'sot',
          statSummary: `${p.sot_pg.toFixed(2)} SOT/PJ · Cumplió ${empHits}/${recentSot.length || p.gp}`,
          marketLineText: `Línea Segura: +${c.line} Al Arco · Cuota ${oddsVal.decimal.toFixed(2)}x`,
          lineValue: c.line,
          pick: 'OVER',
          pickLabel: `+${c.line} Remates al Arco`,
          rationale: `Frecuencia al arco λ=${lambdaSot.toFixed(2)} proyecta ${conf}% para +${c.line} al arco.`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [
            { label: 'Línea Segura', tone: 'emerald' },
            { label: `${p.sot_pg.toFixed(2)} SOT/PJ`, tone: 'cyan' },
          ],
        });
        break;
      }
    }
  }

  // 3. Anotador (Marca Gol) — Value
  if (p.goals_pg >= 0.45 && p.sot_pg >= 0.85) {
    const recentGoals = pLogs.map((l) => getFootballPlayerStatValue(l, 'goals'));
    const recentAvg =
      recentGoals.length > 0 ? recentGoals.reduce((a, b) => a + b, 0) / recentGoals.length : p.goals_pg;
    const lambdaGoals = Math.max(
      0.2,
      (recentGoals.length >= 3 ? p.goals_pg * 0.78 + recentAvg * 0.22 : p.goals_pg) * oppMod,
    );
    const pPoisGoal = poissonAtLeast(lambdaGoals, 1);
    const empHits = recentGoals.filter((v) => v >= 1).length;
    const empRate = recentGoals.length > 0 ? empHits / recentGoals.length : pPoisGoal;
    const pCal = Math.min(0.64, recentGoals.length >= 4 ? 0.75 * pPoisGoal + 0.25 * empRate : pPoisGoal);
    if (pCal >= 0.48) {
      const conf = clampConf(pCal * 100);
      const oddsVal = computePropOddsFromConfidence(conf);
      value.push({
        id: `fb_goals_${p.player_id}_val`,
        scope: 'player',
        strategy: 'value',
        marketCategory: 'player',
        projectedValue: Number(lambdaGoals.toFixed(2)),
        marketLabel: 'Anotador (Marca Gol)',
        subjectName: p.full_name,
        teamAbbr,
        playerId: p.player_id,
        footballMetricKey: 'goals',
        statSummary: `${p.goals} G en ${p.gp} PJ (${p.goals_pg.toFixed(2)} G/PJ · ${p.sot_pg.toFixed(1)} SOT/PJ)`,
        marketLineText: `O/U 0.5 Goles · Cuota ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: 0.5,
        pick: 'OVER',
        pickLabel: 'Marca Gol (+0.5)',
        rationale: `Goleador (${p.goals_pg.toFixed(2)} G/PJ) con ${conf}% de probabilidad Poisson calibrada.`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [{ label: `${p.goals} Goles`, tone: 'emerald' }],
      });
    }
  }

  // 4. Asistencias & Gol + Asistencia (G+A)
  const assistsPg = Number(p.assists_pg ?? p.assists / gp);
  if (assistsPg >= 0.35) {
    const recentAst = pLogs.map((l) => getFootballPlayerStatValue(l, 'assists'));
    const recAvg = recentAst.length > 0 ? recentAst.reduce((a, b) => a + b, 0) / recentAst.length : assistsPg;
    const lambdaAst = Math.max(0.15, (recentAst.length >= 3 ? assistsPg * 0.75 + recAvg * 0.25 : assistsPg) * oppMod);
    const pPoisAst = poissonAtLeast(lambdaAst, 1);
    const empHits = recentAst.filter((v) => v >= 1).length;
    const pCal = blendCalProb(pPoisAst, empHits, recentAst.length, 0.65);
    if (pCal >= 0.36) {
      const conf = Math.max(36, Math.min(64, Math.round(pCal * 100)));
      const oddsVal = computePropOddsFromConfidence(conf);
      value.push({
        id: `fb_assists_${p.player_id}_val`,
        scope: 'player',
        strategy: 'value',
        marketCategory: 'player',
        projectedValue: Number(lambdaAst.toFixed(2)),
        marketLabel: 'Asistencia en Partido',
        subjectName: p.full_name,
        teamAbbr,
        playerId: p.player_id,
        footballMetricKey: 'assists',
        statSummary: `${p.assists} Asist. en ${p.gp} PJ (${assistsPg.toFixed(2)}/PJ)`,
        marketLineText: `O/U 0.5 Asist. · Cuota ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: 0.5,
        pick: 'OVER',
        pickLabel: 'Da Asistencia (+0.5)',
        rationale: `Generador ofensivo (${assistsPg.toFixed(2)} AST/PJ) con λ=${lambdaAst.toFixed(2)} asistencias.`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [{ label: `${p.assists} Asist.`, tone: 'cyan' }],
      });
    }
  }

  const goalContribPg = Number(p.goal_contrib_pg ?? (p.goals + p.assists) / gp);
  if (goalContribPg >= 0.58) {
    const recentGa = pLogs.map((l) => getFootballPlayerStatValue(l, 'goal_contrib'));
    const recAvg = recentGa.length > 0 ? recentGa.reduce((a, b) => a + b, 0) / recentGa.length : goalContribPg;
    const lambdaGa = Math.max(0.3, (recentGa.length >= 3 ? goalContribPg * 0.72 + recAvg * 0.28 : goalContribPg) * oppMod);
    const pPoisGa = poissonAtLeast(lambdaGa, 1);
    const empHits = recentGa.filter((v) => v >= 1).length;
    const empRate = recentGa.length > 0 ? empHits / recentGa.length : pPoisGa;
    const pCal = blendCalProb(pPoisGa, empHits, recentGa.length, 0.80);
    if (pCal >= 0.56 && (recentGa.length < 4 || empRate >= 0.5)) {
      const conf = clampConf(pCal * 100);
      const oddsVal = computePropOddsFromConfidence(conf);
      const isSafe = allowSafe && pCal >= 0.68 && (recentGa.length < 4 || empRate >= 0.6);
      const item: PropRecommendation = {
        id: `fb_ga_${p.player_id}_${isSafe ? 'safe' : 'val'}`,
        scope: 'player',
        strategy: isSafe ? 'safe' : 'value',
        marketCategory: 'player',
        projectedValue: Number(lambdaGa.toFixed(2)),
        marketLabel: isSafe ? 'Gol o Asistencia (G+A) · Segura' : 'Gol o Asistencia (G+A)',
        subjectName: p.full_name,
        teamAbbr,
        playerId: p.player_id,
        footballMetricKey: 'goal_contrib',
        statSummary: `${p.goals + p.assists} G+A en ${p.gp} PJ (${goalContribPg.toFixed(2)}/PJ)`,
        marketLineText: `O/U 0.5 G+A · Cuota ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: 0.5,
        pick: 'OVER',
        pickLabel: 'Marca o Asiste (+0.5)',
        rationale: `${p.full_name} produce ${goalContribPg.toFixed(2)} contribuciones de gol por partido (${conf}% prob.).`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [
          ...(isSafe ? [{ label: 'Línea Segura', tone: 'emerald' as const }] : []),
          { label: `${goalContribPg.toFixed(2)} G+A/PJ`, tone: 'emerald' },
        ],
      };
      if (isSafe) safe.push(item);
      else value.push(item);
    }
  }

  // 5. Faltas Cometidas & Faltas Recibidas & Tarjetas Amarillas
  const fcPg = Number(p.fouls_committed_pg ?? p.fouls_committed / gp);
  if (fcPg >= 1.25) {
    const recentFc = pLogs.map((l) => getFootballPlayerStatValue(l, 'fouls_committed'));
    const recAvg = recentFc.length > 0 ? recentFc.reduce((a, b) => a + b, 0) / recentFc.length : fcPg;
    const lambdaFc = recentFc.length >= 3 ? fcPg * 0.72 + recAvg * 0.28 : fcPg;
    for (const c of [
      { line: 1.5, targetK: 2, minPg: 2.0, strat: 'value' as const },
      { line: 0.5, targetK: 1, minPg: 1.25, strat: 'safe' as const },
    ]) {
      if (fcPg < c.minPg) continue;
      if (c.strat === 'safe' && !allowSafe) continue;
      const pPois = poissonAtLeast(lambdaFc, c.targetK);
      const hits = recentFc.filter((v) => v >= c.targetK).length;
      const empRate = recentFc.length > 0 ? hits / recentFc.length : pPois;
      const pCal = blendCalProb(pPois, hits, recentFc.length, c.strat === 'safe' ? 0.82 : 0.70);
      if (pCal >= (c.strat === 'safe' ? 0.68 : 0.58) && (recentFc.length < 4 || empRate >= 0.58)) {
        const conf = clampConf(pCal * 100);
        const oddsVal = computePropOddsFromConfidence(conf);
        const item: PropRecommendation = {
          id: `fb_pfouls_${p.player_id}_${c.strat === 'safe' ? 'safe' : 'val'}`,
          scope: 'player',
          strategy: c.strat,
          marketCategory: 'player',
          projectedValue: Number(lambdaFc.toFixed(2)),
          marketLabel: c.strat === 'safe' ? 'Faltas Cometidas · Segura' : 'Faltas Cometidas (Jugador)',
          subjectName: p.full_name,
          teamAbbr,
          playerId: p.player_id,
          footballMetricKey: 'fouls_committed',
          statSummary: `${fcPg.toFixed(2)} FC/PJ (${p.fouls_committed} tot.)`,
          marketLineText: `O/U ${c.line} Faltas · Cuota ${oddsVal.decimal.toFixed(2)}x`,
          lineValue: c.line,
          pick: 'OVER',
          pickLabel: `+${c.line} Faltas Com.`,
          rationale: `Frecuencia de infracciones λ=${lambdaFc.toFixed(2)}/PJ respalda +${c.line} faltas (${conf}% prob.).`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [{ label: `${fcPg.toFixed(1)} FC/PJ`, tone: 'amber' }],
        };
        if (c.strat === 'safe') safe.push(item);
        else value.push(item);
      }
    }
  }

  const fsPg = Number(p.fouls_suffered_pg ?? p.fouls_suffered / gp);
  if (fsPg >= 1.3) {
    const recentFs = pLogs.map((l) => getFootballPlayerStatValue(l, 'fouls_suffered'));
    const recAvg = recentFs.length > 0 ? recentFs.reduce((a, b) => a + b, 0) / recentFs.length : fsPg;
    const lambdaFs = recentFs.length >= 3 ? fsPg * 0.72 + recAvg * 0.28 : fsPg;
    for (const c of [
      { line: 1.5, targetK: 2, minPg: 2.1, strat: 'value' as const },
      { line: 0.5, targetK: 1, minPg: 1.3, strat: 'safe' as const },
    ]) {
      if (fsPg < c.minPg) continue;
      if (c.strat === 'safe' && !allowSafe) continue;
      const pPois = poissonAtLeast(lambdaFs, c.targetK);
      const hits = recentFs.filter((v) => v >= c.targetK).length;
      const empRate = recentFs.length > 0 ? hits / recentFs.length : pPois;
      const pCal = blendCalProb(pPois, hits, recentFs.length, c.strat === 'safe' ? 0.82 : 0.70);
      if (pCal >= (c.strat === 'safe' ? 0.68 : 0.58) && (recentFs.length < 4 || empRate >= 0.58)) {
        const conf = clampConf(pCal * 100);
        const oddsVal = computePropOddsFromConfidence(conf);
        const item: PropRecommendation = {
          id: `fb_pfouls_drawn_${p.player_id}_${c.strat === 'safe' ? 'safe' : 'val'}`,
          scope: 'player',
          strategy: c.strat,
          marketCategory: 'player',
          projectedValue: Number(lambdaFs.toFixed(2)),
          marketLabel: c.strat === 'safe' ? 'Faltas Recibidas · Segura' : 'Faltas Recibidas (Jugador)',
          subjectName: p.full_name,
          teamAbbr,
          playerId: p.player_id,
          footballMetricKey: 'fouls_suffered',
          statSummary: `${fsPg.toFixed(2)} FR/PJ (${p.fouls_suffered} tot.)`,
          marketLineText: `O/U ${c.line} Faltas Rec. · Cuota ${oddsVal.decimal.toFixed(2)}x`,
          lineValue: c.line,
          pick: 'OVER',
          pickLabel: `+${c.line} Faltas Rec.`,
          rationale: `${p.full_name} recibe λ=${lambdaFs.toFixed(2)} faltas/PJ por su regate y conducción (${conf}% prob.).`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [{ label: `${fsPg.toFixed(1)} FR/PJ`, tone: 'cyan' }],
        };
        if (c.strat === 'safe') safe.push(item);
        else value.push(item);
      }
    }
  }

  const ycPg = Number(p.yellow_cards_pg ?? p.yellow_cards / gp);
  if (ycPg >= 0.36) {
    const recentYc = pLogs.map((l) => getFootballPlayerStatValue(l, 'yellow_cards'));
    const recAvg = recentYc.length > 0 ? recentYc.reduce((a, b) => a + b, 0) / recentYc.length : ycPg;
    const lambdaYc = recentYc.length >= 3 ? ycPg * 0.78 + recAvg * 0.22 : ycPg;
    const pPois = poissonAtLeast(lambdaYc, 1);
    const hits = recentYc.filter((v) => v >= 1).length;
    const pCal = blendCalProb(pPois, hits, recentYc.length, 0.62);
    if (pCal >= 0.36) {
      const conf = Math.max(36, Math.min(62, Math.round(pCal * 100)));
      const oddsVal = computePropOddsFromConfidence(conf);
      value.push({
        id: `fb_pyellow_${p.player_id}_val`,
        scope: 'player',
        strategy: 'value',
        marketCategory: 'player',
        projectedValue: Number(lambdaYc.toFixed(2)),
        marketLabel: 'Tarjeta Amarilla (Jugador)',
        subjectName: p.full_name,
        teamAbbr,
        playerId: p.player_id,
        footballMetricKey: 'yellow_cards',
        statSummary: `${p.yellow_cards} TA en ${p.gp} PJ (${ycPg.toFixed(2)}/PJ)`,
        marketLineText: `O/U 0.5 TA · Cuota ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: 0.5,
        pick: 'OVER',
        pickLabel: 'Recibe Amarilla (+0.5)',
        rationale: `Alta frecuencia de amonestaciones (${ycPg.toFixed(2)} TA/PJ) respalda mercado de tarjeta.`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [{ label: `${ycPg.toFixed(2)} TA/PJ`, tone: 'rose' }],
      });
    }
  }

  return { safe, value };
}

export function buildSingleFootballPlayerProps(
  player: FootballPlayerSeasonAverage | null,
  logs: PlayerGameStat[],
): PropRecommendation[] {
  if (!player || player.gp < 1) return [];
  const teamAbbr = player.team_abbreviation ?? 'FUT';
  const { safe, value } = buildCalibratedFootballPlayerCandidates({
    player,
    teamAbbr,
    pLogs: logs.filter((r) => !r.did_not_play).slice(0, 10),
    oppMod: 1.0,
    oppSotPg: null,
    allowSafe: true,
  });
  return [...safe, ...value].sort((a, b) => b.confidence - a.confidence);
}

export function evaluateFootballPropStatus(
  prop: PropRecommendation,
  game: Game,
  stats: PlayerGameStat[] = [],
): PropLiveStatus | null {
  if (game.status === 'scheduled' || game.status === 'postponed') return null;

  const isFinal = game.status === 'final';
  const gradeOverUnder = (
    val: number,
    line: number,
    pick: 'OVER' | 'UNDER',
    unitSuffix = '',
  ): PropLiveStatus => {
    const valLabel = unitSuffix ? `${val} ${unitSuffix}` : `${val}`;
    if (isFinal) {
      if (val === line) return { label: `EMPATE (${valLabel})`, state: 'push' };
      const won = pick === 'UNDER' ? val < line : val > line;
      return {
        label: `${won ? 'SALIÓ' : 'NO SALIÓ'} · ${valLabel}`,
        state: won ? 'won' : 'lost',
      };
    }
    if (pick === 'OVER' && val > line) {
      return { label: `CUMPLIÓ · ${valLabel}`, state: 'won' };
    }
    return { label: `EN VIVO · ${val}/${line}`, state: 'live' };
  };

  if (prop.scope === 'player' && prop.playerId && prop.footballMetricKey) {
    const row = stats.find((s) => s.player_id === prop.playerId);
    if (!row) return isFinal ? null : { label: 'EN VIVO', state: 'live' };
    if (row.did_not_play) return { label: 'DNP', state: 'dnp' };
    const val = getFootballPlayerStatValue(row, prop.footballMetricKey);
    const pick = prop.pick === 'UNDER' ? 'UNDER' : 'OVER';
    return gradeOverUnder(val, prop.lineValue, pick);
  }

  const ouPick = prop.pick === 'UNDER' ? 'UNDER' : 'OVER';

  // Total & alt match goals
  if (prop.id.startsWith('fb_total_')) {
    return gradeOverUnder(game.away_score + game.home_score, prop.lineValue, ouPick, 'G');
  }

  // Team goals
  if (prop.id.startsWith('fb_team_goals_')) {
    const tid = prop.teamId ?? Number(prop.id.replace(/^fb_team_goals_(?:safe_|val_)?/, ''));
    const goals = tid === game.home_team_id ? game.home_score : game.away_score;
    return gradeOverUnder(goals, prop.lineValue, ouPick, 'G');
  }

  // BTTS
  if (prop.id.startsWith('fb_btts_')) {
    const bothScored = game.home_score > 0 && game.away_score > 0;
    const isYesPick = prop.pick !== 'UNDER';
    const scoreStr = `${game.away_score}-${game.home_score}`;
    if (!isFinal) {
      if (isYesPick && bothScored) return { label: `CUMPLIÓ · ${scoreStr}`, state: 'won' };
      return { label: `EN VIVO · ${scoreStr}`, state: 'live' };
    }
    const won = isYesPick ? bothScored : !bothScored;
    return { label: `${won ? 'SALIÓ' : 'NO SALIÓ'} · ${scoreStr}`, state: won ? 'won' : 'lost' };
  }

  // 1st Half Goals
  if (prop.id.startsWith('fb_ht_goals_')) {
    const ht = extractHalfTimeGoals(game);
    if (!ht) return isFinal ? null : { label: 'EN VIVO', state: 'live' };
    if (!isFinal && game.period <= 1) {
      if (ouPick === 'OVER' && ht.total > prop.lineValue) {
        return { label: `CUMPLIÓ · ${ht.total} 1T`, state: 'won' };
      }
      return { label: `1T · ${ht.total}/${prop.lineValue}`, state: 'live' };
    }
    if (ht.total === prop.lineValue) return { label: `EMPATE (${ht.total} 1T)`, state: 'push' };
    const won = ouPick === 'UNDER' ? ht.total < prop.lineValue : ht.total > prop.lineValue;
    return { label: `${won ? 'SALIÓ' : 'NO SALIÓ'} · ${ht.total} 1T`, state: won ? 'won' : 'lost' };
  }

  // Boxscore sport_stats markets
  const statMappings: Array<{
    prefix: string;
    statKey: keyof FootballTeamMatchStats;
    unit: string;
    isTeam: boolean;
  }> = [
    { prefix: 'fb_corners_total_', statKey: 'corners', unit: 'Cór.', isTeam: false },
    { prefix: 'fb_team_corners_', statKey: 'corners', unit: 'Cór.', isTeam: true },
    { prefix: 'fb_fouls_total_', statKey: 'fouls', unit: 'Fal.', isTeam: false },
    { prefix: 'fb_team_fouls_', statKey: 'fouls', unit: 'Fal.', isTeam: true },
    { prefix: 'fb_cards_total_', statKey: 'yellow_cards', unit: 'TA', isTeam: false },
    { prefix: 'fb_team_cards_', statKey: 'yellow_cards', unit: 'TA', isTeam: true },
    { prefix: 'fb_shots_total_', statKey: 'shots', unit: 'REM', isTeam: false },
    { prefix: 'fb_team_shots_', statKey: 'shots', unit: 'REM', isTeam: true },
    { prefix: 'fb_sot_total_', statKey: 'shots_on_target', unit: 'Arco', isTeam: false },
    { prefix: 'fb_team_sot_', statKey: 'shots_on_target', unit: 'Arco', isTeam: true },
    { prefix: 'fb_offsides_total_', statKey: 'offsides', unit: 'Off.', isTeam: false },
    { prefix: 'fb_saves_total_', statKey: 'saves', unit: 'Ataj.', isTeam: false },
  ];

  for (const m of statMappings) {
    if (prop.id.startsWith(m.prefix)) {
      const val = m.isTeam
        ? extractTeamMatchStat(
            game,
            prop.teamId ?? Number(prop.id.slice(m.prefix.length).replace(/^(?:safe_|val_)/, '')),
            m.statKey,
          )
        : extractMatchTotalStat(game, m.statKey);
      if (val == null) return isFinal ? null : { label: 'EN VIVO', state: 'live' };
      return gradeOverUnder(val, prop.lineValue, ouPick, m.unit);
    }
  }

  // Doble Oportunidad
  if (prop.id.startsWith('fb_dc_') || prop.pick === 'DC') {
    const pick1X =
      prop.teamId != null
        ? prop.teamId === game.home_team_id
        : prop.pickLabel.startsWith('1X') || prop.teamAbbr === game.home_team.abbreviation;
    const scoreStr = `${game.away_score}-${game.home_score}`;
    const covered = pick1X
      ? game.home_score >= game.away_score
      : game.away_score >= game.home_score;
    if (!isFinal) {
      return {
        label: `${covered ? 'CUMPLE' : 'EN VIVO'} · ${scoreStr}`,
        state: 'live',
      };
    }
    return {
      label: `${covered ? 'SALIÓ' : 'NO SALIÓ'} · ${scoreStr}`,
      state: covered ? 'won' : 'lost',
    };
  }

  // DNB (Draw No Bet)
  const isHomeTarget =
    prop.teamId != null
      ? prop.teamId === game.home_team_id
      : prop.teamAbbr === game.home_team.abbreviation;
  const myScore = isHomeTarget ? game.home_score : game.away_score;
  const opScore = isHomeTarget ? game.away_score : game.home_score;
  const scorePair = `${game.away_score}-${game.home_score}`;

  if (prop.id.startsWith('fb_dnb_')) {
    if (!isFinal) return { label: `EN VIVO · ${myScore}-${opScore}`, state: 'live' };
    if (myScore === opScore) return { label: `EMPATE DNB (${scorePair})`, state: 'push' };
    const won = myScore > opScore;
    return { label: `${won ? 'SALIÓ' : 'NO SALIÓ'} · ${scorePair}`, state: won ? 'won' : 'lost' };
  }

  // Hándicap Asiático
  if (prop.id.startsWith('fb_spread_') || prop.pick === 'SPREAD') {
    if (!isFinal) {
      const diff = myScore - opScore;
      return { label: `EN VIVO · ${diff >= 0 ? '+' : ''}${diff}`, state: 'live' };
    }
    const adj = myScore - opScore + prop.lineValue;
    if (adj === 0) return { label: `EMPATE (${scorePair})`, state: 'push' };
    const won = adj > 0;
    return { label: `${won ? 'CUBRIÓ' : 'NO CUBRIÓ'} · ${scorePair}`, state: won ? 'won' : 'lost' };
  }

  // 1X2 (Ganador 90m)
  if (prop.id.startsWith('fb_ml_') || prop.pick === 'ML') {
    if (!isFinal) {
      return { label: `EN VIVO · ${myScore}-${opScore}`, state: 'live' };
    }
    const won = myScore > opScore;
    return {
      label: `${won ? 'GANÓ' : 'PERDIÓ'} · ${myScore}-${opScore}`,
      state: won ? 'won' : 'lost',
    };
  }

  return null;
}

export function getLiveFootballPropProgress(
  prop: PropRecommendation,
  game: Game,
  stats: PlayerGameStat[],
): string | null {
  return evaluateFootballPropStatus(prop, game, stats)?.label ?? null;
}

export function evaluateAnyPropStatus(
  prop: PropRecommendation,
  game: Game,
  boxStats: PlayerGameStat[] = [],
  sport: 'basketball' | 'football' = 'basketball',
): PropLiveStatus | null {
  return sport === 'football'
    ? evaluateFootballPropStatus(prop, game, boxStats)
    : evaluatePropStatus(prop, game, boxStats);
}

export function summarizeAnyGamePropsEffectiveness(
  props: PropRecommendation[],
  game: Game,
  boxStats: PlayerGameStat[] = [],
  sport: 'basketball' | 'football' = 'basketball',
): GamePropsEffectivenessSummary {
  return computeEffectivenessFromCounts(props, (prop) =>
    evaluateAnyPropStatus(prop, game, boxStats, sport),
  );
}
