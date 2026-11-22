import type {
  FootballPlayerSeasonAverage,
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
  computeTeamRestDays,
  evaluatePropStatus,
  getConfidenceTier,
  poissonAtLeast,
  selectPlayableSafeCandidate,
  smoothEmpiricalRate,
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
  playerStatuses?: Record<number, string>;
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
  return Math.max(51, Math.min(91, Math.round(val)));
}

export function buildFootballPropsRecommendations(
  input: FootballPropContextInput,
): PropRecommendation[] {
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
  } = input;
  const recs: PropRecommendation[] = [];

  const totalLine = game.odds?.over_under ?? 2.5;
  const homeGfSeason =
    homeTeamAvg?.gf_pg ?? (homeStanding?.ppg != null ? Number(homeStanding.ppg) : null) ?? (homeRecent.gamesCount > 0 ? homeRecent.avgFor : null);
  const homeGaSeason =
    homeTeamAvg?.ga_pg ?? (homeStanding?.oppg != null ? Number(homeStanding.oppg) : null) ?? (homeRecent.gamesCount > 0 ? homeRecent.avgAgainst : null);
  const awayGfSeason =
    awayTeamAvg?.gf_pg ?? (awayStanding?.ppg != null ? Number(awayStanding.ppg) : null) ?? (awayRecent.gamesCount > 0 ? awayRecent.avgFor : null);
  const awayGaSeason =
    awayTeamAvg?.ga_pg ?? (awayStanding?.oppg != null ? Number(awayStanding.oppg) : null) ?? (awayRecent.gamesCount > 0 ? awayRecent.avgAgainst : null);

  if (homeGfSeason != null && homeGaSeason != null && awayGfSeason != null && awayGaSeason != null) {
    const homeGf =
      homeRecent.gamesCount >= 3 ? homeGfSeason * 0.72 + homeRecent.avgFor * 0.28 : homeGfSeason;
    const homeGa =
      homeRecent.gamesCount >= 3 ? homeGaSeason * 0.72 + homeRecent.avgAgainst * 0.28 : homeGaSeason;
    const awayGf =
      awayRecent.gamesCount >= 3 ? awayGfSeason * 0.72 + awayRecent.avgFor * 0.28 : awayGfSeason;
    const awayGa =
      awayRecent.gamesCount >= 3 ? awayGaSeason * 0.72 + awayRecent.avgAgainst * 0.28 : awayGaSeason;

    const poisson = computePoissonMatchOutcome(
      ((homeGf + awayGa) / 2) * 1.07,
      ((awayGf + homeGa) / 2) * 0.93,
      game.odds,
    );

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

    // 2. ML (1X2) — Safe si >= 62%, Value si ventaja >= 4% vs cuota
    const bestMlHome = poisson.pHome >= poisson.pAway;
    const mlProb = bestMlHome ? poisson.pHome : poisson.pAway;
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
    } else if (mlImplied != null && mlProb * 100 - mlImplied >= 4 && mlProb >= 0.48) {
      const conf = clampConf(Math.min(64, mlProb * 100));
      const oddsVal = computePropOddsFromConfidence(conf, mlBookOdds);
      recs.push({
        id: `fb_ml_val_${game.id}`,
        scope: 'team',
        strategy: 'value',
        teamId: mlTeam.id,
        projectedValue: Number((mlProb * 100).toFixed(1)),
        marketLabel: 'Ganador 1X2 (Valor)',
        subjectName: mlTeam.short_name,
        teamAbbr: mlTeam.abbreviation,
        statSummary: `Poisson ${Math.round(mlProb * 100)}% vs implícita casa ${Math.round(mlImplied)}%`,
        marketLineText: `Cuota 1X2: ${oddsVal.decimal.toFixed(2)}x`,
        lineValue: Number((mlProb * 100).toFixed(1)),
        pick: 'ML',
        pickLabel: `Gana ${mlTeam.abbreviation}`,
        rationale: `Modelo proyecta +${(mlProb * 100 - mlImplied).toFixed(1)}% de valor frente a la cuota de victoria directa.`,
        confidence: conf,
        confidenceTier: getConfidenceTier(conf),
        estimatedOddsAmerican: oddsVal.american,
        estimatedMultiplier: oddsVal.decimal,
        contextBadges: [{ label: 'Valor Cuota', tone: 'cyan' }],
      });
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
        projectedValue: Number(poisson.lambdaTotal.toFixed(2)),
        marketLabel: 'Total Goles · Segura',
        subjectName: `${game.away_team.short_name} vs ${game.home_team.short_name}`,
        teamAbbr: `${game.away_team.abbreviation}/${game.home_team.abbreviation}`,
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
        projectedValue: Number(poisson.lambdaTotal.toFixed(2)),
        marketLabel: 'Total Goles del Partido',
        subjectName: `${game.away_team.short_name} vs ${game.home_team.short_name}`,
        teamAbbr: `${game.away_team.abbreviation}/${game.home_team.abbreviation}`,
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

    // 4. Ambos Equipos Anotan (BTTS) calibrado con Poisson (65%) + reciente (35%)
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
  }

  // 5. Player Props (Poisson + Titulares Regulares: starts/gp >= 0.60, gp >= 4)
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

    const oppGa = isHome
      ? awayTeamAvg?.ga_pg ?? (awayRecent.gamesCount > 0 ? awayRecent.avgAgainst : null)
      : homeTeamAvg?.ga_pg ?? (homeRecent.gamesCount > 0 ? homeRecent.avgAgainst : null);
    const oppMod = oppGa != null ? Math.max(0.86, Math.min(1.16, 1 + (oppGa - 1.35) * 0.14)) : 1.0;

    const pLogs = pAllLogs.slice(0, 10);
    const playerSafeCandidates: PropRecommendation[] = [];
    const playerValueCandidates: PropRecommendation[] = [];

    // 5A. Remates Totales (escalado descendente [2.5, 1.5, 0.5] para evitar cuotas triviales 1.06x)
    if (p.shots_pg >= 1.15) {
      const recentShots = pLogs.map((l) => getFootballPlayerStatValue(l, 'shots'));
      const recentAvg =
        recentShots.length > 0 ? recentShots.reduce((a, b) => a + b, 0) / recentShots.length : p.shots_pg;
      const lambdaShots = Math.max(
        0.4,
        (recentShots.length >= 3 ? p.shots_pg * 0.72 + recentAvg * 0.28 : p.shots_pg) * oppMod,
      );

      const blendShotCalProb = (pPois: number, empHits: number): number => {
        const smoothed = smoothEmpiricalRate(empHits, recentShots.length, pPois);
        if (recentShots.length >= 5 && startsRatio >= 0.65) {
          return 0.45 * pPois + 0.55 * smoothed;
        }
        return recentShots.length >= 4 ? 0.65 * pPois + 0.35 * smoothed : pPois;
      };

      let chosenSafeShotLine: number | null = null;
      if (!avail.questionable) {
        let chosenShot: {
          line: number;
          pCal: number;
          empHits: number;
          empRate: number;
        } | null = null;

        // Check +2.5 and +1.5 first
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
          const pCal = Math.min(0.88, blendShotCalProb(pPois, empHits));
          if (pCal >= c.minCal && (recentShots.length < 4 || empRate >= c.minEmp)) {
            chosenShot = { line: c.line, pCal, empHits, empRate };
            break;
          }
        }

        // Fall back to +0.5 only for moderate volume shooters (1.15-1.85) or when +1.5 failed 60% empirical, and avoid >83% (1.06x)
        if (!chosenShot && (p.shots_pg < 1.85 || (recentShots.length >= 4 && empRate15 < 0.6))) {
          const pPois05 = poissonAtLeast(lambdaShots, 1);
          const empHits05 = recentShots.filter((v) => v >= 1).length;
          const empRate05 = recentShots.length > 0 ? empHits05 / recentShots.length : pPois05;
          const pCal05 = Math.min(0.83, blendShotCalProb(pPois05, empHits05));
          if (pCal05 >= 0.68 && (recentShots.length < 4 || empRate05 >= 0.64)) {
            chosenShot = { line: 0.5, pCal: pCal05, empHits: empHits05, empRate: empRate05 };
          }
        }

        if (chosenShot) {
          chosenSafeShotLine = chosenShot.line;
          const conf = clampConf(chosenShot.pCal * 100);
          const oddsVal = computePropOddsFromConfidence(conf);
          playerSafeCandidates.push({
            id: `fb_shots_${p.player_id}_safe`,
            scope: 'player',
            strategy: 'safe',
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
            rationale: `Poisson λ=${lambdaShots.toFixed(2)} remates y titularidad regular (${p.starts}/${p.gp} inicios) dan ${conf}% de acierto para +${chosenShot.line} REM.`,
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

      // VALUE Shots (step above Safe line when Safe already took 1.5 or 0.5 to avoid duplicate line)
      let valLine = p.shots_pg >= 2.6 ? 2.5 : 1.5;
      if (chosenSafeShotLine === 2.5) valLine = 3.5;
      else if (chosenSafeShotLine === 1.5) valLine = 2.5;
      else if (chosenSafeShotLine === 0.5) valLine = 1.5;
      const valK = Math.ceil(valLine);
      const pPoisVal = poissonAtLeast(lambdaShots, valK);
      const valHits = recentShots.filter((v) => v >= valK).length;
      const valEmpRate = recentShots.length > 0 ? valHits / recentShots.length : pPoisVal;
      const smoothedValEmp = smoothEmpiricalRate(valHits, recentShots.length, pPoisVal);
      const pCalVal = Math.min(
        0.72,
        recentShots.length >= 4 ? 0.6 * pPoisVal + 0.4 * smoothedValEmp : pPoisVal,
      );
      if (pCalVal >= 0.56 && (recentShots.length < 4 || valEmpRate >= 0.5)) {
        const conf = clampConf(pCalVal * 100);
        const oddsVal = computePropOddsFromConfidence(conf);
        playerValueCandidates.push({
          id: `fb_shots_${p.player_id}_val`,
          scope: 'player',
          strategy: 'value',
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

    // 5B. Remates al Arco (evaluar +1.5 primero para delanteros élite, luego +0.5)
    if (p.sot_pg >= 0.85 && !avail.questionable) {
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
      let chosenSot: { line: number; pCal: number; empHits: number } | null = null;
      for (const c of sotCandidates) {
        if (p.sot_pg < c.minPg) continue;
        const pPois = poissonAtLeast(lambdaSot, c.targetK);
        const empHits = recentSot.filter((v) => v >= c.targetK).length;
        const empRate = recentSot.length > 0 ? empHits / recentSot.length : pPois;
        const smoothed = smoothEmpiricalRate(empHits, recentSot.length, pPois);
        const pCal = Math.min(
          0.84,
          recentSot.length >= 5 && startsRatio >= 0.65
            ? 0.48 * pPois + 0.52 * smoothed
            : recentSot.length >= 4
              ? 0.65 * pPois + 0.35 * smoothed
              : pPois,
        );
        if (pCal >= c.minCal && (recentSot.length < 4 || empRate >= c.minEmp)) {
          chosenSot = { line: c.line, pCal, empHits };
          break;
        }
      }

      if (chosenSot) {
        const conf = clampConf(chosenSot.pCal * 100);
        const oddsVal = computePropOddsFromConfidence(conf);
        playerSafeCandidates.push({
          id: `fb_sot_${p.player_id}_safe`,
          scope: 'player',
          strategy: 'safe',
          projectedValue: Number(lambdaSot.toFixed(2)),
          marketLabel: 'Remates al Arco · Segura',
          subjectName: p.full_name,
          teamAbbr,
          playerId: p.player_id,
          footballMetricKey: 'sot',
          statSummary: `${p.sot_pg.toFixed(2)} SOT/PJ (${p.starts}/${p.gp} tit.) · Cumplió ${chosenSot.empHits}/${recentSot.length || p.gp}`,
          marketLineText: `Línea Segura: +${chosenSot.line} Al Arco · Cuota ${oddsVal.decimal.toFixed(2)}x`,
          lineValue: chosenSot.line,
          pick: 'OVER',
          pickLabel: `+${chosenSot.line} Remates al Arco`,
          rationale: `Frecuencia al arco λ=${lambdaSot.toFixed(2)} proyecta ${conf}% de probabilidad de al menos ${Math.ceil(chosenSot.line)} remate${chosenSot.line > 1 ? 's' : ''} entre los 3 palos.`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [
            { label: 'Línea Segura', tone: 'emerald' },
            { label: `${p.sot_pg.toFixed(2)} SOT/PJ`, tone: 'cyan' },
          ],
        });
      }
    }

    // 5C. Anotador en el Partido (SOLO Valor cuando goals_pg >= 0.65 && sot_pg >= 1.25)
    if (p.goals_pg >= 0.65 && p.sot_pg >= 1.25 && startsRatio >= 0.65) {
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
      const pCal = Math.min(0.62, recentGoals.length >= 4 ? 0.75 * pPoisGoal + 0.25 * empRate : pPoisGoal);
      if (pCal >= 0.5) {
        const conf = clampConf(pCal * 100);
        const oddsVal = computePropOddsFromConfidence(conf);
        playerValueCandidates.push({
          id: `fb_goals_${p.player_id}_val`,
          scope: 'player',
          strategy: 'value',
          projectedValue: Number(lambdaGoals.toFixed(2)),
          marketLabel: 'Anotador en el Partido',
          subjectName: p.full_name,
          teamAbbr,
          playerId: p.player_id,
          footballMetricKey: 'goals',
          statSummary: `${p.goals} goles en ${p.gp} PJ (${p.goals_pg.toFixed(2)} G/PJ · ${p.sot_pg.toFixed(1)} SOT/PJ)`,
          marketLineText: `O/U 0.5 Goles · Cuota ${oddsVal.decimal.toFixed(2)}x`,
          lineValue: 0.5,
          pick: 'OVER',
          pickLabel: 'Marca Gol (+0.5)',
          rationale: `Goleador élite (${p.goals_pg.toFixed(2)} G/PJ) con ${conf}% de probabilidad Poisson calibrada.`,
          confidence: conf,
          confidenceTier: getConfidenceTier(conf),
          estimatedOddsAmerican: oddsVal.american,
          estimatedMultiplier: oddsVal.decimal,
          contextBadges: [{ label: `${p.goals} Goles`, tone: 'emerald' }],
        });
      }
    }

    if (playerSafeCandidates.length > 0) {
      const pickedSafe = selectPlayableSafeCandidate(playerSafeCandidates);
      if (pickedSafe) safePlayerPool.push(pickedSafe);
    }
    if (playerValueCandidates.length > 0) {
      playerValueCandidates.sort((a, b) => b.confidence - a.confidence);
      valuePlayerPool.push(playerValueCandidates[0]);
    }
  }

  safePlayerPool.sort((a, b) => b.confidence - a.confidence);
  valuePlayerPool.sort((a, b) => b.confidence - a.confidence);
  recs.push(...safePlayerPool.slice(0, 6), ...valuePlayerPool.slice(0, 5));

  return recs.sort((a, b) => b.confidence - a.confidence);
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

  if (prop.id.startsWith('fb_ml_') || prop.pick === 'ML') {
    const isHome =
      prop.teamId != null
        ? prop.teamId === game.home_team_id
        : prop.teamAbbr === game.home_team.abbreviation;
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
