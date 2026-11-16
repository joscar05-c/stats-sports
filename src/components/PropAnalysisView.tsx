import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Lock,
  Minus,
  Plus,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
} from 'lucide-react';
import {
  fetchGameBoxScore,
  fetchGameById,
  fetchPlayerProfileAndLogs,
  type GameBettingContext,
} from '../services/basketballApi';
import { supabase } from '../lib/supabase';
import {
  americanToImpliedProb,
  buildGamePropsRecommendations,
  buildMatchupBettingInsight,
  getConfidenceTier,
  isHighProbabilityProp,
  PLAYER_CHART_METRICS,
  PRO_CONFIDENCE_THRESHOLD,
  summarizeTeamRecent,
  type PropRecommendation,
} from '../utils/betting';
import type { Game, Player, PlayerGameStat, PlayerSeasonAverage, TeamSeasonAverage } from '../types/database';

interface PropAnalysisViewProps {
  game: Game;
  prop: PropRecommendation;
  context: GameBettingContext;
  isPro: boolean;
  onBack: () => void;
  onSelectProp: (prop: PropRecommendation) => void;
  onOpenGameModal: (game: Game) => void;
  onOpenPlayerModal: (playerId: number) => void;
  onOpenProModal: () => void;
}

interface HistoryPoint {
  id: string;
  dateLabel: string;
  matchupLabel: string;
  value: number;
  secondaryText: string;
}

export function PropAnalysisView({
  game: initialGame,
  prop,
  context,
  isPro,
  onBack,
  onSelectProp,
  onOpenGameModal,
  onOpenPlayerModal,
  onOpenProModal,
}: PropAnalysisViewProps) {
  const isLocked = !isPro && isHighProbabilityProp(prop.confidence);
  const [liveGame, setLiveGame] = useState<Game>(initialGame);
  const [boxStats, setBoxStats] = useState<PlayerGameStat[]>([]);
  const [playerProfile, setPlayerProfile] = useState<Player | null>(null);
  const [fullPlayerLogs, setFullPlayerLogs] = useState<PlayerGameStat[]>([]);
  const [loadingExtra, setLoadingExtra] = useState(false);

  // Interactive sportsbook line simulator
  const [customLine, setCustomLine] = useState<number>(prop.lineValue);
  const [targetPick, setTargetPick] = useState<'OVER' | 'UNDER' | 'SPREAD' | 'ML'>(prop.pick);

  useEffect(() => {
    setLiveGame(initialGame);
  }, [initialGame]);

  useEffect(() => {
    setCustomLine(prop.lineValue);
    setTargetPick(prop.pick);
  }, [prop.id, prop.lineValue, prop.pick]);

  // Fetch deeper logs when inspecting a player prop (15 games instead of truncated slice)
  useEffect(() => {
    if (prop.scope !== 'player' || !prop.playerId) {
      setPlayerProfile(null);
      setFullPlayerLogs([]);
      return;
    }
    let active = true;
    setLoadingExtra(true);
    fetchPlayerProfileAndLogs(prop.playerId)
      .then((res) => {
        if (!active) return;
        setPlayerProfile(res.player);
        setFullPlayerLogs(res.logs);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingExtra(false);
      });
    return () => {
      active = false;
    };
  }, [prop.scope, prop.playerId]);

  // Keep game score and player boxscore synced in real time without page reload
  useEffect(() => {
    let active = true;
    const refreshLive = async () => {
      try {
        const [g, box] = await Promise.all([
          fetchGameById(initialGame.id),
          initialGame.status !== 'scheduled' ? fetchGameBoxScore(initialGame.id) : Promise.resolve([]),
        ]);
        if (!active) return;
        if (g) setLiveGame(g);
        if (box.length > 0) setBoxStats(box);
      } catch {
        // Ignore transient network errors
      }
    };

    void refreshLive();
    const interval = window.setInterval(refreshLive, 15_000);
    const channel = supabase
      .channel(`prop_view_${initialGame.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
        void refreshLive();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_game_stats' }, () => {
        void refreshLive();
      })
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [initialGame.id, initialGame.status]);

  const homeRecent = useMemo(
    () => summarizeTeamRecent(liveGame.home_team_id, context.homeRecentGames),
    [liveGame.home_team_id, context.homeRecentGames],
  );
  const awayRecent = useMemo(
    () => summarizeTeamRecent(liveGame.away_team_id, context.awayRecentGames),
    [liveGame.away_team_id, context.awayRecentGames],
  );
  const insight = useMemo(
    () =>
      buildMatchupBettingInsight(
        liveGame,
        context.homeStanding,
        context.awayStanding,
        homeRecent,
        awayRecent,
      ),
    [liveGame, context.homeStanding, context.awayStanding, homeRecent, awayRecent],
  );

  const allGameProps = useMemo(
    () =>
      buildGamePropsRecommendations({
        game: liveGame,
        homeStanding: context.homeStanding,
        awayStanding: context.awayStanding,
        homeTeamAvg: context.homeTeamAvg,
        awayTeamAvg: context.awayTeamAvg,
        homeRecent,
        awayRecent,
        keyPlayers: context.keyPlayers,
        playerRecentLogs: context.playerRecentLogs ?? [],
      }),
    [liveGame, context, homeRecent, awayRecent],
  );

  // Build deep statistical breakdown for the selected prop
  const analysis = useMemo(() => {
    const unit =
      prop.metricKey === 'pts'
        ? 'PTS'
        : prop.metricKey === 'reb'
          ? 'REB'
          : prop.metricKey === 'ast'
            ? 'AST'
            : prop.metricKey === 'pra'
              ? 'P+R+A'
              : prop.metricKey === 'tpm'
                ? '3PT'
                : prop.pick === 'ML'
                  ? '%'
                  : prop.id.startsWith('team_3pm_')
                    ? '3PM'
                    : prop.id.startsWith('team_reb_')
                      ? 'REB'
                      : 'PTS';

    let seasonBaseline = 0;
    let recentBaseline = 0;
    let projectedVal = prop.lineValue;
    let rivalFactorLabel = 'Contexto estándar de liga';
    let rivalFactorDetail = 'Sin desajuste defensivo marcado en esta categoría.';
    let playerAvgObj: PlayerSeasonAverage | null = null;
    let oppTeamObj: TeamSeasonAverage | null = null;
    let historySeries: HistoryPoint[] = [];

    if (prop.scope === 'player' && prop.playerId && prop.metricKey) {
      playerAvgObj = context.keyPlayers.find((p) => p.player_id === prop.playerId) ?? null;
      const fallbackLogs = (context.playerRecentLogs ?? []).filter(
        (l) => l.player_id === prop.playerId,
      );
      const logsToUse = fullPlayerLogs.length > 0 ? fullPlayerLogs : fallbackLogs;
      const cfg = PLAYER_CHART_METRICS[prop.metricKey];
      seasonBaseline = cfg.getSeasonAvg(playerAvgObj, logsToUse);
      const recentSlice = logsToUse.slice(0, 6);
      const recentVals = recentSlice.map((g) => cfg.getStatValue(g));
      recentBaseline =
        recentVals.length > 0
          ? recentVals.reduce((a, b) => a + b, 0) / recentVals.length
          : seasonBaseline;

      oppTeamObj =
        playerAvgObj?.team_id === liveGame.home_team_id
          ? context.awayTeamAvg
          : context.homeTeamAvg;

      let proj =
        recentVals.length >= 2 ? seasonBaseline * 0.45 + recentBaseline * 0.55 : seasonBaseline;

      if (oppTeamObj?.oppg != null && (prop.metricKey === 'pts' || prop.metricKey === 'pra')) {
        const oppDef = Number(oppTeamObj.oppg);
        proj += seasonBaseline * ((oppDef - 113.5) / 113.5) * 0.55;
        rivalFactorLabel = `${oppTeamObj.team_abbreviation} permite ${oppDef.toFixed(1)} PPG`;
        rivalFactorDetail =
          oppDef >= 116
            ? 'Defensa rival permisiva; favorece producción ofensiva por encima del promedio.'
            : oppDef <= 110
              ? 'Defensa rival sólida; puede restringir anotación si el ritmo baja.'
              : 'Defensa rival dentro del promedio de la NBA (~113.5 PPG).';
      } else if (oppTeamObj?.rpg != null && prop.metricKey === 'reb') {
        const oppReb = Number(oppTeamObj.rpg);
        if (oppReb <= 42) proj += 0.4;
        else if (oppReb >= 46.5) proj -= 0.4;
        rivalFactorLabel = `${oppTeamObj.team_abbreviation} captura ${oppReb.toFixed(1)} RPG`;
        rivalFactorDetail =
          oppReb <= 42
            ? 'Rival cede terreno en el rebote colectivo.'
            : 'Rival disputa fuerte el tablero defensivo y ofensivo.';
      } else if (oppTeamObj) {
        rivalFactorLabel = `Rival ${oppTeamObj.team_abbreviation} (${oppTeamObj.wins}-${oppTeamObj.losses})`;
        rivalFactorDetail = `Permite ${Number(oppTeamObj.oppg).toFixed(1)} PPG y tira ${Number(
          oppTeamObj.fg_pct ?? 46,
        ).toFixed(1)}% TC.`;
      }

      projectedVal = proj;

      historySeries = [...logsToUse]
        .slice(0, 12)
        .reverse()
        .map((row, idx) => {
          const val = cfg.getStatValue(row);
          const isHome = row.game?.home_team_id === row.team_id;
          const oppAbbr = isHome
            ? row.game?.away_team?.abbreviation
            : row.game?.home_team?.abbreviation;
          return {
            id: String(row.id ?? idx),
            dateLabel: row.game?.game_date ? row.game.game_date.slice(5) : `#${idx + 1}`,
            matchupLabel: oppAbbr ? `${isHome ? 'vs' : '@'} ${oppAbbr}` : `${row.minutes}m`,
            value: val,
            secondaryText: `${row.pts}P / ${row.reb}R / ${row.ast}A (${row.minutes}m)`,
          };
        });
    } else if (prop.id.startsWith('team_total_')) {
      const homePpg = Number(
        context.homeStanding?.ppg ?? context.homeTeamAvg?.ppg ?? homeRecent.avgFor ?? 0,
      );
      const homeOppg = Number(
        context.homeStanding?.oppg ?? context.homeTeamAvg?.oppg ?? homeRecent.avgAgainst ?? 0,
      );
      const awayPpg = Number(
        context.awayStanding?.ppg ?? context.awayTeamAvg?.ppg ?? awayRecent.avgFor ?? 0,
      );
      const awayOppg = Number(
        context.awayStanding?.oppg ?? context.awayTeamAvg?.oppg ?? awayRecent.avgAgainst ?? 0,
      );
      seasonBaseline =
        insight.expectedTotalSeason ??
        (homePpg + awayOppg) / 2 + (awayPpg + homeOppg) / 2;
      recentBaseline = insight.expectedTotalRecent ?? seasonBaseline;
      projectedVal = seasonBaseline * 0.55 + recentBaseline * 0.45;
      rivalFactorLabel = `Pace / Defensa: ${awayOppg.toFixed(1)} y ${homeOppg.toFixed(1)} OPPG`;
      rivalFactorDetail = `Sumando los últimos partidos de ambos conjuntos el promedio combinado es de ${recentBaseline.toFixed(
        1,
      )} puntos.`;

      const combinedGames = [...context.awayRecentGames, ...context.homeRecentGames]
        .filter((g) => g.status === 'final')
        .sort((a, b) => a.game_date.localeCompare(b.game_date))
        .slice(-10);

      historySeries = combinedGames.map((g) => ({
        id: String(g.id),
        dateLabel: g.game_date.slice(5),
        matchupLabel: `${g.away_team.abbreviation}@${g.home_team.abbreviation}`,
        value: g.away_score + g.home_score,
        secondaryText: `${g.away_score}-${g.home_score} (Total ${g.away_score + g.home_score})`,
      }));
    } else if (prop.id.startsWith('team_spread_')) {
      const chosenIsHome = prop.teamAbbr === liveGame.home_team.abbreviation;
      const projHomeMargin = insight.projectedHomeMargin ?? 0;
      projectedVal = chosenIsHome ? projHomeMargin : -projHomeMargin;
      const mySt = chosenIsHome ? context.homeStanding : context.awayStanding;
      const oppSt = chosenIsHome ? context.awayStanding : context.homeStanding;
      seasonBaseline = Number(mySt?.diff ?? 0);
      recentBaseline = chosenIsHome ? homeRecent.avgMargin : awayRecent.avgMargin;
      rivalFactorLabel = `Diferencial rival (${oppSt?.team.abbreviation ?? ''}): ${
        Number(oppSt?.diff ?? 0) >= 0 ? '+' : ''
      }${Number(oppSt?.diff ?? 0).toFixed(1)}`;
      rivalFactorDetail = `Incluye ajuste estándar de localía NBA (+2.2 pts para ${liveGame.home_team.abbreviation}).`;

      const recentList = chosenIsHome ? context.homeRecentGames : context.awayRecentGames;
      const myTeamId = chosenIsHome ? liveGame.home_team_id : liveGame.away_team_id;
      historySeries = [...recentList]
        .filter((g) => g.status === 'final')
        .reverse()
        .map((g) => {
          const isH = g.home_team_id === myTeamId;
          const myPts = isH ? g.home_score : g.away_score;
          const opPts = isH ? g.away_score : g.home_score;
          const opp = isH ? g.away_team : g.home_team;
          return {
            id: String(g.id),
            dateLabel: g.game_date.slice(5),
            matchupLabel: `${isH ? 'vs' : '@'} ${opp.abbreviation}`,
            value: myPts - opPts,
            secondaryText: `${myPts}-${opPts} (${myPts - opPts >= 0 ? '+' : ''}${myPts - opPts})`,
          };
        });
    } else if (prop.id.startsWith('team_ml_')) {
      const chosenIsHome = prop.teamAbbr === liveGame.home_team.abbreviation;
      const homeWinPct = Number(
        context.homeStanding?.win_pct ?? context.homeTeamAvg?.win_pct ?? 0.5,
      );
      const awayWinPct = Number(
        context.awayStanding?.win_pct ?? context.awayTeamAvg?.win_pct ?? 0.5,
      );
      const marginProb =
        insight.projectedHomeMargin != null
          ? Math.min(0.86, Math.max(0.14, 0.5 + insight.projectedHomeMargin * 0.028))
          : 0.5 + (homeWinPct - awayWinPct) * 0.45 + 0.04;
      const espnProb =
        liveGame.odds?.home_win_prob != null ? Number(liveGame.odds.home_win_prob) / 100 : null;
      const modelHome = espnProb != null ? marginProb * 0.55 + espnProb * 0.45 : marginProb;
      projectedVal = (chosenIsHome ? modelHome : 1 - modelHome) * 100;
      seasonBaseline = (chosenIsHome ? homeWinPct : awayWinPct) * 100;
      const myRecent = chosenIsHome ? homeRecent : awayRecent;
      recentBaseline =
        myRecent.gamesCount > 0 ? (myRecent.wins / myRecent.gamesCount) * 100 : seasonBaseline;
      const oppImplied = americanToImpliedProb(
        chosenIsHome ? liveGame.odds?.home_moneyline : liveGame.odds?.away_moneyline,
      );
      rivalFactorLabel =
        oppImplied != null
          ? `Probabilidad implícita de cuota: ${oppImplied.toFixed(1)}%`
          : `Rival: ${
              chosenIsHome ? liveGame.away_team.abbreviation : liveGame.home_team.abbreviation
            }`;
      rivalFactorDetail = `Comparativa entre probabilidad real estimada (${projectedVal.toFixed(
        1,
      )}%) y el precio del mercado.`;

      const recentList = chosenIsHome ? context.homeRecentGames : context.awayRecentGames;
      const myTeamId = chosenIsHome ? liveGame.home_team_id : liveGame.away_team_id;
      historySeries = [...recentList]
        .filter((g) => g.status === 'final')
        .reverse()
        .map((g) => {
          const isH = g.home_team_id === myTeamId;
          const myPts = isH ? g.home_score : g.away_score;
          const opPts = isH ? g.away_score : g.home_score;
          const opp = isH ? g.away_team : g.home_team;
          return {
            id: String(g.id),
            dateLabel: g.game_date.slice(5),
            matchupLabel: `${isH ? 'vs' : '@'} ${opp.abbreviation}`,
            value: myPts - opPts,
            secondaryText: `${myPts > opPts ? 'Victoria' : 'Derrota'} ${myPts}-${opPts}`,
          };
        });
    } else if (prop.id.startsWith('team_pts_')) {
      const teamId = Number(prop.id.replace('team_pts_', ''));
      const isHome = teamId === liveGame.home_team_id;
      const myPpg = Number(
        (isHome ? context.homeStanding?.ppg : context.awayStanding?.ppg) ??
          (isHome ? context.homeTeamAvg?.ppg : context.awayTeamAvg?.ppg) ??
          0,
      );
      const oppOppg = Number(
        (isHome ? context.awayStanding?.oppg : context.homeStanding?.oppg) ??
          (isHome ? context.awayTeamAvg?.oppg : context.homeTeamAvg?.oppg) ??
          0,
      );
      const myRec = isHome ? homeRecent : awayRecent;
      const oppRec = isHome ? awayRecent : homeRecent;
      seasonBaseline = (myPpg + oppOppg) / 2;
      recentBaseline =
        myRec.gamesCount > 0 && oppRec.gamesCount > 0
          ? (myRec.avgFor + oppRec.avgAgainst) / 2
          : seasonBaseline;
      projectedVal = seasonBaseline * 0.55 + recentBaseline * 0.45;
      rivalFactorLabel = `Rival concede ${oppOppg.toFixed(1)} PPG`;
      rivalFactorDetail = `El equipo anota ${myPpg.toFixed(1)} PPG en temporada y ${myRec.avgFor.toFixed(
        1,
      )} en sus últimos ${myRec.gamesCount || 1} partidos.`;

      const recentList = isHome ? context.homeRecentGames : context.awayRecentGames;
      historySeries = [...recentList]
        .filter((g) => g.status === 'final')
        .reverse()
        .map((g) => {
          const isH = g.home_team_id === teamId;
          const myPts = isH ? g.home_score : g.away_score;
          const opp = isH ? g.away_team : g.home_team;
          return {
            id: String(g.id),
            dateLabel: g.game_date.slice(5),
            matchupLabel: `${isH ? 'vs' : '@'} ${opp.abbreviation}`,
            value: myPts,
            secondaryText: `${myPts} pts vs ${opp.abbreviation}`,
          };
        });
    } else if (prop.id.startsWith('team_3pm_')) {
      const teamId = Number(prop.id.replace('team_3pm_', ''));
      const isHome = teamId === liveGame.home_team_id;
      const tAvg = isHome ? context.homeTeamAvg : context.awayTeamAvg;
      const oppAvg = isHome ? context.awayTeamAvg : context.homeTeamAvg;
      seasonBaseline = Number(tAvg?.tpm_pg ?? prop.lineValue);
      recentBaseline = seasonBaseline;
      const oppOppg = Number(oppAvg?.oppg ?? 113.5);
      const defAdjust = oppOppg > 113.5 ? (oppOppg - 113.5) * 0.14 : (oppOppg - 113.5) * 0.1;
      projectedVal = seasonBaseline + defAdjust;
      rivalFactorLabel = `Defensa rival permite ${oppOppg.toFixed(1)} PPG`;
      rivalFactorDetail = `${tAvg?.team_abbreviation ?? ''} lanza ${Number(
        tAvg?.tp_pct ?? 0,
      ).toFixed(1)}% en triples (${Number(tAvg?.tpa_pg ?? 0).toFixed(1)} intentos/PJ).`;
    } else if (prop.id.startsWith('team_reb_')) {
      const teamId = Number(prop.id.replace('team_reb_', ''));
      const isHome = teamId === liveGame.home_team_id;
      const tAvg = isHome ? context.homeTeamAvg : context.awayTeamAvg;
      const oppAvg = isHome ? context.awayTeamAvg : context.homeTeamAvg;
      seasonBaseline = Number(tAvg?.rpg ?? prop.lineValue);
      recentBaseline = seasonBaseline;
      const oppReb = Number(oppAvg?.rpg ?? seasonBaseline);
      const oppMissFactor = oppAvg?.fg_pct != null ? (46.8 - Number(oppAvg.fg_pct)) * 0.25 : 0;
      projectedVal = seasonBaseline + oppMissFactor + (seasonBaseline - oppReb) * 0.15;
      rivalFactorLabel = `Rival captura ${oppReb.toFixed(1)} RPG (${Number(
        oppAvg?.fg_pct ?? 0,
      ).toFixed(1)}% TC)`;
      rivalFactorDetail = `${tAvg?.team_abbreviation ?? ''} suma ${Number(
        tAvg?.oreb_pg ?? 0,
      ).toFixed(1)} rebotes ofensivos y ${Number(tAvg?.dreb_pg ?? 0).toFixed(1)} defensivos.`;
    }

    // Evaluate customLine strictly against targetPick (never silently flip away from user's prop side)
    const effectivePick: 'OVER' | 'UNDER' | 'SPREAD' | 'ML' = targetPick;
    const isHitPoint = (val: number): boolean => {
      if (effectivePick === 'SPREAD') return val + customLine > 0;
      if (effectivePick === 'ML') return val > 0;
      if (effectivePick === 'UNDER') return val < customLine;
      return val > customLine;
    };

    let signedEdge = 0;
    if (effectivePick === 'SPREAD') {
      signedEdge = projectedVal + customLine;
    } else if (effectivePick === 'ML') {
      signedEdge = (projectedVal - customLine) / 4;
    } else if (effectivePick === 'UNDER') {
      signedEdge = customLine - projectedVal;
    } else {
      signedEdge = projectedVal - customLine;
    }

    const hits = historySeries.filter((h) => isHitPoint(h.value)).length;
    const totalHist = historySeries.length;
    const hitRatePct = totalHist > 0 ? Math.round((hits / totalHist) * 100) : 0;

    // Recalculate dynamic confidence at customLine
    const relDenom =
      effectivePick === 'SPREAD' ? 8 : effectivePick === 'ML' ? 12 : Math.max(3, customLine);
    const matchesOriginalConfig =
      Math.abs(customLine - prop.lineValue) < 0.01 && effectivePick === prop.pick;
    const dynamicConf = matchesOriginalConfig
      ? prop.confidence
      : Math.max(
          42,
          Math.min(
            94,
            Math.round(
              50 +
                Math.max(-18, Math.min(26, (signedEdge / relDenom) * 95)) +
                (totalHist > 0 ? (hits / totalHist - 0.5) * 30 : 0),
            ),
          ),
        );

    // Accessibility verdict ("¿Es accesible apostar a este mercado?")
    let accessibilityTitle = 'Accesibilidad Moderada';
    let accessibilityLevel: 'high' | 'medium' | 'low' = 'medium';
    let accessibilityText = '';

    if (effectivePick === 'ML') {
      if (dynamicConf >= 68 && projectedVal - customLine >= 4) {
        accessibilityTitle = 'Mercado Accesible';
        accessibilityLevel = 'high';
        accessibilityText = `Probabilidad estimada (${projectedVal.toFixed(
          1,
        )}%) supera claramente la referencia evaluada (${customLine.toFixed(1)}%).`;
      } else if (projectedVal - customLine >= 0) {
        accessibilityTitle = 'Accesibilidad Moderada';
        accessibilityLevel = 'medium';
        accessibilityText = `Ventaja ajustada para ganar el partido. Conviene cuidar el tamaño de la apuesta si la cuota es baja.`;
      } else {
        accessibilityTitle = 'Mercado Exigente';
        accessibilityLevel = 'low';
        accessibilityText = `La cuota exigida pide una probabilidad mayor a la proyectada por el rendimiento actual.`;
      }
    } else if (effectivePick === 'SPREAD') {
      if (signedEdge >= 3.0 && (totalHist === 0 || hitRatePct >= 50)) {
        accessibilityTitle = 'Mercado Accesible';
        accessibilityLevel = 'high';
        accessibilityText = `El margen proyectado ofrece +${signedEdge.toFixed(
          1,
        )} pts de colchón sobre el hándicap ${customLine > 0 ? `+${customLine}` : customLine}.`;
      } else if (signedEdge >= 0.8) {
        accessibilityTitle = 'Accesibilidad Moderada';
        accessibilityLevel = 'medium';
        accessibilityText = `Ventaja leve (+${signedEdge.toFixed(
          1,
        )} pts). Un cierre apretado puede definir si cubre.`;
      } else {
        accessibilityTitle = 'Mercado Exigente';
        accessibilityLevel = 'low';
        accessibilityText = `A esa línea el margen estadístico queda corto o negativo (${signedEdge.toFixed(
          1,
        )} pts).`;
      }
    } else {
      const pctBuffer = signedEdge / Math.max(2, customLine);
      if (signedEdge < 0) {
        accessibilityTitle = 'Mercado Exigente';
        accessibilityLevel = 'low';
        accessibilityText = `La proyección (${projectedVal.toFixed(1)} ${unit}) queda ${Math.abs(
          signedEdge,
        ).toFixed(1)} ${unit} en contra de ${effectivePick} ${customLine.toFixed(
          1,
        )}. Conviene subir/bajar la línea o evaluar el lado opuesto.`;
      } else if (
        (pctBuffer >= 0.04 || signedEdge >= 1.0) &&
        (totalHist === 0 || hitRatePct >= 55)
      ) {
        accessibilityTitle = 'Mercado Accesible';
        accessibilityLevel = 'high';
        accessibilityText = `Colchón sólido de +${signedEdge.toFixed(
          1,
        )} ${unit} a favor de ${effectivePick} ${customLine.toFixed(1)} con ${
          totalHist > 0 ? `${hitRatePct}% de acierto reciente` : 'respaldo de promedio de temporada'
        }.`;
      } else if (signedEdge >= 0.25 || (totalHist > 0 && hitRatePct >= 60)) {
        accessibilityTitle = 'Accesibilidad Moderada';
        accessibilityLevel = 'medium';
        accessibilityText = `Margen positivo de +${signedEdge.toFixed(
          1,
        )} ${unit} hacia ${effectivePick} frente a la proyección (${projectedVal.toFixed(
          1,
        )} ${unit}).`;
      } else {
        accessibilityTitle = 'Mercado Exigente';
        accessibilityLevel = 'low';
        accessibilityText = `La línea evaluada (${customLine.toFixed(
          1,
        )} ${unit}) está prácticamente pegada a la proyección (${projectedVal.toFixed(1)}).`;
      }
    }

    // Limit line recommendation
    const accessibleLimitText =
      effectivePick === 'SPREAD'
        ? `Hasta ${(Math.ceil((-projectedVal + 1.5) * 2) / 2).toFixed(1)}`
        : effectivePick === 'ML'
          ? `Valor desde prob. implícita <= ${Math.max(45, projectedVal - 3).toFixed(0)}%`
          : effectivePick === 'OVER'
            ? `Accesible hasta ${(Math.floor((projectedVal - 0.5) * 2) / 2).toFixed(1)} ${unit}`
            : `Accesible desde ${(Math.ceil((projectedVal + 0.5) * 2) / 2).toFixed(1)} ${unit}`;

    return {
      unit,
      seasonBaseline,
      recentBaseline,
      projectedVal,
      signedEdge,
      rivalFactorLabel,
      rivalFactorDetail,
      playerAvgObj,
      historySeries,
      effectivePick,
      hits,
      totalHist,
      hitRatePct,
      dynamicConf,
      accessibilityTitle,
      accessibilityLevel,
      accessibilityText,
      accessibleLimitText,
    };
  }, [
    prop,
    context,
    fullPlayerLogs,
    liveGame,
    homeRecent,
    awayRecent,
    insight,
    customLine,
    targetPick,
  ]);

  // Live current value if game is live/final
  const liveCurrentValue = useMemo(() => {
    if (liveGame.status === 'scheduled') return null;
    if (prop.scope === 'player' && prop.playerId && prop.metricKey) {
      const row = boxStats.find((s) => s.player_id === prop.playerId);
      if (!row || row.did_not_play) return null;
      return `${PLAYER_CHART_METRICS[prop.metricKey].getStatValue(row)} ${analysis.unit}`;
    }
    if (prop.id.startsWith('team_total_')) {
      return `${liveGame.away_score + liveGame.home_score} pts`;
    }
    if (prop.id === `team_pts_${liveGame.away_team_id}`) return `${liveGame.away_score} pts`;
    if (prop.id === `team_pts_${liveGame.home_team_id}`) return `${liveGame.home_score} pts`;
    return null;
  }, [liveGame, prop, boxStats, analysis.unit]);

  const maxChartVal = useMemo(() => {
    if (analysis.historySeries.length === 0) return 20;
    const absVals = analysis.historySeries.map((h) => Math.abs(h.value));
    const refLine = prop.pick === 'SPREAD' ? Math.abs(customLine) : customLine;
    return Math.max(5, Math.ceil(Math.max(...absVals, refLine) * 1.15));
  }, [analysis.historySeries, customLine, prop.pick]);

  const relatedProps = useMemo(
    () => allGameProps.filter((p) => p.id !== prop.id).slice(0, 8),
    [allGameProps, prop.id],
  );

  return (
    <div className="space-y-4 pb-8">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600 text-xs font-semibold text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Volver a Partidos
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenGameModal(liveGame)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600 text-xs font-medium text-slate-300 transition-colors"
          >
            <span>
              {liveGame.away_team.abbreviation} @ {liveGame.home_team.abbreviation}
            </span>
            {liveGame.status !== 'scheduled' && (
              <span className="font-bold text-slate-100 tabular-nums">
                {liveGame.away_score}-{liveGame.home_score}
              </span>
            )}
            <ExternalLink className="w-3 h-3 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Main Prop Hero & Accessibility Diagnosis */}
      <section className="rounded-2xl bg-slate-900/80 border border-slate-800/90 p-4 sm:p-5 space-y-5">
        {/* Identity Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3.5 min-w-0">
            {prop.scope === 'player' ? (
              <div className="w-14 h-14 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                {analysis.playerAvgObj?.headshot_url || playerProfile?.headshot_url ? (
                  <img
                    src={analysis.playerAvgObj?.headshot_url ?? playerProfile?.headshot_url ?? ''}
                    alt={prop.subjectName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-sm font-bold text-slate-400">{prop.teamAbbr}</span>
                )}
              </div>
            ) : (
              <div className="flex items-center -space-x-2 shrink-0">
                {liveGame.away_team.logo_url && (
                  <img
                    src={liveGame.away_team.logo_url}
                    alt={liveGame.away_team.abbreviation}
                    className="w-11 h-11 object-contain"
                  />
                )}
                {liveGame.home_team.logo_url && (
                  <img
                    src={liveGame.home_team.logo_url}
                    alt={liveGame.home_team.abbreviation}
                    className="w-11 h-11 object-contain"
                  />
                )}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {prop.scope === 'team' ? 'Mercado de Equipo' : 'Prop de Jugador'} ·{' '}
                  {prop.marketLabel}
                </span>
                {liveGame.status === 'live' && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    En vivo · {liveGame.status_detail}
                  </span>
                )}
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white truncate mt-0.5">
                {prop.subjectName}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-0.5">
                <span>
                  {liveGame.away_team.short_name} vs {liveGame.home_team.short_name}
                </span>
                {prop.playerId && (
                  <button
                    type="button"
                    onClick={() => onOpenPlayerModal(prop.playerId!)}
                    className="text-slate-300 hover:text-white underline underline-offset-2"
                  >
                    Ver ficha completa
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Verdict Pill */}
          <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700/90 tabular-nums">
              {isLocked ? (
                <>
                  <Lock className="w-4 h-4 text-slate-300 shrink-0" />
                  <span className="text-sm font-bold text-slate-100">Exclusivo PRO</span>
                  <span className="text-xs font-semibold text-slate-400">
                    · {prop.confidence}% ({prop.confidenceTier})
                  </span>
                </>
              ) : (
                <>
                  {analysis.accessibilityLevel === 'high' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400/90 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-slate-300 shrink-0" />
                  )}
                  <span className="text-sm font-bold text-slate-100">{analysis.accessibilityTitle}</span>
                  <span className="text-xs font-semibold text-slate-400">
                    · {analysis.dynamicConf}% ({getConfidenceTier(analysis.dynamicConf)})
                  </span>
                </>
              )}
            </div>
            {!isLocked && liveCurrentValue && (
              <span className="text-xs text-slate-300 tabular-nums">
                En el partido ahora: <strong className="text-white">{liveCurrentValue}</strong>
              </span>
            )}
          </div>
        </div>

        {isLocked ? (
          <div className="rounded-2xl bg-slate-950/90 border border-slate-700/80 p-6 sm:p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-700 mx-auto flex items-center justify-center">
              <Lock className="w-5 h-5 text-slate-200" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-lg font-bold text-white">
                Prop de Alta Probabilidad ({prop.confidence}% · {prop.confidenceTier})
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Los pronósticos con confianza de {PRO_CONFIDENCE_THRESHOLD}% a 94% están reservados para
                suscriptores de <strong className="text-slate-200">CourtVision PRO ($5 USD/mes)</strong>.
                Desbloquea al instante el pick exacto, la línea del mercado, el rango accesible y el
                gráfico histórico.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={onOpenProModal}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-white text-slate-950 font-bold text-xs sm:text-sm transition-colors"
              >
                <Lock className="w-4 h-4" />
                Desbloquear todos los Props PRO ($5/mes)
              </button>
              <button
                type="button"
                onClick={onBack}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 transition-colors"
              >
                Volver a partidos gratis
              </button>
            </div>
          </div>
        ) : (
        <>
        {/* 4 Key Cards: Line Simulator + Projection + Pick + Accessibility Limit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
          {/* Card 1: Market Line Simulator */}
          <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              <span>Línea de Mercado</span>
              {Math.abs(customLine - prop.lineValue) > 0.01 && (
                <button
                  type="button"
                  onClick={() => setCustomLine(prop.lineValue)}
                  className="inline-flex items-center gap-1 text-[10px] text-slate-300 hover:text-white"
                >
                  <RotateCcw className="w-3 h-3" />
                  Base
                </button>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xl font-bold text-white">
                {prop.pick === 'SPREAD' && customLine > 0
                  ? `+${customLine.toFixed(1)}`
                  : customLine.toFixed(1)}{' '}
                <span className="text-xs font-medium text-slate-400">{analysis.unit}</span>
              </div>
              <div className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900">
                <button
                  type="button"
                  onClick={() =>
                    setCustomLine((c) => Number((prop.pick === 'SPREAD' ? c - 0.5 : Math.max(0.5, c - 0.5)).toFixed(1)))
                  }
                  className="p-1.5 text-slate-300 hover:bg-slate-800"
                  aria-label="Reducir línea"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setCustomLine((c) => Number((c + 0.5).toFixed(1)))}
                  className="p-1.5 text-slate-300 hover:bg-slate-800 border-l border-slate-700"
                  aria-label="Subir línea"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="text-[11px] text-slate-400 truncate">{prop.marketLineText}</div>
          </div>

          {/* Card 2: Model Projection */}
          <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3.5 space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              Proyección Estadística
            </div>
            <div className="text-xl font-bold text-white">
              {prop.pick === 'SPREAD' && analysis.projectedVal > 0
                ? `+${analysis.projectedVal.toFixed(1)}`
                : analysis.projectedVal.toFixed(1)}{' '}
              <span className="text-xs font-medium text-slate-400">{analysis.unit}</span>
            </div>
            <div className="text-[11px] text-slate-400">
              {prop.pick === 'SPREAD'
                ? `Colchón: ${(analysis.projectedVal + customLine >= 0 ? '+' : '')}${(analysis.projectedVal + customLine).toFixed(1)} pts`
                : `Diferencia vs línea: ${analysis.projectedVal - customLine >= 0 ? '+' : ''}${(analysis.projectedVal - customLine).toFixed(1)} ${analysis.unit}`}
            </div>
          </div>

          {/* Card 3: Recommended Side (with Over/Under switch if applicable) */}
          <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              <span>Opción Evaluada</span>
              {(prop.pick === 'OVER' || prop.pick === 'UNDER') && (
                <div className="inline-flex rounded-md bg-slate-900 border border-slate-700 p-0.5 text-[10px]">
                  {(['OVER', 'UNDER'] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => setTargetPick(side)}
                      className={`px-1.5 py-0.5 rounded font-semibold transition-colors ${
                        targetPick === side
                          ? 'bg-slate-200 text-slate-950'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {side}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="text-xl font-bold text-white">
              {prop.pick === 'SPREAD'
                ? `${prop.teamAbbr} ${customLine > 0 ? `+${customLine.toFixed(1)}` : customLine.toFixed(1)}`
                : prop.pick === 'ML'
                  ? prop.pickLabel
                  : `${analysis.effectivePick} ${customLine.toFixed(1)}`}
            </div>
            <div className="text-[11px] text-slate-400">
              Confianza calculada: <strong className="text-slate-200">{analysis.dynamicConf}%</strong>
            </div>
          </div>

          {/* Card 4: Accessibility Threshold */}
          <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3.5 space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
              Rango Accesible
            </div>
            <div className="text-sm font-bold text-slate-100 pt-1">
              {analysis.accessibleLimitText}
            </div>
            <div className="text-[11px] text-slate-400 leading-snug">
              Ajusta la línea con - / + para validar la cuota de tu casa.
            </div>
          </div>
        </div>

        {/* Accessibility Explanation Banner (Neutral) */}
        <div className="rounded-xl bg-slate-950/80 border border-slate-800 px-4 py-3 flex items-start gap-3">
          <SlidersHorizontal className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <div className="text-xs font-bold text-slate-200">
              Evaluación de accesibilidad: {analysis.accessibilityTitle}
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">{analysis.accessibilityText}</p>
          </div>
        </div>

        {/* 3 Analytical Pillars (Neutral Grid) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 tabular-nums">
          <div className="rounded-xl bg-slate-950/60 border border-slate-800/80 p-3.5 space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              1. Respaldo Estadístico
            </div>
            <div className="text-sm font-bold text-slate-100">
              Temp: {analysis.seasonBaseline.toFixed(1)} {analysis.unit} · Reciente:{' '}
              {analysis.recentBaseline.toFixed(1)} {analysis.unit}
            </div>
            <p className="text-xs text-slate-400">{prop.statSummary}</p>
          </div>

          <div className="rounded-xl bg-slate-950/60 border border-slate-800/80 p-3.5 space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              2. Cumplimiento Reciente
            </div>
            <div className="text-sm font-bold text-slate-100">
              {analysis.totalHist > 0
                ? `${analysis.hits} de ${analysis.totalHist} partidos (${analysis.hitRatePct}%)`
                : 'Según promedio colectivo'}
            </div>
            <p className="text-xs text-slate-400">
              {analysis.totalHist > 0
                ? `Veces que cumplió la línea ${customLine.toFixed(1)} ${analysis.unit} en el tramo reciente.`
                : 'Basado en los promedios acumulados de la temporada actual.'}
            </p>
          </div>

          <div className="rounded-xl bg-slate-950/60 border border-slate-800/80 p-3.5 space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              3. Factor Rival
            </div>
            <div className="text-sm font-bold text-slate-100">{analysis.rivalFactorLabel}</div>
            <p className="text-xs text-slate-400">{analysis.rivalFactorDetail}</p>
          </div>
        </div>
        </>
        )}
      </section>

      {/* Historical Chart & Game Log (Green/Red Bars) */}
      {isLocked ? null : analysis.historySeries.length > 0 ? (
        <section className="rounded-2xl bg-slate-900/80 border border-slate-800/90 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Historial Reciente frente a la Línea ({customLine.toFixed(1)} {analysis.unit})
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {loadingExtra
                  ? 'Cargando últimos 12-15 partidos...'
                  : `Últimos ${analysis.historySeries.length} registros comparados contra la línea simulada.`}
              </p>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-500 inline-block" />
                Cumple (
                {analysis.effectivePick === 'UNDER'
                  ? `< ${customLine.toFixed(1)}`
                  : analysis.effectivePick === 'OVER'
                    ? `> ${customLine.toFixed(1)}`
                    : analysis.effectivePick}
                )
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-[2px] bg-rose-500 inline-block" />
                No cumple
              </span>
            </div>
          </div>

          {/* Bar Chart (Green when hits target pick, Red when misses) */}
          <div className="relative pt-5 pb-1">
            <div className="relative flex items-end gap-1.5 h-36">
              {prop.pick !== 'SPREAD' && prop.pick !== 'ML' && (
                <div
                  className="absolute left-0 right-0 border-t border-dashed border-slate-400/80 pointer-events-none z-10 flex justify-end"
                  style={{
                    bottom: `${Math.min(94, Math.max(6, (customLine / maxChartVal) * 100))}%`,
                  }}
                >
                  <span className="-translate-y-4 text-[10px] font-bold px-1.5 py-0.2 rounded bg-slate-800 text-slate-200 border border-slate-600 tabular-nums">
                    {customLine.toFixed(1)}
                  </span>
                </div>
              )}

              {analysis.historySeries.map((pt) => {
                const hit =
                  analysis.effectivePick === 'SPREAD'
                    ? pt.value + customLine > 0
                    : analysis.effectivePick === 'ML'
                      ? pt.value > 0
                      : analysis.effectivePick === 'UNDER'
                        ? pt.value < customLine
                        : pt.value > customLine;
                const barMagnitude =
                  prop.pick === 'SPREAD' || prop.pick === 'ML' ? Math.abs(pt.value) : pt.value;
                const pct = Math.max(10, Math.round((barMagnitude / maxChartVal) * 100));
                return (
                  <div
                    key={pt.id}
                    className="flex-1 min-w-0 flex flex-col items-center justify-end h-full"
                    title={`${pt.dateLabel} ${pt.matchupLabel}: ${pt.value} (${hit ? 'Cumple' : 'No cumple'})`}
                  >
                    <span
                      className={`text-[10px] font-bold mb-1 tabular-nums ${
                        hit ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {(prop.pick === 'SPREAD' || prop.pick === 'ML') && pt.value > 0
                        ? `+${pt.value}`
                        : pt.value}
                    </span>
                    <div
                      className={`w-full max-w-[30px] rounded-t-md transition-all ${
                        hit
                          ? 'bg-gradient-to-t from-emerald-600 to-emerald-400'
                          : 'bg-gradient-to-t from-rose-700/85 to-rose-500/90'
                      }`}
                      style={{ height: `${pct}%` }}
                    />
                    <span className="mt-1 text-[9px] text-slate-500 truncate max-w-full">
                      {pt.dateLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Clean Tabular Breakdown */}
          <div className="overflow-x-auto rounded-xl border border-slate-800/80">
            <table className="w-full text-xs tabular-nums whitespace-nowrap">
              <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="text-left py-2 px-3 font-semibold">FECHA</th>
                  <th className="text-left py-2 px-2 font-semibold">PARTIDO</th>
                  <th className="text-left py-2 px-2 font-semibold">DETALLE</th>
                  <th className="text-right py-2 px-2 font-semibold">REGISTRO</th>
                  <th className="text-center py-2 px-3 font-semibold">ESTADO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {[...analysis.historySeries].reverse().map((pt) => {
                  const hit =
                    analysis.effectivePick === 'SPREAD'
                      ? pt.value + customLine > 0
                      : analysis.effectivePick === 'ML'
                        ? pt.value > 0
                        : analysis.effectivePick === 'UNDER'
                          ? pt.value < customLine
                          : pt.value > customLine;
                  return (
                    <tr key={pt.id} className="hover:bg-slate-800/30">
                      <td className="py-2 px-3 text-slate-400">{pt.dateLabel}</td>
                      <td className="py-2 px-2 font-medium text-slate-200">{pt.matchupLabel}</td>
                      <td className="py-2 px-2 text-slate-400">{pt.secondaryText}</td>
                      <td className="text-right py-2 px-2 font-bold text-slate-100">
                        {(prop.pick === 'SPREAD' || prop.pick === 'ML') && pt.value > 0
                          ? `+${pt.value}`
                          : pt.value}{' '}
                        {prop.pick === 'SPREAD' || prop.pick === 'ML' ? 'pts' : analysis.unit}
                      </td>
                      <td className="text-center py-2 px-3">
                        <span
                          className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border ${
                            hit
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                          }`}
                        >
                          {hit ? 'Cumple' : 'No cumple'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl bg-slate-900/80 border border-slate-800/90 p-4 text-xs text-slate-400">
          Mercado evaluado directamente desde promedios colectivos de la temporada actual (
          {prop.statSummary}).
        </section>
      )}

      {/* Quick Switch to Other Props in this Same Game */}
      {relatedProps.length > 0 && (
        <section className="rounded-2xl bg-slate-900/80 border border-slate-800/90 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Otros Props del Partido ({liveGame.away_team.abbreviation} @{' '}
              {liveGame.home_team.abbreviation})
            </h2>
            <span className="text-[11px] text-slate-500">Ordenados de menor a mayor confianza</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {relatedProps.map((rp) => {
              const rpLocked = !isPro && isHighProbabilityProp(rp.confidence);
              return (
                <button
                  key={rp.id}
                  type="button"
                  onClick={() => onSelectProp(rp)}
                  className="rounded-xl bg-slate-950/75 border border-slate-800 hover:border-slate-600 p-2.5 text-left transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-100 truncate">
                      {rp.subjectName}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-300 tabular-nums shrink-0">
                      {rp.confidence}%
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">{rp.marketLabel}</div>
                  <div className="text-[11px] font-semibold text-slate-200 tabular-nums inline-flex items-center gap-1">
                    {rpLocked ? (
                      <>
                        <Lock className="w-3 h-3 text-slate-400" />
                        <span>PRO · Desbloquear</span>
                      </>
                    ) : (
                      rp.pickLabel
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
