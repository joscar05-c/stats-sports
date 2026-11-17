import type {
  Game,
  PlayerGameStat,
  PlayerSeasonAverage,
  TeamSeasonAverage,
  TeamStanding,
} from '../types/database';

/**
 * Convert American odds (-110, +240) into decimal multiplier (1.91, 3.40).
 */
export function americanToDecimalNum(odds?: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

export function formatDecimalOdds(odds?: number | null): string {
  const dec = americanToDecimalNum(odds);
  return dec != null ? dec.toFixed(2) : '-';
}

export function formatAmericanOdds(odds?: number | null): string {
  if (odds == null || !Number.isFinite(odds)) return '-';
  return odds > 0 ? `+${Math.round(odds)}` : `${Math.round(odds)}`;
}

export function americanToImpliedProb(odds?: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  if (odds > 0) return (100 / (odds + 100)) * 100;
  const abs = Math.abs(odds);
  return (abs / (abs + 100)) * 100;
}

export function formatSpread(spread?: number | null): string {
  if (spread == null || !Number.isFinite(spread)) return '-';
  if (spread === 0) return 'PK';
  return spread > 0 ? `+${spread.toFixed(1).replace(/\.0$/, '.0')}` : spread.toFixed(1).replace(/\.0$/, '.0');
}

export function formatSpreadCompact(spread?: number | null): string {
  if (spread == null || !Number.isFinite(spread)) return '-';
  if (spread === 0) return 'PK';
  const clean = Number.isInteger(spread) ? `${spread}` : spread.toFixed(1);
  return spread > 0 ? `+${clean}` : clean;
}

export function evaluateGameBettingResult(game: Game): {
  totalPoints: number;
  totalResult: 'OVER' | 'UNDER' | 'PUSH' | null;
  spreadWinner: 'home' | 'away' | 'PUSH' | null;
} {
  const totalPoints = game.home_score + game.away_score;
  const odds = game.odds;
  if (game.status !== 'final' || !odds) {
    return { totalPoints, totalResult: null, spreadWinner: null };
  }

  let totalResult: 'OVER' | 'UNDER' | 'PUSH' | null = null;
  if (odds.over_under != null) {
    if (totalPoints > odds.over_under) totalResult = 'OVER';
    else if (totalPoints < odds.over_under) totalResult = 'UNDER';
    else totalResult = 'PUSH';
  }

  let spreadWinner: 'home' | 'away' | 'PUSH' | null = null;
  if (odds.home_spread != null) {
    const adjusted = game.home_score - game.away_score + odds.home_spread;
    if (adjusted > 0) spreadWinner = 'home';
    else if (adjusted < 0) spreadWinner = 'away';
    else spreadWinner = 'PUSH';
  }

  return { totalPoints, totalResult, spreadWinner };
}

export interface TeamRecentSummary {
  gamesCount: number;
  wins: number;
  losses: number;
  avgFor: number;
  avgAgainst: number;
  avgCombined: number;
  avgMargin: number;
  overHits: number;
  overTracked: number;
  atsWins: number;
  atsTracked: number;
}

export function summarizeTeamRecent(teamId: number, recentGames: Game[]): TeamRecentSummary {
  const finals = recentGames.filter((g) => g.status === 'final');
  if (finals.length === 0) {
    return {
      gamesCount: 0,
      wins: 0,
      losses: 0,
      avgFor: 0,
      avgAgainst: 0,
      avgCombined: 0,
      avgMargin: 0,
      overHits: 0,
      overTracked: 0,
      atsWins: 0,
      atsTracked: 0,
    };
  }

  let wins = 0;
  let totalFor = 0;
  let totalAgainst = 0;
  let overHits = 0;
  let overTracked = 0;
  let atsWins = 0;
  let atsTracked = 0;

  for (const g of finals) {
    const isHome = g.home_team_id === teamId;
    const ptsFor = isHome ? g.home_score : g.away_score;
    const ptsAgainst = isHome ? g.away_score : g.home_score;
    totalFor += ptsFor;
    totalAgainst += ptsAgainst;
    if (ptsFor > ptsAgainst) wins += 1;

    if (g.odds?.over_under != null) {
      overTracked += 1;
      if (g.home_score + g.away_score > g.odds.over_under) overHits += 1;
    }

    const teamSpread = isHome ? g.odds?.home_spread : g.odds?.away_spread;
    if (teamSpread != null) {
      atsTracked += 1;
      if (ptsFor - ptsAgainst + teamSpread > 0) atsWins += 1;
    }
  }

  const n = finals.length;
  return {
    gamesCount: n,
    wins,
    losses: n - wins,
    avgFor: totalFor / n,
    avgAgainst: totalAgainst / n,
    avgCombined: (totalFor + totalAgainst) / n,
    avgMargin: (totalFor - totalAgainst) / n,
    overHits,
    overTracked,
    atsWins,
    atsTracked,
  };
}

export function parseIsoDateUtcMs(isoDate: string): number | null {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Compute calendar rest days between targetGameDate and the team's previous played game.
 * Returns 0 for Back-to-Back (played yesterday), 1 for 1 full day off, etc.
 */
export function computeTeamRestDays(targetGameDate: string, recentGames: Game[]): number | null {
  const targetMs = parseIsoDateUtcMs(targetGameDate);
  if (targetMs == null || recentGames.length === 0) return null;

  const prevFinals = recentGames
    .filter((g) => g.status === 'final' && g.game_date < targetGameDate)
    .sort((a, b) => b.game_date.localeCompare(a.game_date));

  if (prevFinals.length === 0) return null;
  const prevMs = parseIsoDateUtcMs(prevFinals[0].game_date);
  if (prevMs == null) return null;

  const diffDays = Math.round((targetMs - prevMs) / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays - 1);
}

export interface MatchupBettingInsight {
  expectedTotalSeason: number | null;
  expectedTotalRecent: number | null;
  totalEdge: number | null;
  projectedHomeMargin: number | null;
  spreadEdgeHome: number | null;
  homeRestDays: number | null;
  awayRestDays: number | null;
  movements: string[];
  signals: Array<{ title: string; detail: string; tone: 'over' | 'under' | 'neutral' | 'home' | 'away' }>;
}

export function buildMatchupBettingInsight(
  game: Game,
  homeStanding: TeamStanding | null,
  awayStanding: TeamStanding | null,
  homeRecent: TeamRecentSummary,
  awayRecent: TeamRecentSummary,
  homeRecentGames?: Game[],
  awayRecentGames?: Game[],
): MatchupBettingInsight {
  const odds = game.odds;
  const homeRestDays = homeRecentGames ? computeTeamRestDays(game.game_date, homeRecentGames) : null;
  const awayRestDays = awayRecentGames ? computeTeamRestDays(game.game_date, awayRecentGames) : null;
  const totalRestAdjust = (homeRestDays === 0 ? -1.8 : 0) + (awayRestDays === 0 ? -1.8 : 0);
  const marginRestAdjust = (homeRestDays === 0 ? -1.5 : 0) + (awayRestDays === 0 ? 1.5 : 0);

  // Expected game total using offensive & defensive season averages + B2B pace adjustment
  let expectedTotalSeason: number | null = null;
  if (
    homeStanding?.ppg != null &&
    homeStanding?.oppg != null &&
    awayStanding?.ppg != null &&
    awayStanding?.oppg != null
  ) {
    const homeProj = (Number(homeStanding.ppg) + Number(awayStanding.oppg)) / 2;
    const awayProj = (Number(awayStanding.ppg) + Number(homeStanding.oppg)) / 2;
    expectedTotalSeason = Number((homeProj + awayProj + totalRestAdjust).toFixed(1));
  }

  let expectedTotalRecent: number | null = null;
  if (homeRecent.gamesCount > 0 && awayRecent.gamesCount > 0) {
    const homeProj = (homeRecent.avgFor + awayRecent.avgAgainst) / 2;
    const awayProj = (awayRecent.avgFor + homeRecent.avgAgainst) / 2;
    expectedTotalRecent = Number((homeProj + awayProj + totalRestAdjust).toFixed(1));
  }

  const refTotal = expectedTotalRecent ?? expectedTotalSeason;
  const totalEdge =
    odds?.over_under != null && refTotal != null
      ? Number((refTotal - odds.over_under).toFixed(1))
      : null;

  // Projected home margin using season differential (+2.2 pts NBA home court) + B2B rest differential
  let projectedHomeMargin: number | null = null;
  if (homeStanding?.diff != null && awayStanding?.diff != null) {
    projectedHomeMargin = Number(
      ((Number(homeStanding.diff) - Number(awayStanding.diff)) / 2 + 2.2 + marginRestAdjust).toFixed(1),
    );
  } else if (homeRecent.gamesCount > 0 && awayRecent.gamesCount > 0) {
    projectedHomeMargin = Number(
      ((homeRecent.avgMargin - awayRecent.avgMargin) / 2 + 2.2 + marginRestAdjust).toFixed(1),
    );
  }

  const spreadEdgeHome =
    odds?.home_spread != null && projectedHomeMargin != null
      ? Number((projectedHomeMargin + odds.home_spread).toFixed(1))
      : null;

  const movements: string[] = [];
  if (odds?.open_over_under != null && odds?.over_under != null && odds.open_over_under !== odds.over_under) {
    const diff = odds.over_under - odds.open_over_under;
    movements.push(
      `Total ${diff > 0 ? 'subió' : 'bajó'} de ${odds.open_over_under} a ${odds.over_under} (${diff > 0 ? '+' : ''}${diff.toFixed(1)} pts)`,
    );
  }
  if (
    odds?.open_home_spread != null &&
    odds?.home_spread != null &&
    odds.open_home_spread !== odds.home_spread
  ) {
    const diff = odds.home_spread - odds.open_home_spread;
    const movedToward = diff < 0 ? game.home_team.abbreviation : game.away_team.abbreviation;
    movements.push(
      `Hándicap movido hacia ${movedToward}: ${game.home_team.abbreviation} pasó de ${formatSpreadCompact(odds.open_home_spread)} a ${formatSpreadCompact(odds.home_spread)}`,
    );
  }

  const signals: MatchupBettingInsight['signals'] = [];

  if (totalEdge != null && odds?.over_under != null) {
    if (totalEdge >= 3) {
      signals.push({
        title: `Tendencia ALTA (Over ${odds.over_under})`,
        detail: `Los promedios de ambos equipos proyectan ~${refTotal} pts (+${totalEdge} sobre la línea).`,
        tone: 'over',
      });
    } else if (totalEdge <= -3) {
      signals.push({
        title: `Tendencia BAJA (Under ${odds.over_under})`,
        detail: `El ritmo combinado proyecta ~${refTotal} pts (${totalEdge} bajo la línea).`,
        tone: 'under',
      });
    } else {
      signals.push({
        title: `Total ajustado (${odds.over_under})`,
        detail: `La proyección estadística (~${refTotal} pts) está muy cerca de la línea de la casa.`,
        tone: 'neutral',
      });
    }
  }

  if (spreadEdgeHome != null && odds?.home_spread != null) {
    if (spreadEdgeHome >= 2.5) {
      signals.push({
        title: `Ventaja Hándicap: ${game.home_team.abbreviation} (${formatSpreadCompact(odds.home_spread)})`,
        detail: `Por diferencial neto y localía se proyecta margen local de ${projectedHomeMargin! > 0 ? '+' : ''}${projectedHomeMargin} pts.`,
        tone: 'home',
      });
    } else if (spreadEdgeHome <= -2.5) {
      signals.push({
        title: `Ventaja Hándicap: ${game.away_team.abbreviation} (${formatSpreadCompact(odds.away_spread)})`,
        detail: `La diferencia neta favorece más a la visita respecto al spread pedido (${formatSpreadCompact(odds.home_spread)}).`,
        tone: 'away',
      });
    } else {
      signals.push({
        title: `Hándicap parejo (${odds.details ?? formatSpreadCompact(odds.home_spread)})`,
        detail: `El margen proyectado (${projectedHomeMargin! > 0 ? '+' : ''}${projectedHomeMargin} para ${game.home_team.abbreviation}) coincide con la línea.`,
        tone: 'neutral',
      });
    }
  }

  if (homeRestDays === 0 || awayRestDays === 0) {
    const b2bTeams = [
      awayRestDays === 0 ? game.away_team.abbreviation : null,
      homeRestDays === 0 ? game.home_team.abbreviation : null,
    ].filter(Boolean);
    signals.push({
      title: `Factor Fatiga Back-to-Back (${b2bTeams.join(' y ')})`,
      detail: `${b2bTeams.join(' y ')} jugó ayer (0 días de descanso); el modelo ajusta rotación, ritmo y anotación esperados.`,
      tone: homeRestDays === 0 && awayRestDays !== 0 ? 'away' : awayRestDays === 0 && homeRestDays !== 0 ? 'home' : 'neutral',
    });
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

export type PlayerChartMetric = 'pts' | 'reb' | 'ast' | 'pra' | 'tpm';

export interface PlayerMetricConfig {
  key: PlayerChartMetric;
  label: string;
  short: string;
  getStatValue: (g: PlayerGameStat) => number;
  getSeasonAvg: (avg: PlayerSeasonAverage | null, logs: PlayerGameStat[]) => number;
}

export const PLAYER_CHART_METRICS: Record<PlayerChartMetric, PlayerMetricConfig> = {
  pts: {
    key: 'pts',
    label: 'Puntos',
    short: 'PTS',
    getStatValue: (g) => g.pts,
    getSeasonAvg: (avg, logs) =>
      avg ? Number(avg.ppg ?? 0) : logs.length ? logs.reduce((s, r) => s + r.pts, 0) / logs.length : 0,
  },
  reb: {
    key: 'reb',
    label: 'Rebotes',
    short: 'REB',
    getStatValue: (g) => g.reb,
    getSeasonAvg: (avg, logs) =>
      avg ? Number(avg.rpg ?? 0) : logs.length ? logs.reduce((s, r) => s + r.reb, 0) / logs.length : 0,
  },
  ast: {
    key: 'ast',
    label: 'Asistencias',
    short: 'AST',
    getStatValue: (g) => g.ast,
    getSeasonAvg: (avg, logs) =>
      avg ? Number(avg.apg ?? 0) : logs.length ? logs.reduce((s, r) => s + r.ast, 0) / logs.length : 0,
  },
  pra: {
    key: 'pra',
    label: 'P+R+A',
    short: 'PRA',
    getStatValue: (g) => g.pts + g.reb + g.ast,
    getSeasonAvg: (avg, logs) =>
      avg
        ? Number(avg.ppg ?? 0) + Number(avg.rpg ?? 0) + Number(avg.apg ?? 0)
        : logs.length
          ? logs.reduce((s, r) => s + r.pts + r.reb + r.ast, 0) / logs.length
          : 0,
  },
  tpm: {
    key: 'tpm',
    label: 'Triples',
    short: '3PT',
    getStatValue: (g) => g.tpm,
    getSeasonAvg: (_avg, logs) =>
      logs.length ? logs.reduce((s, r) => s + r.tpm, 0) / logs.length : 0,
  },
};

/**
 * Snap a season average to a clean sportsbook .5 prop line (no pushes).
 */
export function suggestPropLine(avg: number): number {
  if (!Number.isFinite(avg) || avg <= 0.5) return 0.5;
  const floor = Math.floor(avg);
  const frac = avg - floor;
  if (frac >= 0.75) return floor + 0.5;
  if (frac >= 0.25) return floor + 0.5;
  return Math.max(0.5, floor - 0.5);
}

function clampConfidence(val: number): number {
  return Math.max(51, Math.min(94, Math.round(val)));
}

export const PRO_CONFIDENCE_THRESHOLD = 68;

export function isHighProbabilityProp(confidence: number): boolean {
  return confidence >= PRO_CONFIDENCE_THRESHOLD;
}

export function getConfidenceTier(confidence: number): 'Baja' | 'Media' | 'Alta' | 'Muy Alta' {
  if (confidence >= 80) return 'Muy Alta';
  if (confidence >= 68) return 'Alta';
  if (confidence >= 58) return 'Media';
  return 'Baja';
}

export interface PropContextBadge {
  label: string;
  tone: 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate';
}

export interface PropRecommendation {
  id: string;
  scope: 'team' | 'player';
  marketLabel: string;
  subjectName: string;
  teamAbbr: string;
  playerId?: number;
  metricKey?: PlayerChartMetric;
  statSummary: string;
  marketLineText: string;
  lineValue: number;
  pick: 'OVER' | 'UNDER' | 'SPREAD' | 'ML';
  pickLabel: string;
  rationale: string;
  confidence: number;
  confidenceTier: 'Baja' | 'Media' | 'Alta' | 'Muy Alta';
  estimatedOddsAmerican: number;
  estimatedMultiplier: number;
  contextBadges: PropContextBadge[];
  mpgInfo?: { seasonMpg: number; recentMpg: number; delta: number };
  splitInfo?: { isHome: boolean; venueAvg: number; venueGp: number };
  restInfo?: { teamRestDays: number | null; oppRestDays: number | null };
}

export function computePropOddsFromConfidence(
  confidence: number,
  bookAmericanOdds?: number | null,
): { american: number; decimal: number } {
  if (bookAmericanOdds != null && Number.isFinite(bookAmericanOdds) && bookAmericanOdds !== 0) {
    const dec = americanToDecimalNum(bookAmericanOdds);
    return {
      american: Math.round(bookAmericanOdds),
      decimal: Number((dec ?? 1.91).toFixed(2)),
    };
  }
  if (confidence >= 76) return { american: -118, decimal: 1.85 };
  if (confidence >= 68) return { american: -115, decimal: 1.87 };
  if (confidence >= 58) return { american: -112, decimal: 1.89 };
  return { american: -110, decimal: 1.91 };
}

function snapHalf(val: number): number {
  const r = Math.round(val * 2) / 2;
  return Number.isInteger(r) ? r - 0.5 : r;
}

const MARKET_NAMES: Record<PlayerChartMetric, { market: string; unit: string; minAvg: number }> = {
  pts: { market: 'Puntos de Jugador', unit: 'PTS', minAvg: 7.0 },
  reb: { market: 'Rebotes de Jugador', unit: 'REB', minAvg: 2.8 },
  ast: { market: 'Asistencias de Jugador', unit: 'AST', minAvg: 2.0 },
  pra: { market: 'Combo P+R+A', unit: 'P+R+A', minAvg: 12.0 },
  tpm: { market: 'Triples de Jugador', unit: '3PT', minAvg: 1.0 },
};

function evaluatePlayerPropMarket(
  player: PlayerSeasonAverage,
  logs: PlayerGameStat[],
  metricKey: PlayerChartMetric,
  oppTeamAvg?: TeamSeasonAverage | null,
  ctx?: {
    isHome?: boolean;
    teamRestDays?: number | null;
    oppRestDays?: number | null;
  },
): PropRecommendation | null {
  const cfg = PLAYER_CHART_METRICS[metricKey];
  const meta = MARKET_NAMES[metricKey];
  const seasonAvg = cfg.getSeasonAvg(player, logs);
  if (!Number.isFinite(seasonAvg) || seasonAvg < meta.minAvg) return null;

  const lineValue = suggestPropLine(seasonAvg);
  const recentSlice = logs.slice(0, 6);
  const values = recentSlice.map((g) => cfg.getStatValue(g));
  const recentAvg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : seasonAvg;
  const overHits = values.filter((v) => v > lineValue).length;
  const underHits = values.filter((v) => v < lineValue).length;

  let proj = values.length >= 2 ? seasonAvg * 0.45 + recentAvg * 0.55 : seasonAvg;
  const contextBadges: PropContextBadge[] = [];
  const rationaleParts: string[] = [];

  // 1. Recent Minutes (MPG) Trend Adjustment
  const rawSeasonMpg = Number(player.mpg ?? 0);
  const seasonMpg =
    rawSeasonMpg > 0
      ? rawSeasonMpg
      : logs.length > 0
        ? logs.reduce((s, r) => s + Number(r.minutes ?? 0), 0) / logs.length
        : 0;
  const recentMpgSlice = recentSlice.slice(0, 5);
  const recentMpg =
    recentMpgSlice.length > 0
      ? recentMpgSlice.reduce((s, r) => s + Number(r.minutes ?? 0), 0) / recentMpgSlice.length
      : seasonMpg;
  const mpgDelta = Number((recentMpg - seasonMpg).toFixed(1));
  let mpgInfo: PropRecommendation['mpgInfo'];

  if (seasonMpg > 0 && recentMpg > 0) {
    mpgInfo = {
      seasonMpg: Number(seasonMpg.toFixed(1)),
      recentMpg: Number(recentMpg.toFixed(1)),
      delta: mpgDelta,
    };
    if (seasonMpg >= 10) {
      const mpgFactor = Math.max(0.86, Math.min(1.14, 1 + (mpgDelta / Math.max(18, seasonMpg)) * 0.65));
      proj *= mpgFactor;
    }
    if (mpgDelta >= 2.0) {
      contextBadges.push({ label: `MPG ↑ ${recentMpg.toFixed(1)}m (+${mpgDelta.toFixed(1)})`, tone: 'emerald' });
      rationaleParts.push(`Minutos en alza (${recentMpg.toFixed(1)} min recientes vs ${seasonMpg.toFixed(1)} temp).`);
    } else if (mpgDelta <= -2.2) {
      contextBadges.push({ label: `MPG ↓ ${recentMpg.toFixed(1)}m (${mpgDelta.toFixed(1)})`, tone: 'amber' });
      rationaleParts.push(`Minutos a la baja (${recentMpg.toFixed(1)} min recientes).`);
    } else {
      contextBadges.push({ label: `MPG ${recentMpg.toFixed(1)}m`, tone: 'slate' });
    }
  }

  // 2. Home vs Away Split Adjustment
  let splitInfo: PropRecommendation['splitInfo'];
  if (ctx?.isHome != null) {
    const venueLogs = logs.filter(
      (g) => g.game?.home_team_id != null && g.team_id != null && (g.game.home_team_id === g.team_id) === ctx.isHome,
    );
    if (venueLogs.length >= 2) {
      const venueAvg = venueLogs.reduce((s, g) => s + cfg.getStatValue(g), 0) / venueLogs.length;
      proj = proj * 0.85 + venueAvg * 0.15;
      proj *= ctx.isHome ? 1.012 : 0.992;
      splitInfo = {
        isHome: ctx.isHome,
        venueAvg: Number(venueAvg.toFixed(1)),
        venueGp: venueLogs.length,
      };
      contextBadges.push({
        label: `${ctx.isHome ? 'Local' : 'Visita'}: ${venueAvg.toFixed(1)} ${meta.unit}`,
        tone: 'cyan',
      });
    } else {
      proj *= ctx.isHome ? 1.012 : 0.992;
      contextBadges.push({ label: ctx.isHome ? 'Local' : 'Visita', tone: 'slate' });
    }
  }

  // 3. Fatigue / Back-to-Back (B2B) & Rest Days Adjustment
  if (ctx?.teamRestDays === 0) {
    if (metricKey === 'pts' || metricKey === 'pra' || metricKey === 'tpm') {
      proj *= 0.968;
    }
    contextBadges.push({ label: 'Fatiga B2B (0d desc.)', tone: 'rose' });
    rationaleParts.push('Equipo llega en Back-to-Back (0 días de descanso).');
  } else if (ctx?.teamRestDays != null && ctx.teamRestDays >= 2) {
    proj *= 1.012;
    contextBadges.push({ label: `Descanso ${ctx.teamRestDays}d`, tone: 'emerald' });
  } else if (ctx?.teamRestDays === 1) {
    contextBadges.push({ label: '1d descanso', tone: 'slate' });
  }

  if (ctx?.oppRestDays === 0) {
    proj *= 1.018;
    contextBadges.push({ label: 'Rival en B2B', tone: 'emerald' });
    rationaleParts.push('Rival juega en Back-to-Back.');
  }

  // 4. Opponent Defense / Rebounding Matchup Adjustment
  let defNote = '';
  if (oppTeamAvg?.oppg != null && (metricKey === 'pts' || metricKey === 'pra')) {
    const oppDef = Number(oppTeamAvg.oppg);
    const factor = (oppDef - 113.5) / 113.5;
    proj += seasonAvg * factor * 0.55;
    if (oppDef >= 117) defNote = ` Rival permite ${oppDef.toFixed(1)} PPG (defensa permisiva).`;
    else if (oppDef <= 109) defNote = ` Rival solo permite ${oppDef.toFixed(1)} PPG (defensa top).`;
  } else if (oppTeamAvg?.rpg != null && metricKey === 'reb') {
    const oppReb = Number(oppTeamAvg.rpg);
    if (oppReb <= 42) {
      proj += 0.4;
      defNote = ` Rival promedia pocos rebotes (${oppReb.toFixed(1)} RPG).`;
    } else if (oppReb >= 46.5) {
      proj -= 0.4;
      defNote = ` Rival domina los tableros (${oppReb.toFixed(1)} RPG).`;
    }
  }

  const edge = proj - lineValue;
  const pick: 'OVER' | 'UNDER' = edge >= 0 ? 'OVER' : 'UNDER';
  const relevantHits = pick === 'OVER' ? overHits : underHits;
  const hitRate = values.length > 0 ? relevantHits / values.length : 0.54;
  const relEdge = Math.abs(edge) / Math.max(2, lineValue);
  const mpgBonus =
    pick === 'OVER' && mpgDelta >= 2.0 ? 2 : pick === 'UNDER' && mpgDelta <= -2.2 ? 2 : 0;

  const rawConf =
    50 +
    Math.min(22, relEdge * 125) +
    (hitRate - 0.5) * 34 +
    (values.length >= 4 ? 4 : 1) +
    mpgBonus;
  const confidence = clampConfidence(rawConf);
  const oddsPair = computePropOddsFromConfidence(confidence);

  const statSummary =
    values.length > 0
      ? `Temp: ${seasonAvg.toFixed(1)} ${meta.unit} · Últ. ${values.length} PJ: ${recentAvg.toFixed(1)} (${pick === 'OVER' ? 'superó' : 'quedó bajo'} en ${relevantHits}/${values.length})`
      : `Prom. temporada: ${seasonAvg.toFixed(1)} ${meta.unit} (${player.gp} PJ)`;

  const extraRationale = rationaleParts.length > 0 ? ` ${rationaleParts.join(' ')}` : '';
  const restInfo =
    ctx?.teamRestDays !== undefined || ctx?.oppRestDays !== undefined
      ? { teamRestDays: ctx?.teamRestDays ?? null, oppRestDays: ctx?.oppRestDays ?? null }
      : undefined;

  return {
    id: `player_${player.player_id}_${metricKey}`,
    scope: 'player',
    marketLabel: meta.market,
    subjectName: player.full_name,
    teamAbbr: player.team_abbreviation ?? 'NBA',
    playerId: player.player_id,
    metricKey,
    statSummary,
    marketLineText: `Línea Prop: ${lineValue.toFixed(1)} ${meta.unit} · Cuota ${oddsPair.decimal.toFixed(2)}x`,
    lineValue,
    pick,
    pickLabel: `${pick} ${lineValue.toFixed(1)} ${meta.unit}`,
    rationale: `Proyección de ${proj.toFixed(1)} ${meta.unit} frente a la línea ${lineValue.toFixed(1)} (${edge >= 0 ? '+' : ''}${edge.toFixed(1)} de ventaja).${defNote}${extraRationale}`,
    confidence,
    confidenceTier: getConfidenceTier(confidence),
    estimatedOddsAmerican: oddsPair.american,
    estimatedMultiplier: oddsPair.decimal,
    contextBadges,
    mpgInfo,
    splitInfo,
    restInfo,
  };
}

export function buildSinglePlayerPropsRecommendations(
  average: PlayerSeasonAverage | null,
  logs: PlayerGameStat[],
  oppTeamAvg?: TeamSeasonAverage | null,
  ctx?: {
    isHome?: boolean;
    teamRestDays?: number | null;
    oppRestDays?: number | null;
  },
): PropRecommendation[] {
  if (!average && logs.length === 0) return [];
  const syntheticAvg: PlayerSeasonAverage = average ?? {
    player_id: logs[0]?.player_id ?? 0,
    league_id: 1,
    season_id: 1,
    team_id: logs[0]?.team_id ?? null,
    full_name: 'Jugador',
    jersey_number: null,
    position: null,
    headshot_url: null,
    team_name: null,
    team_short_name: null,
    team_abbreviation: null,
    team_primary_color: null,
    team_logo_url: null,
    gp: logs.length,
    mpg: 0,
    ppg: logs.reduce((s, r) => s + r.pts, 0) / Math.max(1, logs.length),
    rpg: logs.reduce((s, r) => s + r.reb, 0) / Math.max(1, logs.length),
    apg: logs.reduce((s, r) => s + r.ast, 0) / Math.max(1, logs.length),
    spg: 0,
    bpg: 0,
    topg: 0,
    plus_minus_avg: 0,
    fg_pct: null,
    tp_pct: null,
    ft_pct: null,
    efg_pct: null,
    ts_pct: null,
    double_doubles: 0,
    triple_doubles: 0,
    total_pts: 0,
    total_reb: 0,
    total_ast: 0,
  };

  const metrics: PlayerChartMetric[] = ['pts', 'reb', 'ast', 'pra', 'tpm'];
  const recs: PropRecommendation[] = [];
  for (const m of metrics) {
    const rec = evaluatePlayerPropMarket(syntheticAvg, logs, m, oppTeamAvg, ctx);
    if (rec) recs.push(rec);
  }
  return recs.sort((a, b) => b.confidence - a.confidence);
}

export function buildGamePropsRecommendations(params: {
  game: Game;
  homeStanding: TeamStanding | null;
  awayStanding: TeamStanding | null;
  homeTeamAvg: TeamSeasonAverage | null;
  awayTeamAvg: TeamSeasonAverage | null;
  homeRecent: TeamRecentSummary;
  awayRecent: TeamRecentSummary;
  homeRecentGames?: Game[];
  awayRecentGames?: Game[];
  keyPlayers: PlayerSeasonAverage[];
  playerRecentLogs: PlayerGameStat[];
}): PropRecommendation[] {
  const {
    game,
    homeStanding,
    awayStanding,
    homeTeamAvg,
    awayTeamAvg,
    homeRecent,
    awayRecent,
    homeRecentGames,
    awayRecentGames,
    keyPlayers,
    playerRecentLogs,
  } = params;

  const odds = game.odds;
  const insight = buildMatchupBettingInsight(
    game,
    homeStanding,
    awayStanding,
    homeRecent,
    awayRecent,
    homeRecentGames,
    awayRecentGames,
  );
  const homeRestDays = insight.homeRestDays;
  const awayRestDays = insight.awayRestDays;
  const totalRestAdjust = (homeRestDays === 0 ? -1.8 : 0) + (awayRestDays === 0 ? -1.8 : 0);

  const buildTeamRestBadges = (
    teamRest: number | null,
    oppRest: number | null,
    venueLabel?: string,
  ): PropContextBadge[] => {
    const badges: PropContextBadge[] = [];
    if (venueLabel) badges.push({ label: venueLabel, tone: 'cyan' });
    if (teamRest === 0) badges.push({ label: 'Fatiga B2B (0d)', tone: 'rose' });
    else if (teamRest != null && teamRest >= 2) badges.push({ label: `Descanso ${teamRest}d`, tone: 'emerald' });
    else if (teamRest === 1) badges.push({ label: '1d descanso', tone: 'slate' });
    if (oppRest === 0) badges.push({ label: 'Rival en B2B', tone: 'emerald' });
    return badges;
  };

  const recs: PropRecommendation[] = [];

  const homePpg = Number(homeStanding?.ppg ?? homeTeamAvg?.ppg ?? homeRecent.avgFor ?? 0);
  const homeOppg = Number(homeStanding?.oppg ?? homeTeamAvg?.oppg ?? homeRecent.avgAgainst ?? 0);
  const awayPpg = Number(awayStanding?.ppg ?? awayTeamAvg?.ppg ?? awayRecent.avgFor ?? 0);
  const awayOppg = Number(awayStanding?.oppg ?? awayTeamAvg?.oppg ?? awayRecent.avgAgainst ?? 0);

  // 1. Total del Partido (Over / Under)
  const fallbackSeasonTotal =
    homePpg > 0 && awayPpg > 0 && homeOppg > 0 && awayOppg > 0
      ? (homePpg + awayOppg) / 2 + (awayPpg + homeOppg) / 2 + totalRestAdjust
      : null;
  const seasonTotal = insight.expectedTotalSeason ?? fallbackSeasonTotal;
  const recentTotal = insight.expectedTotalRecent;
  const blendedTotal =
    seasonTotal != null && recentTotal != null
      ? seasonTotal * 0.55 + recentTotal * 0.45
      : recentTotal ?? seasonTotal;

  if (blendedTotal != null && blendedTotal > 100) {
    const hasBookOu = odds?.over_under != null;
    const marketOu = hasBookOu ? Number(odds!.over_under) : snapHalf(blendedTotal);
    const edge = blendedTotal - marketOu;
    const pick: 'OVER' | 'UNDER' = edge >= 0 ? 'OVER' : 'UNDER';
    const recentOverTotal = awayRecent.overHits + homeRecent.overHits;
    const recentOverTracked = awayRecent.overTracked + homeRecent.overTracked;
    const overRate = recentOverTracked > 0 ? recentOverTotal / recentOverTracked : 0.5;
    const alignedTrend = pick === 'OVER' ? overRate : 1 - overRate;
    const conf = clampConfidence(52 + Math.min(28, Math.abs(edge) * 3.8) + (alignedTrend - 0.5) * 20);
    const bookTotalOdds = pick === 'OVER' ? odds?.over_odds : odds?.under_odds;
    const oddsPair = computePropOddsFromConfidence(conf, bookTotalOdds);

    const totalBadges: PropContextBadge[] = [];
    if (awayRestDays === 0) totalBadges.push({ label: `${game.away_team.abbreviation} en B2B`, tone: 'rose' });
    if (homeRestDays === 0) totalBadges.push({ label: `${game.home_team.abbreviation} en B2B`, tone: 'rose' });
    if (awayRestDays != null && awayRestDays >= 2 && homeRestDays != null && homeRestDays >= 2) {
      totalBadges.push({ label: 'Ambos descansados', tone: 'emerald' });
    }
    if (recentOverTracked > 0) {
      totalBadges.push({ label: `Over rec. ${recentOverTotal}/${recentOverTracked}`, tone: 'cyan' });
    }

    recs.push({
      id: `team_total_${game.id}`,
      scope: 'team',
      marketLabel: 'Total de Puntos del Partido',
      subjectName: `${game.away_team.abbreviation} @ ${game.home_team.abbreviation}`,
      teamAbbr: `${game.away_team.abbreviation}/${game.home_team.abbreviation}`,
      statSummary: `Ritmo proyectado: ${blendedTotal.toFixed(1)} pts (${awayPpg.toFixed(1)} vs ${homePpg.toFixed(1)} PPG)${
        recentOverTracked > 0 ? ` · Over reciente: ${recentOverTotal}/${recentOverTracked}` : ''
      }`,
      marketLineText: `${hasBookOu ? 'Línea Casa' : 'Línea Proyectada'}: ${marketOu.toFixed(1)} pts · Cuota ${oddsPair.decimal.toFixed(2)}x`,
      lineValue: marketOu,
      pick,
      pickLabel: `${pick} ${marketOu.toFixed(1)} PTS`,
      rationale: `La proyección estadística (${blendedTotal.toFixed(1)} pts) queda ${Math.abs(edge).toFixed(1)} pts ${
        edge >= 0 ? 'por encima' : 'por debajo'
      } de la línea del mercado (${marketOu.toFixed(1)}).`,
      confidence: conf,
      confidenceTier: getConfidenceTier(conf),
      estimatedOddsAmerican: oddsPair.american,
      estimatedMultiplier: oddsPair.decimal,
      contextBadges: totalBadges,
      restInfo: { teamRestDays: homeRestDays, oppRestDays: awayRestDays },
    });
  }

  // 2. Hándicap / Spread
  if (insight.projectedHomeMargin != null) {
    const hasBookSpread = odds?.home_spread != null;
    const homeSpread = hasBookSpread
      ? Number(odds!.home_spread)
      : snapHalf(-insight.projectedHomeMargin);
    const awaySpread = hasBookSpread && odds?.away_spread != null ? Number(odds.away_spread) : -homeSpread;
    const edgeHome = insight.projectedHomeMargin + homeSpread;
    const favorHome = edgeHome >= 0;
    const chosenTeam = favorHome ? game.home_team : game.away_team;
    const chosenSpread = favorHome ? homeSpread : awaySpread;
    const chosenRecent = favorHome ? homeRecent : awayRecent;
    const atsRate = chosenRecent.atsTracked > 0 ? chosenRecent.atsWins / chosenRecent.atsTracked : 0.5;
    const chosenOdds = favorHome ? odds?.home_spread_odds : odds?.away_spread_odds;
    const conf = clampConfidence(52 + Math.min(26, Math.abs(edgeHome) * 3.5) + (atsRate - 0.5) * 18);
    const oddsPair = computePropOddsFromConfidence(conf, chosenOdds);
    const teamRest = favorHome ? homeRestDays : awayRestDays;
    const oppRest = favorHome ? awayRestDays : homeRestDays;

    recs.push({
      id: `team_spread_${game.id}`,
      scope: 'team',
      marketLabel: 'Hándicap (Spread)',
      subjectName: `${chosenTeam.short_name}`,
      teamAbbr: chosenTeam.abbreviation,
      statSummary: `Margen proyectado: ${game.home_team.abbreviation} ${
        insight.projectedHomeMargin >= 0 ? '+' : ''
      }${insight.projectedHomeMargin.toFixed(1)} pts${
        chosenRecent.atsTracked > 0
          ? ` · ${chosenTeam.abbreviation} cubrió ATS ${chosenRecent.atsWins}/${chosenRecent.atsTracked}`
          : ''
      }`,
      marketLineText: `${hasBookSpread ? 'Línea Casa' : 'Línea Estimada'}: ${chosenTeam.abbreviation} ${formatSpreadCompact(chosenSpread)} · Cuota ${oddsPair.decimal.toFixed(2)}x`,
      lineValue: chosenSpread,
      pick: 'SPREAD',
      pickLabel: `${chosenTeam.abbreviation} ${formatSpreadCompact(chosenSpread)}`,
      rationale: `Por diferencial neto, localía y descanso, ${chosenTeam.short_name} ofrece ${Math.abs(edgeHome).toFixed(1)} pts de colchón estadístico frente al hándicap.`,
      confidence: conf,
      confidenceTier: getConfidenceTier(conf),
      estimatedOddsAmerican: oddsPair.american,
      estimatedMultiplier: oddsPair.decimal,
      contextBadges: buildTeamRestBadges(teamRest, oppRest, favorHome ? 'Local' : 'Visita'),
      restInfo: { teamRestDays: teamRest, oppRestDays: oppRest },
    });
  }

  // 3. Ganador (Moneyline)
  if (homeStanding || awayStanding || homeTeamAvg || awayTeamAvg) {
    const homeWinPct = Number(homeStanding?.win_pct ?? homeTeamAvg?.win_pct ?? 0.5);
    const awayWinPct = Number(awayStanding?.win_pct ?? awayTeamAvg?.win_pct ?? 0.5);
    const marginProb =
      insight.projectedHomeMargin != null
        ? Math.min(0.86, Math.max(0.14, 0.5 + insight.projectedHomeMargin * 0.028))
        : 0.5 + (homeWinPct - awayWinPct) * 0.45 + 0.04;
    const espnHomeProb = odds?.home_win_prob != null ? Number(odds.home_win_prob) / 100 : null;
    const modelHomeProb = espnHomeProb != null ? marginProb * 0.55 + espnHomeProb * 0.45 : marginProb;
    const modelAwayProb = 1 - modelHomeProb;

    const impHome = americanToImpliedProb(odds?.home_moneyline);
    const impAway = americanToImpliedProb(odds?.away_moneyline);

    const pickHome = modelHomeProb >= modelAwayProb;
    const chosenTeam = pickHome ? game.home_team : game.away_team;
    const chosenProb = (pickHome ? modelHomeProb : modelAwayProb) * 100;
    const chosenImplied = pickHome ? impHome : impAway;
    const chosenMlOdds = pickHome ? odds?.home_moneyline : odds?.away_moneyline;
    const valueDiff = chosenImplied != null ? chosenProb - chosenImplied : chosenProb - 50;
    const conf = clampConfidence(52 + (chosenProb - 50) * 0.85 + Math.max(-4, valueDiff * 0.45));
    const oddsPair = computePropOddsFromConfidence(conf, chosenMlOdds);
    const teamRest = pickHome ? homeRestDays : awayRestDays;
    const oppRest = pickHome ? awayRestDays : homeRestDays;

    recs.push({
      id: `team_ml_${game.id}`,
      scope: 'team',
      marketLabel: 'Ganador del Partido (ML)',
      subjectName: chosenTeam.short_name,
      teamAbbr: chosenTeam.abbreviation,
      statSummary: `Probabilidad estadística ${chosenTeam.abbreviation}: ${chosenProb.toFixed(1)}% (${
        pickHome
          ? `${homeStanding?.wins ?? homeTeamAvg?.wins ?? 0}-${homeStanding?.losses ?? homeTeamAvg?.losses ?? 0}`
          : `${awayStanding?.wins ?? awayTeamAvg?.wins ?? 0}-${awayStanding?.losses ?? awayTeamAvg?.losses ?? 0}`
      })`,
      marketLineText:
        chosenMlOdds != null
          ? `Cuota Casa ML: ${oddsPair.decimal.toFixed(2)}x (${formatAmericanOdds(chosenMlOdds)} · Implícita ${chosenImplied?.toFixed(0)}%)`
          : `Favorito estadístico (${chosenProb.toFixed(0)}% prob.) · Est. ${oddsPair.decimal.toFixed(2)}x`,
      lineValue: chosenProb,
      pick: 'ML',
      pickLabel: `GANA ${chosenTeam.abbreviation}`,
      rationale: `Ventaja en rendimiento global${
        chosenImplied != null
          ? ` con ${valueDiff >= 0 ? `+${valueDiff.toFixed(1)}%` : `${valueDiff.toFixed(1)}%`} frente a la probabilidad implícita de la casa`
          : ''
      }.`,
      confidence: conf,
      confidenceTier: getConfidenceTier(conf),
      estimatedOddsAmerican: oddsPair.american,
      estimatedMultiplier: oddsPair.decimal,
      contextBadges: buildTeamRestBadges(teamRest, oppRest, pickHome ? 'Localía' : 'Visita'),
      restInfo: { teamRestDays: teamRest, oppRestDays: oppRest },
    });
  }

  // 4. Total de Puntos por Equipo (Team Totals)
  const bookOu = odds?.over_under != null ? Number(odds.over_under) : null;
  const bookHomeSpread = odds?.home_spread != null ? Number(odds.home_spread) : null;

  const teamSides = [
    {
      role: 'Visita',
      isHome: false,
      team: game.away_team,
      teamAvg: awayTeamAvg,
      oppAvg: homeTeamAvg,
      myPpg: awayPpg,
      oppOppg: homeOppg,
      recent: awayRecent,
      oppRecent: homeRecent,
      teamRest: awayRestDays,
      oppRest: homeRestDays,
      impliedTeamLine:
        bookOu != null && bookHomeSpread != null
          ? snapHalf((bookOu + bookHomeSpread) / 2)
          : awayPpg > 0
            ? suggestPropLine(awayPpg)
            : null,
    },
    {
      role: 'Local',
      isHome: true,
      team: game.home_team,
      teamAvg: homeTeamAvg,
      oppAvg: awayTeamAvg,
      myPpg: homePpg,
      oppOppg: awayOppg,
      recent: homeRecent,
      oppRecent: awayRecent,
      teamRest: homeRestDays,
      oppRest: awayRestDays,
      impliedTeamLine:
        bookOu != null && bookHomeSpread != null
          ? snapHalf((bookOu - bookHomeSpread) / 2)
          : homePpg > 0
            ? suggestPropLine(homePpg)
            : null,
    },
  ];

  for (const s of teamSides) {
    if (s.myPpg <= 0 || s.oppOppg <= 0 || s.impliedTeamLine == null) continue;
    const seasonProj = (s.myPpg + s.oppOppg) / 2;
    const recentProj =
      s.recent.gamesCount > 0 && s.oppRecent.gamesCount > 0
        ? (s.recent.avgFor + s.oppRecent.avgAgainst) / 2
        : seasonProj;
    const b2bTeamAdj = (s.teamRest === 0 ? -1.8 : 0) + (s.oppRest === 0 ? 1.2 : 0);
    const proj = seasonProj * 0.55 + recentProj * 0.45 + b2bTeamAdj;
    const edge = proj - s.impliedTeamLine;
    const pick: 'OVER' | 'UNDER' = edge >= 0 ? 'OVER' : 'UNDER';
    const conf = clampConfidence(52 + Math.min(26, Math.abs(edge) * 5.2));
    const ptsOdds = computePropOddsFromConfidence(conf);

    recs.push({
      id: `team_pts_${s.team.id}`,
      scope: 'team',
      marketLabel: 'Total Puntos de Equipo',
      subjectName: `${s.team.short_name}`,
      teamAbbr: s.team.abbreviation,
      statSummary: `Anota ${s.myPpg.toFixed(1)} PPG (Últ. ${s.recent.gamesCount || 1}: ${recentProj.toFixed(1)}) · Rival recibe ${s.oppOppg.toFixed(1)}`,
      marketLineText: `Línea Equipo: ${s.impliedTeamLine.toFixed(1)} pts · Cuota ${ptsOdds.decimal.toFixed(2)}x`,
      lineValue: s.impliedTeamLine,
      pick,
      pickLabel: `${pick} ${s.impliedTeamLine.toFixed(1)} PTS (${s.team.abbreviation})`,
      rationale: `Cruce ofensivo/defensivo proyecta ${proj.toFixed(1)} pts para ${s.team.abbreviation} (${
        edge >= 0 ? '+' : ''
      }${edge.toFixed(1)} vs línea).`,
      confidence: conf,
      confidenceTier: getConfidenceTier(conf),
      estimatedOddsAmerican: ptsOdds.american,
      estimatedMultiplier: ptsOdds.decimal,
      contextBadges: buildTeamRestBadges(s.teamRest, s.oppRest, s.role),
      restInfo: { teamRestDays: s.teamRest, oppRestDays: s.oppRest },
    });

    // Triples de equipo & Rebotes de equipo
    if (s.teamAvg && Number(s.teamAvg.tpm_pg) > 0) {
      const tpmAvg = Number(s.teamAvg.tpm_pg);
      const line3p = suggestPropLine(tpmAvg);
      const defAdjust = s.oppOppg > 113.5 ? (s.oppOppg - 113.5) * 0.14 : (s.oppOppg - 113.5) * 0.1;
      const b2b3pAdj = s.teamRest === 0 ? -0.4 : 0;
      const proj3p = tpmAvg + defAdjust + b2b3pAdj;
      const edge3p = proj3p - line3p;
      const pick3p: 'OVER' | 'UNDER' = edge3p >= 0 ? 'OVER' : 'UNDER';
      const conf3p = clampConfidence(52 + Math.min(24, Math.abs(edge3p) * 16));
      const tpmOdds = computePropOddsFromConfidence(conf3p);

      recs.push({
        id: `team_3pm_${s.team.id}`,
        scope: 'team',
        marketLabel: 'Triples del Equipo (3PM)',
        subjectName: `${s.team.short_name}`,
        teamAbbr: s.team.abbreviation,
        statSummary: `Promedia ${tpmAvg.toFixed(1)} triples/PJ (${Number(s.teamAvg.tp_pct ?? 0).toFixed(1)}% 3P)`,
        marketLineText: `Línea Triples: ${line3p.toFixed(1)} 3PM · Cuota ${tpmOdds.decimal.toFixed(2)}x`,
        lineValue: line3p,
        pick: pick3p,
        pickLabel: `${pick3p} ${line3p.toFixed(1)} 3PM (${s.team.abbreviation})`,
        rationale: `Eficiencia exterior de ${s.team.abbreviation} frente a defensa rival (${s.oppOppg.toFixed(1)} OPPG) proyecta ${proj3p.toFixed(1)} triples.`,
        confidence: conf3p,
        confidenceTier: getConfidenceTier(conf3p),
        estimatedOddsAmerican: tpmOdds.american,
        estimatedMultiplier: tpmOdds.decimal,
        contextBadges: buildTeamRestBadges(s.teamRest, s.oppRest, s.role),
        restInfo: { teamRestDays: s.teamRest, oppRestDays: s.oppRest },
      });
    }

    if (s.teamAvg && Number(s.teamAvg.rpg) > 0 && s.oppAvg) {
      const rebAvg = Number(s.teamAvg.rpg);
      const oppReb = Number(s.oppAvg.rpg);
      const lineReb = suggestPropLine(rebAvg);
      const oppMissFactor = s.oppAvg.fg_pct != null ? (46.8 - Number(s.oppAvg.fg_pct)) * 0.25 : 0;
      const rebDiff = (rebAvg - oppReb) * 0.15;
      const projReb = rebAvg + oppMissFactor + rebDiff;
      const edgeReb = projReb - lineReb;
      const pickReb: 'OVER' | 'UNDER' = edgeReb >= 0 ? 'OVER' : 'UNDER';
      const confReb = clampConfidence(52 + Math.min(22, Math.abs(edgeReb) * 11));
      const rebOdds = computePropOddsFromConfidence(confReb);

      recs.push({
        id: `team_reb_${s.team.id}`,
        scope: 'team',
        marketLabel: 'Rebotes Totales del Equipo',
        subjectName: `${s.team.short_name}`,
        teamAbbr: s.team.abbreviation,
        statSummary: `Captura ${rebAvg.toFixed(1)} RPG (${Number(s.teamAvg.oreb_pg).toFixed(1)} ofensivos) vs ${oppReb.toFixed(1)} del rival`,
        marketLineText: `Línea Rebotes: ${lineReb.toFixed(1)} REB · Cuota ${rebOdds.decimal.toFixed(2)}x`,
        lineValue: lineReb,
        pick: pickReb,
        pickLabel: `${pickReb} ${lineReb.toFixed(1)} REB (${s.team.abbreviation})`,
        rationale: `Proyección de ${projReb.toFixed(1)} rebotes considerando el % de tiro rival y control del tablero.`,
        confidence: confReb,
        confidenceTier: getConfidenceTier(confReb),
        estimatedOddsAmerican: rebOdds.american,
        estimatedMultiplier: rebOdds.decimal,
        contextBadges: buildTeamRestBadges(s.teamRest, s.oppRest, s.role),
        restInfo: { teamRestDays: s.teamRest, oppRestDays: s.oppRest },
      });
    }
  }

  // 5. Player Props (PTS, REB, AST, PRA, 3PT) with MPG, Home/Away Split & B2B context
  const logsByPlayer = new Map<number, PlayerGameStat[]>();
  for (const log of playerRecentLogs) {
    const arr = logsByPlayer.get(log.player_id) ?? [];
    arr.push(log);
    logsByPlayer.set(log.player_id, arr);
  }

  const playerPropsPool: PropRecommendation[] = [];
  for (const p of keyPlayers) {
    const pLogs = logsByPlayer.get(p.player_id) ?? [];
    const isHomePlayer = p.team_id === game.home_team_id;
    const oppTeamAvg = isHomePlayer ? awayTeamAvg : homeTeamAvg;
    const playerCtx = {
      isHome: isHomePlayer,
      teamRestDays: isHomePlayer ? homeRestDays : awayRestDays,
      oppRestDays: isHomePlayer ? awayRestDays : homeRestDays,
    };
    const candidateMetrics: PlayerChartMetric[] = ['pts', 'reb', 'ast', 'pra', 'tpm'];
    const pRecs: PropRecommendation[] = [];
    for (const mk of candidateMetrics) {
      const evaluated = evaluatePlayerPropMarket(p, pLogs, mk, oppTeamAvg, playerCtx);
      if (evaluated) pRecs.push(evaluated);
    }
    pRecs.sort((a, b) => b.confidence - a.confidence);
    playerPropsPool.push(...pRecs.slice(0, 2));
  }

  playerPropsPool.sort((a, b) => b.confidence - a.confidence);
  recs.push(...playerPropsPool.slice(0, 12));

  // Default order: MAYOR A MENOR CONFIANZA (highest probability picks first)
  return recs.sort((a, b) => b.confidence - a.confidence);
}

export interface PropLiveStatus {
  label: string;
  state: 'won' | 'lost' | 'push' | 'live' | 'dnp' | 'pending';
}

/**
 * Evaluate live or final outcome of any team or player prop against current game/boxscore data.
 */
export function evaluatePropStatus(
  prop: PropRecommendation,
  game: Game,
  boxStats: PlayerGameStat[] = [],
): PropLiveStatus | null {
  if (game.status === 'scheduled' || game.status === 'postponed') return null;

  const isFinal = game.status === 'final';
  const gradeOverUnder = (
    val: number,
    line: number,
    pick: 'OVER' | 'UNDER',
    unit: string,
  ): PropLiveStatus => {
    if (isFinal) {
      if (val === line) return { label: `EMPATE (${val} ${unit})`, state: 'push' };
      const won = pick === 'OVER' ? val > line : val < line;
      return { label: `${won ? 'GANÓ' : 'PERDIÓ'} · ${val}`, state: won ? 'won' : 'lost' };
    }
    if (pick === 'OVER' && val > line) {
      return { label: `CUMPLIÓ · ${val}`, state: 'won' };
    }
    return { label: `EN VIVO · ${val}/${line}`, state: 'live' };
  };

  if (prop.scope === 'player' && prop.playerId && prop.metricKey) {
    const row = boxStats.find((s) => s.player_id === prop.playerId);
    if (!row) return isFinal ? null : { label: 'EN VIVO', state: 'live' };
    if (row.did_not_play) return { label: 'DNP', state: 'dnp' };
    const val = PLAYER_CHART_METRICS[prop.metricKey].getStatValue(row);
    const pick = prop.pick === 'UNDER' ? 'UNDER' : 'OVER';
    return gradeOverUnder(val, prop.lineValue, pick, prop.metricKey.toUpperCase());
  }

  if (prop.id.startsWith('team_total_')) {
    const total = game.away_score + game.home_score;
    return gradeOverUnder(total, prop.lineValue, prop.pick === 'UNDER' ? 'UNDER' : 'OVER', 'PTS');
  }

  if (prop.id === `team_pts_${game.away_team_id}`) {
    return gradeOverUnder(
      game.away_score,
      prop.lineValue,
      prop.pick === 'UNDER' ? 'UNDER' : 'OVER',
      'PTS',
    );
  }

  if (prop.id === `team_pts_${game.home_team_id}`) {
    return gradeOverUnder(
      game.home_score,
      prop.lineValue,
      prop.pick === 'UNDER' ? 'UNDER' : 'OVER',
      'PTS',
    );
  }

  if (prop.id.startsWith('team_spread_')) {
    const isHome = prop.teamAbbr === game.home_team.abbreviation;
    const diff = isHome ? game.home_score - game.away_score : game.away_score - game.home_score;
    const adjusted = diff + prop.lineValue;
    if (!isFinal) {
      return { label: `EN VIVO · ${diff >= 0 ? '+' : ''}${diff}`, state: 'live' };
    }
    if (adjusted === 0) return { label: 'EMPATE ATS', state: 'push' };
    return {
      label: `${adjusted > 0 ? 'CUBRIÓ' : 'NO CUBRIÓ'} (${diff >= 0 ? '+' : ''}${diff})`,
      state: adjusted > 0 ? 'won' : 'lost',
    };
  }

  if (prop.id.startsWith('team_ml_')) {
    const isHome = prop.teamAbbr === game.home_team.abbreviation;
    const myScore = isHome ? game.home_score : game.away_score;
    const opScore = isHome ? game.away_score : game.home_score;
    if (!isFinal) {
      return { label: `EN VIVO · ${myScore}-${opScore}`, state: 'live' };
    }
    const won = myScore > opScore;
    return {
      label: `${won ? 'GANÓ' : 'PERDIÓ'} · ${myScore}-${opScore}`,
      state: won ? 'won' : 'lost',
    };
  }

  if (prop.id.startsWith('team_3pm_') || prop.id.startsWith('team_reb_')) {
    const teamId = Number(prop.id.replace(/^team_(3pm|reb)_/, ''));
    const teamRows = boxStats.filter((r) => r.team_id === teamId);
    if (teamRows.length === 0) return isFinal ? null : { label: 'EN VIVO', state: 'live' };
    const val = prop.id.startsWith('team_3pm_')
      ? teamRows.reduce((s, r) => s + r.tpm, 0)
      : teamRows.reduce((s, r) => s + r.reb, 0);
    return gradeOverUnder(val, prop.lineValue, prop.pick === 'UNDER' ? 'UNDER' : 'OVER', '');
  }

  return null;
}
