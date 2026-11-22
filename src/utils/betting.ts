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
 * Standard normal cumulative distribution function Φ(z) via Abramowitz & Stegun approximation.
 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return 0.5;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Poisson survival probability P(X >= k) for integer count k >= 0 with rate lambda.
 */
export function poissonAtLeast(lambda: number, k: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) return k <= 0 ? 1 : 0;
  if (k <= 0) return 1;
  const cappedLambda = Math.min(20, lambda);
  let pmf = Math.exp(-cappedLambda);
  let cdfBelow = 0;
  for (let i = 0; i < k; i++) {
    cdfBelow += pmf;
    pmf = (pmf * cappedLambda) / (i + 1);
  }
  return Math.max(0, Math.min(1, 1 - cdfBelow));
}

/**
 * Empirical sample standard deviation shrunk toward a domain-specific prior when sample is small.
 */
export function computeSampleStdDev(values: number[], priorSd: number): number {
  const safePrior = Math.max(0.5, priorSd);
  if (values.length < 4) return safePrior;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  const sampleSd = Math.sqrt(Math.max(0, variance));
  const weight = values.length >= 8 ? 0.78 : 0.62;
  return Math.max(0.5, sampleSd * weight + safePrior * (1 - weight));
}

/**
 * Bayesian-smoothed empirical hit rate to avoid 100% small-sample inflation (e.g. 6/6 -> 90%+).
 */
export function smoothEmpiricalRate(hits: number, total: number, priorProb: number): number {
  if (total <= 0) return priorProb;
  return Math.max(0, Math.min(1, (hits + 1.2 * priorProb) / (total + 1.2)));
}

/**
 * Select the most playable Safe recommendation (sweet-spot 67%-82% confidence for viable odds)
 * instead of trivial 86%-91% lines that pay ~1.06x.
 */
export function selectPlayableSafeCandidate(
  candidates: PropRecommendation[],
): PropRecommendation | null {
  if (candidates.length === 0) return null;
  const inSweetSpot = candidates.filter((c) => c.confidence >= 67 && c.confidence <= 82);
  if (inSweetSpot.length > 0) {
    return [...inSweetSpot].sort((a, b) => b.confidence - a.confidence)[0];
  }
  const highAbove = candidates.filter((c) => c.confidence > 82);
  if (highAbove.length > 0) {
    return [...highAbove].sort((a, b) => a.confidence - b.confidence)[0];
  }
  return [...candidates].sort((a, b) => b.confidence - a.confidence)[0];
}

const HARD_OUT_STATUS_TOKENS = ['out', 'doubt', 'suspend', 'inactive', 'injur', 'ir', 'dnp'];
const QUESTIONABLE_STATUS_TOKENS = ['question', 'day-to-day', 'gtd', 'probab'];

export interface PlayerAvailabilityResult {
  available: boolean;
  questionable: boolean;
  reason?: string;
}

/**
 * Determine whether a player is active for upcoming/evaluated games based on synced ESPN status
 * and whether they appeared in their team's most recent logged game(s).
 */
export function checkPlayerAvailability(params: {
  playerId: number;
  statusText?: string | null;
  playerLogs: PlayerGameStat[];
  teamRecentGames?: Game[];
  allLoggedGameIds?: Set<number>;
  sport?: 'nba' | 'football';
}): PlayerAvailabilityResult {
  const { playerId: _playerId, statusText, playerLogs, teamRecentGames, allLoggedGameIds, sport = 'nba' } = params;
  const normalized = (statusText ?? '').trim().toLowerCase();

  if (normalized && normalized !== 'active') {
    if (HARD_OUT_STATUS_TOKENS.some((t) => normalized.includes(t))) {
      return { available: false, questionable: false, reason: `Estado: ${statusText}` };
    }
    if (QUESTIONABLE_STATUS_TOKENS.some((t) => normalized.includes(t))) {
      return { available: true, questionable: true, reason: `Cuestionable (${statusText})` };
    }
  }

  const playedLogs = playerLogs.filter(
    (r) => !r.did_not_play && (sport === 'football' || Number(r.minutes ?? 0) > 0),
  );
  if (teamRecentGames && teamRecentGames.length > 0 && allLoggedGameIds && allLoggedGameIds.size > 0) {
    const loggedTeamFinals = teamRecentGames.filter(
      (g) => g.status === 'final' && allLoggedGameIds.has(g.id),
    );
    if (loggedTeamFinals.length > 0) {
      const playedGameIds = new Set(playedLogs.map((r) => r.game_id));
      const checkWindow = sport === 'football' ? 2 : 1;
      const appearedRecently = loggedTeamFinals
        .slice(0, checkWindow)
        .some((g) => playedGameIds.has(g.id));
      if (!appearedRecently) {
        return {
          available: false,
          questionable: false,
          reason:
            sport === 'football'
              ? 'Ausente en los últimos 2 partidos de su club'
              : 'No jugó el último partido de su equipo',
        };
      }
    }
  }

  return { available: true, questionable: false };
}

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

function snapDownHalf(val: number, minHalf = 0.5): number {
  if (!Number.isFinite(val)) return minHalf;
  const stepped = Math.floor(val - 0.5) + 0.5;
  return Math.max(minHalf, stepped);
}

function clampConfidence(val: number): number {
  return Math.max(51, Math.min(91, Math.round(val)));
}

export type PropStrategyMode = 'safe' | 'value';

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
  strategy?: PropStrategyMode;
  teamId?: number;
  projectedValue?: number;
  marketLabel: string;
  subjectName: string;
  teamAbbr: string;
  playerId?: number;
  metricKey?: PlayerChartMetric;
  footballMetricKey?: 'goals' | 'shots' | 'sot' | 'assists';
  statSummary: string;
  marketLineText: string;
  lineValue: number;
  pick: 'OVER' | 'UNDER' | 'SPREAD' | 'ML' | 'DC';
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

/**
 * Derive realistic vigged sportsbook odds from true calibrated probability when real odds are absent.
 */
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
  const p = Math.max(0.12, Math.min(0.9, confidence / 100));
  const viggedProb = Math.min(0.955, p * 1.045);
  const dec = Math.max(1.06, 1 / viggedProb);
  const american =
    dec >= 2.0 ? Math.round((dec - 1) * 100) : Math.round(-100 / Math.max(0.05, dec - 1));
  return {
    american,
    decimal: Number(dec.toFixed(2)),
  };
}

function snapHalf(val: number): number {
  const r = Math.round(val * 2) / 2;
  return Number.isInteger(r) ? r - 0.5 : r;
}

const MARKET_NAMES: Record<
  PlayerChartMetric,
  { market: string; unit: string; minAvg: number; minSafeLine: number }
> = {
  pts: { market: 'Puntos de Jugador', unit: 'PTS', minAvg: 8.5, minSafeLine: 6.5 },
  reb: { market: 'Rebotes de Jugador', unit: 'REB', minAvg: 3.2, minSafeLine: 2.5 },
  ast: { market: 'Asistencias de Jugador', unit: 'AST', minAvg: 2.4, minSafeLine: 1.5 },
  pra: { market: 'Combo P+R+A', unit: 'P+R+A', minAvg: 14.5, minSafeLine: 10.5 },
  tpm: { market: 'Triples de Jugador', unit: '3PT', minAvg: 1.25, minSafeLine: 0.5 },
};

function evaluatePlayerPropMarkets(
  player: PlayerSeasonAverage,
  logs: PlayerGameStat[],
  metricKey: PlayerChartMetric,
  oppTeamAvg?: TeamSeasonAverage | null,
  ctx?: {
    isHome?: boolean;
    teamRestDays?: number | null;
    oppRestDays?: number | null;
    questionable?: boolean;
    minLogsRequired?: number;
  },
): PropRecommendation[] {
  const cfg = PLAYER_CHART_METRICS[metricKey];
  const meta = MARKET_NAMES[metricKey];
  const activeLogs = logs.filter((r) => !r.did_not_play && Number(r.minutes ?? 0) > 0);
  const minLogs = ctx?.minLogsRequired ?? 4;
  if (activeLogs.length > 0 && activeLogs.length < minLogs && Number(player.gp ?? 0) < 8) {
    return [];
  }

  const seasonAvg = cfg.getSeasonAvg(player, activeLogs.length > 0 ? activeLogs : logs);
  if (!Number.isFinite(seasonAvg) || seasonAvg < meta.minAvg) return [];

  const rawSeasonMpg = Number(player.mpg ?? 0);
  const seasonMpg =
    rawSeasonMpg > 0
      ? rawSeasonMpg
      : activeLogs.length > 0
        ? activeLogs.reduce((s, r) => s + Number(r.minutes ?? 0), 0) / activeLogs.length
        : 0;
  if (seasonMpg > 0 && seasonMpg < 16) return [];

  const sampleLogs = activeLogs.slice(0, 12);
  const sampleValues = sampleLogs.map((g) => cfg.getStatValue(g));
  const recentSlice = sampleValues.slice(0, 6);
  const recentAvg =
    recentSlice.length > 0 ? recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length : seasonAvg;

  // Shrinkage mean: 72% stable season talent + 28% recent 6 games (prevents chasing noise)
  let proj = sampleValues.length >= 3 ? seasonAvg * 0.72 + recentAvg * 0.28 : seasonAvg;
  const contextBadges: PropContextBadge[] = [];
  const rationaleParts: string[] = [];

  // 1. Recent Minutes (MPG) Trend Adjustment (bounded ±6%)
  const recentMpgSlice = activeLogs.slice(0, 5);
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
    if (seasonMpg >= 14) {
      const mpgFactor = Math.max(0.94, Math.min(1.06, 1 + (mpgDelta / Math.max(20, seasonMpg)) * 0.35));
      proj *= mpgFactor;
    }
    if (mpgDelta >= 2.2) {
      contextBadges.push({ label: `MPG ↑ ${recentMpg.toFixed(1)}m (+${mpgDelta.toFixed(1)})`, tone: 'emerald' });
      rationaleParts.push(`Minutos en alza (${recentMpg.toFixed(1)} min recientes vs ${seasonMpg.toFixed(1)} temp).`);
    } else if (mpgDelta <= -2.5) {
      contextBadges.push({ label: `MPG ↓ ${recentMpg.toFixed(1)}m (${mpgDelta.toFixed(1)})`, tone: 'amber' });
      rationaleParts.push(`Minutos reducidos (${recentMpg.toFixed(1)} min recientes).`);
    } else {
      contextBadges.push({ label: `MPG ${recentMpg.toFixed(1)}m`, tone: 'slate' });
    }
  }

  // 2. Home vs Away Split Adjustment (mild 10% shrinkage)
  let splitInfo: PropRecommendation['splitInfo'];
  if (ctx?.isHome != null) {
    const venueLogs = activeLogs.filter(
      (g) => g.game?.home_team_id != null && g.team_id != null && (g.game.home_team_id === g.team_id) === ctx.isHome,
    );
    if (venueLogs.length >= 3) {
      const venueAvg = venueLogs.reduce((s, g) => s + cfg.getStatValue(g), 0) / venueLogs.length;
      proj = proj * 0.9 + venueAvg * 0.1;
      proj *= ctx.isHome ? 1.008 : 0.994;
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
      proj *= ctx.isHome ? 1.008 : 0.994;
      contextBadges.push({ label: ctx.isHome ? 'Local' : 'Visita', tone: 'slate' });
    }
  }

  // 3. Fatigue / Back-to-Back (B2B) & Rest Days Adjustment
  if (ctx?.teamRestDays === 0) {
    if (metricKey === 'pts' || metricKey === 'pra' || metricKey === 'tpm') {
      proj *= 0.975;
    }
    contextBadges.push({ label: 'Fatiga B2B (0d desc.)', tone: 'rose' });
    rationaleParts.push('Equipo llega en Back-to-Back.');
  } else if (ctx?.teamRestDays != null && ctx.teamRestDays >= 2) {
    proj *= 1.008;
    contextBadges.push({ label: `Descanso ${ctx.teamRestDays}d`, tone: 'emerald' });
  } else if (ctx?.teamRestDays === 1) {
    contextBadges.push({ label: '1d descanso', tone: 'slate' });
  }

  if (ctx?.oppRestDays === 0) {
    proj *= 1.012;
    contextBadges.push({ label: 'Rival en B2B', tone: 'emerald' });
    rationaleParts.push('Rival juega en Back-to-Back.');
  }

  // 4. Opponent Defense / Rebounding Matchup Adjustment (bounded)
  let defNote = '';
  if (oppTeamAvg?.oppg != null && (metricKey === 'pts' || metricKey === 'pra')) {
    const oppDef = Number(oppTeamAvg.oppg);
    const factor = Math.max(-0.05, Math.min(0.05, ((oppDef - 113.5) / 113.5) * 0.35));
    proj *= 1 + factor;
    if (oppDef >= 117) defNote = ` Rival permite ${oppDef.toFixed(1)} PPG (defensa permisiva).`;
    else if (oppDef <= 109) defNote = ` Rival solo permite ${oppDef.toFixed(1)} PPG (defensa top).`;
  } else if (oppTeamAvg?.rpg != null && metricKey === 'reb') {
    const oppReb = Number(oppTeamAvg.rpg);
    const rebAdj = Math.max(-0.45, Math.min(0.45, (44.0 - oppReb) * 0.08));
    proj += rebAdj;
    if (oppReb <= 42) defNote = ` Rival concede tabla (${oppReb.toFixed(1)} RPG).`;
    else if (oppReb >= 46.5) defNote = ` Rival domina los rebotes (${oppReb.toFixed(1)} RPG).`;
  }

  const priorSd =
    metricKey === 'pts'
      ? Math.max(3.8, seasonAvg * 0.3)
      : metricKey === 'pra'
        ? Math.max(5.0, seasonAvg * 0.25)
        : metricKey === 'reb'
          ? Math.max(1.8, seasonAvg * 0.36)
          : metricKey === 'ast'
            ? Math.max(1.5, seasonAvg * 0.38)
            : Math.max(0.95, Math.sqrt(Math.max(0.5, seasonAvg)));
  const sd = computeSampleStdDev(sampleValues, priorSd);

  const extraRationale = rationaleParts.length > 0 ? ` ${rationaleParts.join(' ')}` : '';
  const restInfo =
    ctx?.teamRestDays !== undefined || ctx?.oppRestDays !== undefined
      ? { teamRestDays: ctx?.teamRestDays ?? null, oppRestDays: ctx?.oppRestDays ?? null }
      : undefined;

  const out: PropRecommendation[] = [];

  // A) SAFE MODE (Alternate Conservative Line Scaled for Viable Odds, 67%-82% Target)
  if (!ctx?.questionable && (seasonMpg === 0 || seasonMpg >= 18) && sampleValues.length >= 4) {
    if (metricKey === 'tpm') {
      const candidateLines = [2.5, 1.5, 0.5];
      let chosenTpm: {
        safeLine: number;
        pCal: number;
        empHits: number;
        empRate: number;
      } | null = null;
      for (const candidateLine of candidateLines) {
        const targetK = Math.ceil(candidateLine);
        if (targetK === 1 ? proj < 1.3 : proj < candidateLine + 0.25) continue;
        const pPois = poissonAtLeast(proj, targetK);
        const empHits = sampleValues.filter((v) => v >= targetK).length;
        const empRate = empHits / sampleValues.length;
        const smoothedEmp = smoothEmpiricalRate(empHits, sampleValues.length, pPois);
        const pCal = Math.min(
          0.89,
          sampleValues.length >= 6 ? 0.6 * pPois + 0.4 * smoothedEmp : pPois,
        );
        if (pCal >= 0.68 && empRate >= 0.62) {
          chosenTpm = { safeLine: candidateLine, pCal, empHits, empRate };
          break; // Highest qualifying line wins (e.g. +1.5 3PT over trivial +0.5 3PT)
        }
      }
      if (chosenTpm) {
        const confidence = clampConfidence(chosenTpm.pCal * 100);
        const oddsPair = computePropOddsFromConfidence(confidence);
        const targetK = Math.ceil(chosenTpm.safeLine);
        out.push({
          id: `player_${player.player_id}_${metricKey}_safe`,
          scope: 'player',
          strategy: 'safe',
          teamId: player.team_id ?? undefined,
          projectedValue: Number(proj.toFixed(2)),
          marketLabel: `${meta.market} · Segura`,
          subjectName: player.full_name,
          teamAbbr: player.team_abbreviation ?? 'NBA',
          playerId: player.player_id,
          metricKey,
          statSummary: `Temp: ${seasonAvg.toFixed(1)} ${meta.unit} · Cumplió ${chosenTpm.empHits}/${sampleValues.length} últimos PJ (${Math.round(chosenTpm.empRate * 100)}%)`,
          marketLineText: `Línea Segura: +${chosenTpm.safeLine.toFixed(1)} ${meta.unit} · Cuota ${oddsPair.decimal.toFixed(2)}x`,
          lineValue: chosenTpm.safeLine,
          pick: 'OVER',
          pickLabel: `OVER ${chosenTpm.safeLine.toFixed(1)} ${meta.unit}`,
          rationale: `Modelo Poisson proyecta ${proj.toFixed(1)} ${meta.unit} (prob. real de ≥${targetK} ${targetK === 1 ? 'triple' : 'triples'}: ${confidence}%).${defNote}${extraRationale}`,
          confidence,
          confidenceTier: getConfidenceTier(confidence),
          estimatedOddsAmerican: oddsPair.american,
          estimatedMultiplier: oddsPair.decimal,
          contextBadges: [{ label: 'Línea Segura', tone: 'emerald' }, ...contextBadges],
          mpgInfo,
          splitInfo,
          restInfo,
        });
      }
    } else {
      const stdLine = suggestPropLine(seasonAvg);
      const minGap = metricKey === 'pts' || metricKey === 'pra' ? 2.0 : 1.0;
      const maxSafeLine = stdLine - minGap;
      const baseSafeLine = snapDownHalf(proj - 0.65 * sd, meta.minSafeLine);
      const step = metricKey === 'pts' || metricKey === 'pra' ? 1.0 : 0.5;
      const candidates: Array<{
        safeLine: number;
        z: number;
        pCal: number;
        empHits: number;
      }> = [];

      for (
        let line = Math.min(maxSafeLine, Math.max(meta.minSafeLine, maxSafeLine));
        line >= Math.max(meta.minSafeLine, Math.min(maxSafeLine, baseSafeLine) - step * 2);
        line = Number((line - step).toFixed(1))
      ) {
        if (proj - line < 1.0) continue;
        const z = (proj - line) / Math.max(1.2, sd);
        const pNorm = normalCdf(z);
        const empHits = sampleValues.filter((v) => v > line).length;
        const empRate = empHits / sampleValues.length;
        const smoothedEmp = smoothEmpiricalRate(empHits, sampleValues.length, pNorm);
        const pCal = Math.min(
          0.88,
          sampleValues.length >= 6 ? 0.6 * pNorm + 0.4 * smoothedEmp : pNorm,
        );
        if (pCal >= 0.67 && empRate >= 0.62) {
          candidates.push({ safeLine: line, z, pCal, empHits });
        }
      }

      if (candidates.length > 0) {
        // Prefer the highest line whose calibrated confidence stays in the 67%-82% playable range
        const inRange = candidates.filter((c) => Math.round(c.pCal * 100) <= 82);
        const chosen = inRange.length > 0
          ? inRange.sort((a, b) => b.safeLine - a.safeLine)[0]
          : candidates.sort((a, b) => b.safeLine - a.safeLine)[0];
        const confidence = clampConfidence(chosen.pCal * 100);
        const oddsPair = computePropOddsFromConfidence(confidence);
        out.push({
          id: `player_${player.player_id}_${metricKey}_safe`,
          scope: 'player',
          strategy: 'safe',
          teamId: player.team_id ?? undefined,
          projectedValue: Number(proj.toFixed(1)),
          marketLabel: `${meta.market} · Segura`,
          subjectName: player.full_name,
          teamAbbr: player.team_abbreviation ?? 'NBA',
          playerId: player.player_id,
          metricKey,
          statSummary: `Temp: ${seasonAvg.toFixed(1)} ${meta.unit} (SD ${sd.toFixed(1)}) · Cumplió ${chosen.empHits}/${sampleValues.length} últimos PJ`,
          marketLineText: `Línea Segura: ${chosen.safeLine.toFixed(1)} ${meta.unit} · Cuota ${oddsPair.decimal.toFixed(2)}x`,
          lineValue: chosen.safeLine,
          pick: 'OVER',
          pickLabel: `OVER ${chosen.safeLine.toFixed(1)} ${meta.unit}`,
          rationale: `Proyección ${proj.toFixed(1)} vs línea conservadora ${chosen.safeLine.toFixed(1)} (z=+${chosen.z.toFixed(2)}, prob. calibrada ${confidence}%).${defNote}${extraRationale}`,
          confidence,
          confidenceTier: getConfidenceTier(confidence),
          estimatedOddsAmerican: oddsPair.american,
          estimatedMultiplier: oddsPair.decimal,
          contextBadges: [{ label: 'Línea Segura', tone: 'emerald' }, ...contextBadges],
          mpgInfo,
          splitInfo,
          restInfo,
        });
      }
    }
  }

  // B) VALUE MODE (Standard Line Anchored to Season Average, Strictly Filtered)
  const lineValue = suggestPropLine(seasonAvg);
  const edge = proj - lineValue;
  const pick: 'OVER' | 'UNDER' = edge >= 0 ? 'OVER' : 'UNDER';
  // Block UNDER on high-skew small counts (3PT, AST) and unbacked cold streaks without MPG drop
  const allowUnder =
    pick === 'UNDER' &&
    metricKey !== 'tpm' &&
    metricKey !== 'ast' &&
    (mpgDelta <= -2.2 || (oppTeamAvg?.oppg != null && Number(oppTeamAvg.oppg) <= 108.5));

  if ((pick === 'OVER' || allowUnder) && sampleValues.length >= Math.min(4, minLogs)) {
    const pModel =
      metricKey === 'tpm'
        ? poissonAtLeast(proj, Math.ceil(lineValue))
        : normalCdf(Math.abs(edge) / Math.max(1.2, sd));
    const empHits = sampleValues.filter((v) => (pick === 'OVER' ? v > lineValue : v < lineValue)).length;
    const empRate = sampleValues.length > 0 ? empHits / sampleValues.length : 0.54;
    const pCal = Math.min(0.74, sampleValues.length >= 6 ? 0.65 * pModel + 0.35 * empRate : pModel);
    const minValueProb = metricKey === 'pra' || metricKey === 'reb' ? 0.6 : 0.58;

    if (pCal >= minValueProb && empRate >= 0.58) {
      const confidence = clampConfidence(pCal * 100);
      const oddsPair = computePropOddsFromConfidence(confidence);
      const statSummary =
        recentSlice.length > 0
          ? `Temp: ${seasonAvg.toFixed(1)} ${meta.unit} · Últ. ${sampleValues.length} PJ: ${empHits}/${sampleValues.length} (${Math.round(empRate * 100)}%)`
          : `Prom. temporada: ${seasonAvg.toFixed(1)} ${meta.unit} (${player.gp} PJ)`;

      out.push({
        id: `player_${player.player_id}_${metricKey}_val`,
        scope: 'player',
        strategy: 'value',
        teamId: player.team_id ?? undefined,
        projectedValue: Number(proj.toFixed(1)),
        marketLabel: meta.market,
        subjectName: player.full_name,
        teamAbbr: player.team_abbreviation ?? 'NBA',
        playerId: player.player_id,
        metricKey,
        statSummary,
        marketLineText: `Línea Estándar: ${lineValue.toFixed(1)} ${meta.unit} · Cuota ${oddsPair.decimal.toFixed(2)}x`,
        lineValue,
        pick,
        pickLabel: `${pick} ${lineValue.toFixed(1)} ${meta.unit}`,
        rationale: `Proyección ${proj.toFixed(1)} ${meta.unit} vs línea ${lineValue.toFixed(1)} (${edge >= 0 ? '+' : ''}${edge.toFixed(1)} ventaja · prob. ${confidence}%).${defNote}${extraRationale}`,
        confidence,
        confidenceTier: getConfidenceTier(confidence),
        estimatedOddsAmerican: oddsPair.american,
        estimatedMultiplier: oddsPair.decimal,
        contextBadges,
        mpgInfo,
        splitInfo,
        restInfo,
      });
    }
  }

  return out;
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
    recs.push(
      ...evaluatePlayerPropMarkets(syntheticAvg, logs, m, oppTeamAvg, {
        ...ctx,
        minLogsRequired: 3,
      }),
    );
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
  playerStatuses?: Record<number, string>;
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
    playerStatuses,
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
  const totalRestAdjust = (homeRestDays === 0 ? -1.4 : 0) + (awayRestDays === 0 ? -1.4 : 0);

  const buildTeamRestBadges = (
    teamRest: number | null,
    oppRest: number | null,
    venueLabel?: string,
    extraBadge?: PropContextBadge,
  ): PropContextBadge[] => {
    const badges: PropContextBadge[] = [];
    if (extraBadge) badges.push(extraBadge);
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

  // 1. Total del Partido (Calibrated NBA SD = 15.5 pts, anchored to closing line)
  const fallbackSeasonTotal =
    homePpg > 0 && awayPpg > 0 && homeOppg > 0 && awayOppg > 0
      ? (homePpg + awayOppg) / 2 + (awayPpg + homeOppg) / 2 + totalRestAdjust
      : null;
  const seasonTotal = insight.expectedTotalSeason ?? fallbackSeasonTotal;
  const recentTotal = insight.expectedTotalRecent;
  const blendedTotal =
    seasonTotal != null && recentTotal != null
      ? seasonTotal * 0.7 + recentTotal * 0.3
      : seasonTotal ?? recentTotal;

  const bookOu = odds?.over_under != null ? Number(odds.over_under) : null;
  const anchorTotal =
    bookOu != null && blendedTotal != null
      ? bookOu * 0.72 + blendedTotal * 0.28
      : bookOu ?? blendedTotal;

  if (anchorTotal != null && anchorTotal > 140) {
    const recentOverTotal = awayRecent.overHits + homeRecent.overHits;
    const recentOverTracked = awayRecent.overTracked + homeRecent.overTracked;
    const overRate = recentOverTracked > 0 ? recentOverTotal / recentOverTracked : 0.5;

    const totalBadgesBase: PropContextBadge[] = [];
    if (awayRestDays === 0) totalBadgesBase.push({ label: `${game.away_team.abbreviation} en B2B`, tone: 'rose' });
    if (homeRestDays === 0) totalBadgesBase.push({ label: `${game.home_team.abbreviation} en B2B`, tone: 'rose' });
    if (awayRestDays != null && awayRestDays >= 2 && homeRestDays != null && homeRestDays >= 2) {
      totalBadgesBase.push({ label: 'Ambos descansados', tone: 'emerald' });
    }
    if (recentOverTracked > 0) {
      totalBadgesBase.push({ label: `Over rec. ${recentOverTotal}/${recentOverTracked}`, tone: 'cyan' });
    }

    // 1A. SAFE Alternate Total (±16.5 pts cushion from anchored center, empirical NBA total SD = 18.5)
    const leanOver = (blendedTotal ?? anchorTotal) >= anchorTotal;
    const safePick: 'OVER' | 'UNDER' = leanOver ? 'OVER' : 'UNDER';
    const safeTotalLine = leanOver
      ? snapDownHalf(anchorTotal - 16.5, 170.5)
      : snapHalf(anchorTotal + 16.5);
    const safeMargin = leanOver ? anchorTotal - safeTotalLine : safeTotalLine - anchorTotal;
    const pSafeTotal = Math.min(0.83, normalCdf(safeMargin / 18.5));
    if (pSafeTotal >= 0.7) {
      const conf = clampConfidence(pSafeTotal * 100);
      const oddsPair = computePropOddsFromConfidence(conf);
      recs.push({
        id: `team_total_safe_${game.id}`,
        scope: 'team',
        strategy: 'safe',
        projectedValue: Number(anchorTotal.toFixed(1)),
        marketLabel: 'Total del Partido · Segura',
        subjectName: `${game.away_team.abbreviation} @ ${game.home_team.abbreviation}`,
        teamAbbr: `${game.away_team.abbreviation}/${game.home_team.abbreviation}`,
        statSummary: `Centro mercado/modelo: ${anchorTotal.toFixed(1)} pts · Colchón de ${Math.abs(safeMargin).toFixed(1)} pts`,
        marketLineText: `Línea Alternativa: ${safeTotalLine.toFixed(1)} PTS · Cuota ${oddsPair.decimal.toFixed(2)}x`,
        lineValue: safeTotalLine,
        pick: safePick,
        pickLabel: `${safePick} ${safeTotalLine.toFixed(1)} PTS`,
        rationale: `Línea alternativa protegida ${Math.abs(safeMargin).toFixed(1)} pts respecto al total anclado (${anchorTotal.toFixed(1)}, SD 18.5 pts → prob. ${conf}%).`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsPair.american,
        estimatedMultiplier: oddsPair.decimal,
        contextBadges: [{ label: 'Línea Segura', tone: 'emerald' }, ...totalBadgesBase],
        restInfo: { teamRestDays: homeRestDays, oppRestDays: awayRestDays },
      });
    }

    // 1B. VALUE Standard Closing Total (avoid huge >7.5pt trap gaps)
    if (bookOu != null && blendedTotal != null) {
      const edge = blendedTotal - bookOu;
      const valPick: 'OVER' | 'UNDER' = edge >= 0 ? 'OVER' : 'UNDER';
      const alignedTrend = valPick === 'OVER' ? overRate : 1 - overRate;
      if (Math.abs(edge) >= 3.0 && Math.abs(edge) <= 7.5 && (recentOverTracked < 3 || alignedTrend >= 0.45)) {
        const pVal = Math.min(0.64, normalCdf((Math.abs(edge) * 0.5) / 15.5));
        if (pVal >= 0.55) {
          const conf = clampConfidence(pVal * 100);
          const bookTotalOdds = valPick === 'OVER' ? odds?.over_odds : odds?.under_odds;
          const oddsPair = computePropOddsFromConfidence(conf, bookTotalOdds);
          recs.push({
            id: `team_total_val_${game.id}`,
            scope: 'team',
            strategy: 'value',
            projectedValue: Number(blendedTotal.toFixed(1)),
            marketLabel: 'Total de Puntos del Partido',
            subjectName: `${game.away_team.abbreviation} @ ${game.home_team.abbreviation}`,
            teamAbbr: `${game.away_team.abbreviation}/${game.home_team.abbreviation}`,
            statSummary: `Ritmo proyectado: ${blendedTotal.toFixed(1)} pts vs línea ${bookOu.toFixed(1)}`,
            marketLineText: `Línea Casa: ${bookOu.toFixed(1)} PTS · Cuota ${oddsPair.decimal.toFixed(2)}x`,
            lineValue: bookOu,
            pick: valPick,
            pickLabel: `${valPick} ${bookOu.toFixed(1)} PTS`,
            rationale: `Diferencia moderada (${edge >= 0 ? '+' : ''}${edge.toFixed(1)} pts) frente al cierre sin señales extremas de lesión no descontadas.`,
            confidence: conf,
            confidenceTier: getConfidenceTier(conf),
            estimatedOddsAmerican: oddsPair.american,
            estimatedMultiplier: oddsPair.decimal,
            contextBadges: totalBadgesBase,
            restInfo: { teamRestDays: homeRestDays, oppRestDays: awayRestDays },
          });
        }
      }
    }
  }

  // 2. Hándicap / Spread (Calibrated NBA Margin SD = 12.5 pts)
  const bookHomeSpread = odds?.home_spread != null ? Number(odds.home_spread) : null;
  if (insight.projectedHomeMargin != null || bookHomeSpread != null) {
    const rawMargin = insight.projectedHomeMargin ?? -(bookHomeSpread ?? 0);
    const homeBookSpread = bookHomeSpread ?? snapHalf(-rawMargin);
    const awayBookSpread =
      bookHomeSpread != null && odds?.away_spread != null ? Number(odds.away_spread) : -homeBookSpread;
    const modelHomeMargin =
      bookHomeSpread != null ? (-homeBookSpread) * 0.62 + rawMargin * 0.38 : rawMargin;

    // 2A. SAFE Alt Spread (+5.5 pts cushion on the higher-probability side)
    const homeAltSpread = snapHalf(homeBookSpread + 5.5);
    const awayAltSpread = snapHalf(awayBookSpread + 5.5);
    const zHomeSafe = (modelHomeMargin + homeAltSpread) / 12.5;
    const zAwaySafe = (-modelHomeMargin + awayAltSpread) / 12.5;
    const safeFavorHome = zHomeSafe >= zAwaySafe;
    const safeSpreadTeam = safeFavorHome ? game.home_team : game.away_team;
    const safeSpreadLine = safeFavorHome ? homeAltSpread : awayAltSpread;
    const pSafeSpread = Math.min(0.84, normalCdf(Math.max(zHomeSafe, zAwaySafe)));

    if (pSafeSpread >= 0.66) {
      const conf = clampConfidence(pSafeSpread * 100);
      const oddsPair = computePropOddsFromConfidence(conf);
      const teamRest = safeFavorHome ? homeRestDays : awayRestDays;
      const oppRest = safeFavorHome ? awayRestDays : homeRestDays;
      recs.push({
        id: `team_spread_safe_${game.id}`,
        scope: 'team',
        strategy: 'safe',
        teamId: safeSpreadTeam.id,
        projectedValue: Number((safeFavorHome ? modelHomeMargin : -modelHomeMargin).toFixed(1)),
        marketLabel: 'Hándicap Alt. (+5.5) · Segura',
        subjectName: safeSpreadTeam.short_name,
        teamAbbr: safeSpreadTeam.abbreviation,
        statSummary: `Margen esperado: ${game.home_team.abbreviation} ${modelHomeMargin >= 0 ? '+' : ''}${modelHomeMargin.toFixed(1)} · Colchón +5.5 pts`,
        marketLineText: `Hándicap Alt.: ${safeSpreadTeam.abbreviation} ${formatSpreadCompact(safeSpreadLine)} · Cuota ${oddsPair.decimal.toFixed(2)}x`,
        lineValue: safeSpreadLine,
        pick: 'SPREAD',
        pickLabel: `${safeSpreadTeam.abbreviation} ${formatSpreadCompact(safeSpreadLine)}`,
        rationale: `Hándicap protegido con +5.5 pts de margen extra respecto a la línea base (prob. calibrada ${conf}%).`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsPair.american,
        estimatedMultiplier: oddsPair.decimal,
        contextBadges: buildTeamRestBadges(
          teamRest,
          oppRest,
          safeFavorHome ? 'Local' : 'Visita',
          { label: 'Colchón +5.5', tone: 'emerald' },
        ),
        restInfo: { teamRestDays: teamRest, oppRestDays: oppRest },
      });
    }

    // 2B. VALUE Standard Spread
    if (bookHomeSpread != null && insight.projectedHomeMargin != null) {
      const edgeHome = insight.projectedHomeMargin + bookHomeSpread;
      if (Math.abs(edgeHome) >= 2.5 && Math.abs(edgeHome) <= 7.5) {
        const favorHome = edgeHome >= 0;
        const chosenTeam = favorHome ? game.home_team : game.away_team;
        const chosenSpread = favorHome ? bookHomeSpread : awayBookSpread;
        const chosenRecent = favorHome ? homeRecent : awayRecent;
        const pVal = Math.min(0.64, normalCdf((Math.abs(edgeHome) * 0.55) / 12.5));
        if (pVal >= 0.55) {
          const conf = clampConfidence(pVal * 100);
          const chosenOdds = favorHome ? odds?.home_spread_odds : odds?.away_spread_odds;
          const oddsPair = computePropOddsFromConfidence(conf, chosenOdds);
          const teamRest = favorHome ? homeRestDays : awayRestDays;
          const oppRest = favorHome ? awayRestDays : homeRestDays;
          recs.push({
            id: `team_spread_val_${game.id}`,
            scope: 'team',
            strategy: 'value',
            teamId: chosenTeam.id,
            projectedValue: Number((favorHome ? insight.projectedHomeMargin : -insight.projectedHomeMargin).toFixed(1)),
            marketLabel: 'Hándicap (Spread)',
            subjectName: chosenTeam.short_name,
            teamAbbr: chosenTeam.abbreviation,
            statSummary: `Margen modelo: ${game.home_team.abbreviation} ${insight.projectedHomeMargin >= 0 ? '+' : ''}${insight.projectedHomeMargin.toFixed(1)}${
              chosenRecent.atsTracked > 0
                ? ` · ATS ${chosenRecent.atsWins}/${chosenRecent.atsTracked}`
                : ''
            }`,
            marketLineText: `Línea Casa: ${chosenTeam.abbreviation} ${formatSpreadCompact(chosenSpread)} · Cuota ${oddsPair.decimal.toFixed(2)}x`,
            lineValue: chosenSpread,
            pick: 'SPREAD',
            pickLabel: `${chosenTeam.abbreviation} ${formatSpreadCompact(chosenSpread)}`,
            rationale: `${chosenTeam.short_name} ofrece ${Math.abs(edgeHome).toFixed(1)} pts de valor controlado frente a la línea de cierre.`,
            confidence: conf,
            confidenceTier: getConfidenceTier(conf),
            estimatedOddsAmerican: oddsPair.american,
            estimatedMultiplier: oddsPair.decimal,
            contextBadges: buildTeamRestBadges(teamRest, oppRest, favorHome ? 'Local' : 'Visita'),
            restInfo: { teamRestDays: teamRest, oppRestDays: oppRest },
          });
        }
      }
    }
  }

  // 3. Ganador (Moneyline — Calibrated Normal CDF win probability)
  if (homeStanding || awayStanding || homeTeamAvg || awayTeamAvg) {
    const homeWinPct = Number(homeStanding?.win_pct ?? homeTeamAvg?.win_pct ?? 0.5);
    const awayWinPct = Number(awayStanding?.win_pct ?? awayTeamAvg?.win_pct ?? 0.5);
    const marginProb =
      insight.projectedHomeMargin != null
        ? normalCdf(insight.projectedHomeMargin / 12.5)
        : Math.max(0.18, Math.min(0.82, 0.5 + (homeWinPct - awayWinPct) * 0.45 + 0.04));
    const espnHomeProb = odds?.home_win_prob != null ? Number(odds.home_win_prob) / 100 : null;
    const modelHomeProb = espnHomeProb != null ? marginProb * 0.6 + espnHomeProb * 0.4 : marginProb;
    const modelAwayProb = 1 - modelHomeProb;

    const impHome = americanToImpliedProb(odds?.home_moneyline);
    const impAway = americanToImpliedProb(odds?.away_moneyline);

    const pickHome = modelHomeProb >= modelAwayProb;
    const chosenTeam = pickHome ? game.home_team : game.away_team;
    const chosenProb = (pickHome ? modelHomeProb : modelAwayProb) * 100;
    const chosenImplied = pickHome ? impHome : impAway;
    const chosenMlOdds = pickHome ? odds?.home_moneyline : odds?.away_moneyline;
    const valueDiff = chosenImplied != null ? chosenProb - chosenImplied : chosenProb - 50;
    const teamRest = pickHome ? homeRestDays : awayRestDays;
    const oppRest = pickHome ? awayRestDays : homeRestDays;
    const mlStatsText = `Prob. modelo ${chosenTeam.abbreviation}: ${chosenProb.toFixed(1)}% (${
      pickHome
        ? `${homeStanding?.wins ?? homeTeamAvg?.wins ?? 0}-${homeStanding?.losses ?? homeTeamAvg?.losses ?? 0}`
        : `${awayStanding?.wins ?? awayTeamAvg?.wins ?? 0}-${awayStanding?.losses ?? awayTeamAvg?.losses ?? 0}`
    })`;

    if (chosenProb >= 62) {
      const conf = clampConfidence(Math.min(86, chosenProb));
      const oddsPair = computePropOddsFromConfidence(conf, chosenMlOdds);
      recs.push({
        id: `team_ml_safe_${game.id}`,
        scope: 'team',
        strategy: 'safe',
        teamId: chosenTeam.id,
        projectedValue: Number(chosenProb.toFixed(1)),
        marketLabel: 'Ganador del Partido (ML) · Segura',
        subjectName: chosenTeam.short_name,
        teamAbbr: chosenTeam.abbreviation,
        statSummary: mlStatsText,
        marketLineText:
          chosenMlOdds != null
            ? `Cuota Casa ML: ${oddsPair.decimal.toFixed(2)}x (${formatAmericanOdds(chosenMlOdds)})`
            : `Favorito sólido (${chosenProb.toFixed(0)}% prob.) · Est. ${oddsPair.decimal.toFixed(2)}x`,
        lineValue: Number(chosenProb.toFixed(1)),
        pick: 'ML',
        pickLabel: `GANA ${chosenTeam.abbreviation}`,
        rationale: `${chosenTeam.short_name} supera el umbral de favorito sólido (≥62% prob. real de victoria).`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsPair.american,
        estimatedMultiplier: oddsPair.decimal,
        contextBadges: buildTeamRestBadges(
          teamRest,
          oppRest,
          pickHome ? 'Localía' : 'Visita',
          { label: `ML ${chosenProb.toFixed(0)}%`, tone: 'emerald' },
        ),
        restInfo: { teamRestDays: teamRest, oppRestDays: oppRest },
      });
    } else if (chosenProb >= 53 && (chosenImplied == null || valueDiff >= 2.5)) {
      const conf = clampConfidence(Math.min(65, chosenProb));
      const oddsPair = computePropOddsFromConfidence(conf, chosenMlOdds);
      recs.push({
        id: `team_ml_val_${game.id}`,
        scope: 'team',
        strategy: 'value',
        teamId: chosenTeam.id,
        projectedValue: Number(chosenProb.toFixed(1)),
        marketLabel: 'Ganador del Partido (ML)',
        subjectName: chosenTeam.short_name,
        teamAbbr: chosenTeam.abbreviation,
        statSummary: mlStatsText,
        marketLineText:
          chosenMlOdds != null
            ? `Cuota Casa ML: ${oddsPair.decimal.toFixed(2)}x (${formatAmericanOdds(chosenMlOdds)} · Implícita ${chosenImplied?.toFixed(0)}%)`
            : `Valor estadístico (${chosenProb.toFixed(0)}% prob.) · Est. ${oddsPair.decimal.toFixed(2)}x`,
        lineValue: Number(chosenProb.toFixed(1)),
        pick: 'ML',
        pickLabel: `GANA ${chosenTeam.abbreviation}`,
        rationale: `Ventaja en probabilidad estimada${
          chosenImplied != null ? ` (+${valueDiff.toFixed(1)}% vs implícita de la casa)` : ''
        } en duelo parejo.`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsPair.american,
        estimatedMultiplier: oddsPair.decimal,
        contextBadges: buildTeamRestBadges(teamRest, oppRest, pickHome ? 'Localía' : 'Visita'),
        restInfo: { teamRestDays: teamRest, oppRestDays: oppRest },
      });
    }
  }

  // 4. Total Puntos / Triples / Rebotes por Equipo (Calibrated Alt Safe & Filtered Value)
  const bookHomeSpread2 = odds?.home_spread != null ? Number(odds.home_spread) : null;
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
        bookOu != null && bookHomeSpread2 != null
          ? snapHalf((bookOu + bookHomeSpread2) / 2)
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
        bookOu != null && bookHomeSpread2 != null
          ? snapHalf((bookOu - bookHomeSpread2) / 2)
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
    const b2bTeamAdj = (s.teamRest === 0 ? -1.4 : 0) + (s.oppRest === 0 ? 1.0 : 0);
    const proj = seasonProj * 0.72 + recentProj * 0.28 + b2bTeamAdj;
    const anchoredTeamPts = bookOu != null && bookHomeSpread2 != null ? s.impliedTeamLine * 0.65 + proj * 0.35 : proj;

    // 4A. Safe Team Points (OVER anchor - 7.5, team SD = 11.0 pts)
    const safePtsLine = snapDownHalf(anchoredTeamPts - 7.5, 85.5);
    const pSafePts = Math.min(0.82, normalCdf((anchoredTeamPts - safePtsLine) / 11.0));
    if (pSafePts >= 0.7) {
      const conf = clampConfidence(pSafePts * 100);
      const ptsOdds = computePropOddsFromConfidence(conf);
      recs.push({
        id: `team_pts_safe_${s.team.id}`,
        scope: 'team',
        strategy: 'safe',
        teamId: s.team.id,
        projectedValue: Number(anchoredTeamPts.toFixed(1)),
        marketLabel: 'Total Puntos Equipo · Segura',
        subjectName: s.team.short_name,
        teamAbbr: s.team.abbreviation,
        statSummary: `Anota ${s.myPpg.toFixed(1)} PPG · Rival concede ${s.oppOppg.toFixed(1)} PPG`,
        marketLineText: `Línea Alt. Equipo: +${safePtsLine.toFixed(1)} PTS · Cuota ${ptsOdds.decimal.toFixed(2)}x`,
        lineValue: safePtsLine,
        pick: 'OVER',
        pickLabel: `OVER ${safePtsLine.toFixed(1)} PTS (${s.team.abbreviation})`,
        rationale: `Cruce ofensivo proyecta ~${anchoredTeamPts.toFixed(1)} pts (colchón de ${(anchoredTeamPts - safePtsLine).toFixed(1)} pts, prob. ${conf}%).`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: ptsOdds.american,
        estimatedMultiplier: ptsOdds.decimal,
        contextBadges: buildTeamRestBadges(s.teamRest, s.oppRest, s.role, {
          label: 'Línea Segura',
          tone: 'emerald',
        }),
        restInfo: { teamRestDays: s.teamRest, oppRestDays: s.oppRest },
      });
    }

    // 4B. Value Team Points (only when contextual B2B/rest edge reinforces the controlled projection gap)
    const edge = proj - s.impliedTeamLine;
    const hasRestEdge =
      (edge > 0 && s.oppRest === 0 && s.teamRest !== 0) ||
      (edge < 0 && s.teamRest === 0 && s.oppRest !== 0);
    if (hasRestEdge && Math.abs(edge) >= 3.0 && Math.abs(edge) <= 7.0) {
      const pick: 'OVER' | 'UNDER' = edge >= 0 ? 'OVER' : 'UNDER';
      const pVal = Math.min(0.64, normalCdf((Math.abs(edge) * 0.55) / 11.0));
      if (pVal >= 0.55) {
        const conf = clampConfidence(pVal * 100);
        const ptsOdds = computePropOddsFromConfidence(conf);
        recs.push({
          id: `team_pts_val_${s.team.id}`,
          scope: 'team',
          strategy: 'value',
          teamId: s.team.id,
          projectedValue: Number(proj.toFixed(1)),
          marketLabel: 'Total Puntos de Equipo',
          subjectName: s.team.short_name,
          teamAbbr: s.team.abbreviation,
          statSummary: `Anota ${s.myPpg.toFixed(1)} PPG · Rival recibe ${s.oppOppg.toFixed(1)}`,
          marketLineText: `Línea Equipo: ${s.impliedTeamLine.toFixed(1)} pts · Cuota ${ptsOdds.decimal.toFixed(2)}x`,
          lineValue: s.impliedTeamLine,
          pick,
          pickLabel: `${pick} ${s.impliedTeamLine.toFixed(1)} PTS (${s.team.abbreviation})`,
          rationale: `Proyección ofensiva de ${proj.toFixed(1)} pts (${edge >= 0 ? '+' : ''}${edge.toFixed(1)} vs línea implícita).`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: ptsOdds.american,
          estimatedMultiplier: ptsOdds.decimal,
          contextBadges: buildTeamRestBadges(s.teamRest, s.oppRest, s.role),
          restInfo: { teamRestDays: s.teamRest, oppRestDays: s.oppRest },
        });
      }
    }

    // 4C. Safe Team 3PM (Alt OVER average - 2.5, team 3PM SD = 3.3)
    if (s.teamAvg && Number(s.teamAvg.tpm_pg) >= 8.0) {
      const tpmAvg = Number(s.teamAvg.tpm_pg);
      const defAdjust = (s.oppOppg - 113.5) * 0.08;
      const b2b3pAdj = s.teamRest === 0 ? -0.35 : 0;
      const proj3p = tpmAvg + defAdjust + b2b3pAdj;
      const safe3pLine = snapDownHalf(proj3p - 2.5, 5.5);
      const pSafe3p = Math.min(0.81, normalCdf((proj3p - safe3pLine) / 3.3));
      if (pSafe3p >= 0.7) {
        const conf3p = clampConfidence(pSafe3p * 100);
        const tpmOdds = computePropOddsFromConfidence(conf3p);
        recs.push({
          id: `team_3pm_safe_${s.team.id}`,
          scope: 'team',
          strategy: 'safe',
          teamId: s.team.id,
          projectedValue: Number(proj3p.toFixed(1)),
          marketLabel: 'Triples del Equipo · Segura',
          subjectName: s.team.short_name,
          teamAbbr: s.team.abbreviation,
          statSummary: `Promedia ${tpmAvg.toFixed(1)} triples/PJ (${Number(s.teamAvg.tp_pct ?? 0).toFixed(1)}% 3P)`,
          marketLineText: `Línea Alt. 3PM: +${safe3pLine.toFixed(1)} · Cuota ${tpmOdds.decimal.toFixed(2)}x`,
          lineValue: safe3pLine,
          pick: 'OVER',
          pickLabel: `OVER ${safe3pLine.toFixed(1)} 3PM (${s.team.abbreviation})`,
          rationale: `Proyección de ${proj3p.toFixed(1)} triples con margen de ${(proj3p - safe3pLine).toFixed(1)} triples (prob. ${conf3p}%).`,
          confidence: conf3p,
          confidenceTier: getConfidenceTier(conf3p),
          estimatedOddsAmerican: tpmOdds.american,
          estimatedMultiplier: tpmOdds.decimal,
          contextBadges: buildTeamRestBadges(s.teamRest, s.oppRest, s.role, {
            label: 'Línea Segura',
            tone: 'emerald',
          }),
          restInfo: { teamRestDays: s.teamRest, oppRestDays: s.oppRest },
        });
      }
    }

    // 4D. Safe Team Rebounds (Alt OVER proj - 4.5, team REB SD = 5.6)
    if (s.teamAvg && Number(s.teamAvg.rpg) >= 36 && s.oppAvg) {
      const rebAvg = Number(s.teamAvg.rpg);
      const oppReb = Number(s.oppAvg.rpg);
      const oppMissFactor = s.oppAvg.fg_pct != null ? (46.8 - Number(s.oppAvg.fg_pct)) * 0.2 : 0;
      const rebDiff = (rebAvg - oppReb) * 0.12;
      const projReb = rebAvg + oppMissFactor + rebDiff;
      const safeRebLine = snapDownHalf(projReb - 4.5, 30.5);
      const pSafeReb = Math.min(0.81, normalCdf((projReb - safeRebLine) / 5.6));
      if (pSafeReb >= 0.7) {
        const confReb = clampConfidence(pSafeReb * 100);
        const rebOdds = computePropOddsFromConfidence(confReb);
        recs.push({
          id: `team_reb_safe_${s.team.id}`,
          scope: 'team',
          strategy: 'safe',
          teamId: s.team.id,
          projectedValue: Number(projReb.toFixed(1)),
          marketLabel: 'Rebotes del Equipo · Segura',
          subjectName: s.team.short_name,
          teamAbbr: s.team.abbreviation,
          statSummary: `Captura ${rebAvg.toFixed(1)} RPG (${Number(s.teamAvg.oreb_pg).toFixed(1)} of.) vs ${oppReb.toFixed(1)} rival`,
          marketLineText: `Línea Alt. REB: +${safeRebLine.toFixed(1)} · Cuota ${rebOdds.decimal.toFixed(2)}x`,
          lineValue: safeRebLine,
          pick: 'OVER',
          pickLabel: `OVER ${safeRebLine.toFixed(1)} REB (${s.team.abbreviation})`,
          rationale: `Proyección de ${projReb.toFixed(1)} rebotes con colchón de ${(projReb - safeRebLine).toFixed(1)} REB (prob. ${confReb}%).`,
          confidence: confReb,
          confidenceTier: getConfidenceTier(confReb),
          estimatedOddsAmerican: rebOdds.american,
          estimatedMultiplier: rebOdds.decimal,
          contextBadges: buildTeamRestBadges(s.teamRest, s.oppRest, s.role, {
            label: 'Línea Segura',
            tone: 'emerald',
          }),
          restInfo: { teamRestDays: s.teamRest, oppRestDays: s.oppRest },
        });
      }
    }
  }

  // 5. Player Props (Active Rotation + Empirical Variance + Safe vs Value Pools)
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
    const pLogs = logsByPlayer.get(p.player_id) ?? [];
    const isHomePlayer = p.team_id === game.home_team_id;
    const teamRecentGames = isHomePlayer ? homeRecentGames : awayRecentGames;
    const avail = checkPlayerAvailability({
      playerId: p.player_id,
      statusText: playerStatuses?.[p.player_id],
      playerLogs: pLogs,
      teamRecentGames,
      allLoggedGameIds,
      sport: 'nba',
    });
    if (!avail.available) continue;

    const oppTeamAvg = isHomePlayer ? awayTeamAvg : homeTeamAvg;
    const playerCtx = {
      isHome: isHomePlayer,
      teamRestDays: isHomePlayer ? homeRestDays : awayRestDays,
      oppRestDays: isHomePlayer ? awayRestDays : homeRestDays,
      questionable: avail.questionable,
      minLogsRequired: 5,
    };
    const candidateMetrics: PlayerChartMetric[] = ['pts', 'pra', 'reb', 'ast', 'tpm'];
    const pSafeRecs: PropRecommendation[] = [];
    const pValRecs: PropRecommendation[] = [];

    for (const mk of candidateMetrics) {
      const evaluated = evaluatePlayerPropMarkets(p, pLogs, mk, oppTeamAvg, playerCtx);
      for (const rec of evaluated) {
        if (avail.questionable) {
          rec.contextBadges.unshift({ label: avail.reason ?? 'Cuestionable', tone: 'amber' });
        }
        if (rec.strategy === 'safe') pSafeRecs.push(rec);
        else pValRecs.push(rec);
      }
    }

    // Pick top 1 safe prop per player within playable confidence window, favoring core stats when close
    if (pSafeRecs.length > 0) {
      const bestCore = selectPlayableSafeCandidate(
        pSafeRecs.filter((r) => r.metricKey !== 'tpm'),
      );
      const bestTpm = pSafeRecs.find((r) => r.metricKey === 'tpm');
      if (
        bestCore &&
        (!bestTpm || bestTpm.confidence > 83 || bestCore.confidence >= bestTpm.confidence - 5)
      ) {
        safePlayerPool.push(bestCore);
      } else {
        const picked = selectPlayableSafeCandidate(pSafeRecs);
        if (picked) safePlayerPool.push(picked);
      }
    }

    if (pValRecs.length > 0) {
      pValRecs.sort((a, b) => b.confidence - a.confidence);
      valuePlayerPool.push(pValRecs[0]);
    }
  }

  // Diversify safe player picks (max 3 3PT picks so PTS/PRA/REB/AST remain balanced, max 8 total)
  safePlayerPool.sort((a, b) => b.confidence - a.confidence);
  const pickedSafePlayers: PropRecommendation[] = [];
  let safeTpmCount = 0;
  for (const r of safePlayerPool) {
    if (pickedSafePlayers.length >= 8) break;
    if (r.metricKey === 'tpm') {
      if (safeTpmCount >= 3) continue;
      safeTpmCount += 1;
    }
    pickedSafePlayers.push(r);
  }
  recs.push(...pickedSafePlayers);

  valuePlayerPool.sort((a, b) => b.confidence - a.confidence);
  recs.push(...valuePlayerPool.slice(0, 6));

  // Default order: MAYOR A MENOR CONFIANZA
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

  if (prop.id.startsWith('team_pts_')) {
    const targetTeamId =
      prop.teamId ?? Number(prop.id.replace(/^team_pts_(?:safe_|val_)?/, ''));
    if (targetTeamId === game.away_team_id) {
      return gradeOverUnder(
        game.away_score,
        prop.lineValue,
        prop.pick === 'UNDER' ? 'UNDER' : 'OVER',
        'PTS',
      );
    }
    if (targetTeamId === game.home_team_id) {
      return gradeOverUnder(
        game.home_score,
        prop.lineValue,
        prop.pick === 'UNDER' ? 'UNDER' : 'OVER',
        'PTS',
      );
    }
  }

  if (prop.id.startsWith('team_spread_')) {
    const isHome = prop.teamId != null ? prop.teamId === game.home_team_id : prop.teamAbbr === game.home_team.abbreviation;
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
    const isHome = prop.teamId != null ? prop.teamId === game.home_team_id : prop.teamAbbr === game.home_team.abbreviation;
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
    const teamId =
      prop.teamId ?? Number(prop.id.replace(/^team_(?:3pm|reb)_(?:safe_|val_)?/, ''));
    const teamRows = boxStats.filter((r) => r.team_id === teamId);
    if (teamRows.length === 0) return isFinal ? null : { label: 'EN VIVO', state: 'live' };
    const val = prop.id.startsWith('team_3pm_')
      ? teamRows.reduce((s, r) => s + r.tpm, 0)
      : teamRows.reduce((s, r) => s + r.reb, 0);
    return gradeOverUnder(val, prop.lineValue, prop.pick === 'UNDER' ? 'UNDER' : 'OVER', '');
  }

  return null;
}

export interface EvaluatedPropEntry {
  prop: PropRecommendation;
  status: PropLiveStatus | null;
}

export interface GamePropsEffectivenessSummary {
  totalProps: number;
  wonCount: number;
  lostCount: number;
  pushCount: number;
  dnpCount: number;
  pendingCount: number;
  evaluatedCount: number;
  effectivenessPct: number | null;
  teamWon: number;
  teamEvaluated: number;
  teamEffectivenessPct: number | null;
  playerWon: number;
  playerEvaluated: number;
  playerEffectivenessPct: number | null;
  entries: EvaluatedPropEntry[];
  wonEntries: EvaluatedPropEntry[];
  lostEntries: EvaluatedPropEntry[];
}

export function computeEffectivenessFromCounts(
  props: PropRecommendation[],
  resolveStatus: (prop: PropRecommendation) => PropLiveStatus | null,
): GamePropsEffectivenessSummary {
  const entries: EvaluatedPropEntry[] = props.map((prop) => ({
    prop,
    status: resolveStatus(prop),
  }));

  const wonEntries: EvaluatedPropEntry[] = [];
  const lostEntries: EvaluatedPropEntry[] = [];
  let pushCount = 0;
  let dnpCount = 0;
  let pendingCount = 0;
  let teamWon = 0;
  let teamEvaluated = 0;
  let playerWon = 0;
  let playerEvaluated = 0;

  for (const entry of entries) {
    const st = entry.status?.state;
    if (st === 'won') {
      wonEntries.push(entry);
      if (entry.prop.scope === 'team') {
        teamWon += 1;
        teamEvaluated += 1;
      } else {
        playerWon += 1;
        playerEvaluated += 1;
      }
    } else if (st === 'lost') {
      lostEntries.push(entry);
      if (entry.prop.scope === 'team') teamEvaluated += 1;
      else playerEvaluated += 1;
    } else if (st === 'push') {
      pushCount += 1;
    } else if (st === 'dnp') {
      dnpCount += 1;
    } else {
      pendingCount += 1;
    }
  }

  const wonCount = wonEntries.length;
  const lostCount = lostEntries.length;
  const evaluatedCount = wonCount + lostCount;

  return {
    totalProps: props.length,
    wonCount,
    lostCount,
    pushCount,
    dnpCount,
    pendingCount,
    evaluatedCount,
    effectivenessPct: evaluatedCount > 0 ? Math.round((wonCount / evaluatedCount) * 100) : null,
    teamWon,
    teamEvaluated,
    teamEffectivenessPct: teamEvaluated > 0 ? Math.round((teamWon / teamEvaluated) * 100) : null,
    playerWon,
    playerEvaluated,
    playerEffectivenessPct:
      playerEvaluated > 0 ? Math.round((playerWon / playerEvaluated) * 100) : null,
    entries,
    wonEntries,
    lostEntries,
  };
}
