import type {
  FootballPlayerSeasonAverage,
  FootballTeamSeasonAverage,
  Game,
  PlayerGameStat,
  TeamStanding,
} from '../types/database';
import {
  americanToImpliedProb,
  computeEffectivenessFromCounts,
  computePropOddsFromConfidence,
  computeTeamRestDays,
  evaluatePropStatus,
  getConfidenceTier,
  type GamePropsEffectivenessSummary,
  type MatchupBettingInsight,
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
}

export function getFootballPlayerStatValue(
  row: PlayerGameStat,
  metric: 'goals' | 'shots' | 'sot' | 'assists',
): number {
  const ss = row.sport_stats;
  switch (metric) {
    case 'goals':
      return Number(ss?.goals ?? row.pts ?? 0);
    case 'assists':
      return Number(ss?.assists ?? row.ast ?? 0);
    case 'shots':
      return Number(ss?.shots ?? 0);
    case 'sot':
      return Number(ss?.shots_on_target ?? 0);
  }
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

function computeBttsRate(_teamId: number, games: Game[]): { hits: number; tracked: number; rate: number } {
  const finals = games.filter((g) => g.status === 'final');
  if (finals.length === 0) return { hits: 0, tracked: 0, rate: 0 };
  const hits = finals.filter((g) => g.home_score > 0 && g.away_score > 0).length;
  return { hits, tracked: finals.length, rate: hits / finals.length };
}

function clampConf(val: number): number {
  return Math.max(52, Math.min(91, Math.round(val)));
}

export function buildFootballPropsRecommendations(
  input: FootballPropContextInput,
): PropRecommendation[] {
  const { game, homeTeamAvg, awayTeamAvg, homeRecent, awayRecent, homeRecentGames, awayRecentGames, keyPlayers, playerRecentLogs } = input;
  const recs: PropRecommendation[] = [];

  const totalLine = game.odds?.over_under ?? 2.5;
  const homeGf = homeTeamAvg?.gf_pg ?? (homeRecent.gamesCount > 0 ? homeRecent.avgFor : null);
  const homeGa = homeTeamAvg?.ga_pg ?? (homeRecent.gamesCount > 0 ? homeRecent.avgAgainst : null);
  const awayGf = awayTeamAvg?.gf_pg ?? (awayRecent.gamesCount > 0 ? awayRecent.avgFor : null);
  const awayGa = awayTeamAvg?.ga_pg ?? (awayRecent.gamesCount > 0 ? awayRecent.avgAgainst : null);

  if (homeGf != null && homeGa != null && awayGf != null && awayGa != null) {
    const projTotal = Number((((homeGf + awayGa) / 2) + ((awayGf + homeGa) / 2)).toFixed(2));
    const edge = projTotal - totalLine;
    if (Math.abs(edge) >= 0.25) {
      const isOver = edge > 0;
      const conf = clampConf(56 + Math.abs(edge) * 14);
      const bookOdds = isOver ? game.odds?.over_odds : game.odds?.under_odds;
      const oddsVal = computePropOddsFromConfidence(conf, bookOdds);
      recs.push({
        id: `fb_total_${game.id}`,
        scope: 'team',
        marketLabel: 'Total Goles del Partido',
        subjectName: `${game.away_team.short_name} vs ${game.home_team.short_name}`,
        teamAbbr: `${game.away_team.abbreviation}/${game.home_team.abbreviation}`,
        statSummary: `Proy. ${projTotal.toFixed(2)} goles · Local ${homeGf.toFixed(2)} GF / Visita ${awayGf.toFixed(2)} GF`,
        marketLineText: `O/U ${totalLine}`,
        lineValue: totalLine,
        pick: isOver ? 'OVER' : 'UNDER',
        pickLabel: `${isOver ? 'Más de' : 'Menos de'} ${totalLine} goles`,
        rationale: isOver
          ? `Ataques combinados proyectan ${projTotal.toFixed(2)} goles frente a una línea de ${totalLine}.`
          : `Solidez defensiva de ambos equipos proyecta ${projTotal.toFixed(2)} goles totales.`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [
          { label: `Proy ${projTotal.toFixed(2)} G`, tone: isOver ? 'emerald' : 'cyan' },
        ],
      });
    }

    const homeBtts = computeBttsRate(game.home_team_id, homeRecentGames);
    const awayBtts = computeBttsRate(game.away_team_id, awayRecentGames);
    if (homeBtts.tracked >= 3 && awayBtts.tracked >= 3) {
      const bttsPct = ((homeBtts.rate + awayBtts.rate) / 2) * 100;
      const bttsYes = bttsPct >= 56;
      const bttsNo = bttsPct <= 40;
      if (bttsYes || bttsNo) {
        const conf = clampConf(bttsYes ? 54 + (bttsPct - 50) * 0.55 : 54 + (50 - bttsPct) * 0.55);
        const oddsVal = computePropOddsFromConfidence(conf);
        recs.push({
          id: `fb_btts_${game.id}`,
          scope: 'team',
          marketLabel: 'Ambos Equipos Anotan (BTTS)',
          subjectName: `${game.away_team.abbreviation} @ ${game.home_team.abbreviation}`,
          teamAbbr: 'BTTS',
          statSummary: `BTTS reciente: ${game.home_team.abbreviation} ${homeBtts.hits}/${homeBtts.tracked} · ${game.away_team.abbreviation} ${awayBtts.hits}/${awayBtts.tracked}`,
          marketLineText: 'Sí / No',
          lineValue: 0.5,
          pick: bttsYes ? 'OVER' : 'UNDER',
          pickLabel: bttsYes ? 'Ambos Anotan: SÍ' : 'Ambos Anotan: NO',
          rationale: bttsYes
            ? `Frecuencia combinada de goles mutuos de ${Math.round(bttsPct)}% en partidos recientes.`
            : `Tendencia de portería a cero: solo ${Math.round(bttsPct)}% con goles de ambos conjuntos.`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [{ label: `BTTS ${Math.round(bttsPct)}%`, tone: bttsYes ? 'emerald' : 'amber' }],
        });
      }
    }
  }

  // Player props: Remates totales, Remates al arco, Goles
  const logsByPlayer = new Map<number, PlayerGameStat[]>();
  for (const log of playerRecentLogs) {
    const arr = logsByPlayer.get(log.player_id) ?? [];
    arr.push(log);
    logsByPlayer.set(log.player_id, arr);
  }

  for (const p of keyPlayers) {
    if (p.gp < 3) continue;
    const teamAbbr =
      p.team_id === game.home_team_id
        ? game.home_team.abbreviation
        : game.away_team.abbreviation;
    const pLogs = (logsByPlayer.get(p.player_id) ?? []).slice(0, 6);

    if (p.shots_pg >= 1.8) {
      const line = p.shots_pg >= 2.6 ? 2.5 : 1.5;
      const recentVals = pLogs.map((l) => getFootballPlayerStatValue(l, 'shots'));
      const recentAvg =
        recentVals.length > 0
          ? recentVals.reduce((a, b) => a + b, 0) / recentVals.length
          : p.shots_pg;
      const blend = p.shots_pg * 0.45 + recentAvg * 0.55;
      const edge = blend - line;
      if (Math.abs(edge) >= 0.25) {
        const isOver = edge > 0;
        const hits = recentVals.filter((v) => (isOver ? v > line : v < line)).length;
        const conf = clampConf(56 + Math.abs(edge) * 14 + (recentVals.length >= 4 ? (hits / recentVals.length) * 10 : 0));
        const oddsVal = computePropOddsFromConfidence(conf);
        recs.push({
          id: `fb_shots_${p.player_id}`,
          scope: 'player',
          marketLabel: 'Remates Totales',
          subjectName: p.full_name,
          teamAbbr,
          playerId: p.player_id,
          footballMetricKey: 'shots',
          statSummary: `${p.shots_pg.toFixed(1)} REM/PJ (${p.gp} PJ) · Reciente ${recentAvg.toFixed(1)}`,
          marketLineText: `O/U ${line} REM`,
          lineValue: line,
          pick: isOver ? 'OVER' : 'UNDER',
          pickLabel: `${isOver ? 'Más de' : 'Menos de'} ${line} Remates`,
          rationale: `${p.full_name} promedia ${p.shots_pg.toFixed(1)} remates en temporada (${hits}/${recentVals.length || p.gp} aciertos recientes).`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [{ label: `${p.shots_pg.toFixed(1)} REM/PJ`, tone: 'slate' }],
        });
      }
    }

    if (p.sot_pg >= 0.85) {
      const line = 0.5;
      const recentVals = pLogs.map((l) => getFootballPlayerStatValue(l, 'sot'));
      const recentAvg =
        recentVals.length > 0
          ? recentVals.reduce((a, b) => a + b, 0) / recentVals.length
          : p.sot_pg;
      const blend = p.sot_pg * 0.45 + recentAvg * 0.55;
      if (blend >= 0.85) {
        const hits = recentVals.filter((v) => v >= 1).length;
        const conf = clampConf(58 + (blend - 0.5) * 18 + (recentVals.length >= 3 ? (hits / recentVals.length) * 10 : 0));
        const oddsVal = computePropOddsFromConfidence(conf);
        recs.push({
          id: `fb_sot_${p.player_id}`,
          scope: 'player',
          marketLabel: 'Remates al Arco',
          subjectName: p.full_name,
          teamAbbr,
          playerId: p.player_id,
          footballMetricKey: 'sot',
          statSummary: `${p.sot_pg.toFixed(2)} Al Arco/PJ · ${p.goals} G en ${p.gp} PJ`,
          marketLineText: `O/U ${line} Al Arco`,
          lineValue: line,
          pick: 'OVER',
          pickLabel: '+0.5 Remates al Arco',
          rationale: `Alta frecuencia de tiro entre los 3 palos (${p.sot_pg.toFixed(2)}/PJ).`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [{ label: `${p.sot_pg.toFixed(2)} SOT/PJ`, tone: 'emerald' }],
        });
      }
    }

    if (p.goals_pg >= 0.45) {
      const line = 0.5;
      const recentVals = pLogs.map((l) => getFootballPlayerStatValue(l, 'goals'));
      const hits = recentVals.filter((v) => v >= 1).length;
      const conf = clampConf(55 + p.goals_pg * 22 + (recentVals.length >= 3 ? (hits / recentVals.length) * 10 : 0));
      const oddsVal = computePropOddsFromConfidence(conf);
      recs.push({
        id: `fb_goals_${p.player_id}`,
        scope: 'player',
        marketLabel: 'Anotador en el Partido',
        subjectName: p.full_name,
        teamAbbr,
        playerId: p.player_id,
        footballMetricKey: 'goals',
        statSummary: `${p.goals} goles en ${p.gp} PJ (${p.goals_pg.toFixed(2)} G/PJ)`,
        marketLineText: 'O/U 0.5 Goles',
        lineValue: line,
        pick: 'OVER',
        pickLabel: 'Marca Gol (+0.5)',
        rationale: `${p.full_name} registra ${p.goals} tantos esta campaña (${p.shots_pg.toFixed(1)} remates/PJ).`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [{ label: `${p.goals} Goles`, tone: 'emerald' }],
      });
    }
  }

  return recs.sort((a, b) => b.confidence - a.confidence).slice(0, 14);
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

  if (prop.id.startsWith('fb_total_')) {
    const totalGoals = game.away_score + game.home_score;
    return gradeOverUnder(totalGoals, prop.lineValue, prop.pick === 'UNDER' ? 'UNDER' : 'OVER', 'G');
  }

  if (prop.id.startsWith('fb_btts_')) {
    const bothScored = game.home_score > 0 && game.away_score > 0;
    const isYesPick = prop.pick !== 'UNDER';
    const scoreStr = `${game.away_score}-${game.home_score}`;
    if (!isFinal) {
      if (isYesPick && bothScored) {
        return { label: `CUMPLIÓ · ${scoreStr}`, state: 'won' };
      }
      return { label: `EN VIVO · ${scoreStr}`, state: 'live' };
    }
    const won = isYesPick ? bothScored : !bothScored;
    return {
      label: `${won ? 'SALIÓ' : 'NO SALIÓ'} · ${scoreStr}`,
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
