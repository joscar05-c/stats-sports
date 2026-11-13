import type { Game, PlayerGameStat, PlayerSeasonAverage, TeamStanding } from '../types/database';

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

export interface MatchupBettingInsight {
  expectedTotalSeason: number | null;
  expectedTotalRecent: number | null;
  totalEdge: number | null;
  projectedHomeMargin: number | null;
  spreadEdgeHome: number | null;
  movements: string[];
  signals: Array<{ title: string; detail: string; tone: 'over' | 'under' | 'neutral' | 'home' | 'away' }>;
}

export function buildMatchupBettingInsight(
  game: Game,
  homeStanding: TeamStanding | null,
  awayStanding: TeamStanding | null,
  homeRecent: TeamRecentSummary,
  awayRecent: TeamRecentSummary,
): MatchupBettingInsight {
  const odds = game.odds;

  // Expected game total using offensive & defensive season averages
  let expectedTotalSeason: number | null = null;
  if (
    homeStanding?.ppg != null &&
    homeStanding?.oppg != null &&
    awayStanding?.ppg != null &&
    awayStanding?.oppg != null
  ) {
    const homeProj = (Number(homeStanding.ppg) + Number(awayStanding.oppg)) / 2;
    const awayProj = (Number(awayStanding.ppg) + Number(homeStanding.oppg)) / 2;
    expectedTotalSeason = Number((homeProj + awayProj).toFixed(1));
  }

  let expectedTotalRecent: number | null = null;
  if (homeRecent.gamesCount > 0 && awayRecent.gamesCount > 0) {
    const homeProj = (homeRecent.avgFor + awayRecent.avgAgainst) / 2;
    const awayProj = (awayRecent.avgFor + homeRecent.avgAgainst) / 2;
    expectedTotalRecent = Number((homeProj + awayProj).toFixed(1));
  }

  const refTotal = expectedTotalRecent ?? expectedTotalSeason;
  const totalEdge =
    odds?.over_under != null && refTotal != null
      ? Number((refTotal - odds.over_under).toFixed(1))
      : null;

  // Projected home margin using season differential (+2.2 pts standard NBA home court)
  let projectedHomeMargin: number | null = null;
  if (homeStanding?.diff != null && awayStanding?.diff != null) {
    projectedHomeMargin = Number(((Number(homeStanding.diff) - Number(awayStanding.diff)) / 2 + 2.2).toFixed(1));
  } else if (homeRecent.gamesCount > 0 && awayRecent.gamesCount > 0) {
    projectedHomeMargin = Number(((homeRecent.avgMargin - awayRecent.avgMargin) / 2 + 2.2).toFixed(1));
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

  return {
    expectedTotalSeason,
    expectedTotalRecent,
    totalEdge,
    projectedHomeMargin,
    spreadEdgeHome,
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
