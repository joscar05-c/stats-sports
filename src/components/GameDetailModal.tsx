import { useEffect, useMemo, useState } from 'react';
import {
  X,
  MapPin,
  Calendar,
  TrendingUp,
  Scale,
  Flame,
  ChevronRight,
  BarChart3,
  Target,
  ArrowUpDown,
  Shield,
  User,
  Lock,
  ArrowLeft,
  History,
} from 'lucide-react';
import {
  fetchFootballGameBettingContext,
  fetchGameBettingContext,
  fetchGameBoxScore,
  fetchGameById,
  type FootballGameBettingContext,
  type GameBettingContext,
} from '../services/basketballApi';
import { supabase } from '../lib/supabase';
import {
  americanToImpliedProb,
  buildGamePropsRecommendations,
  buildMatchupBettingInsight,
  evaluateGameBettingResult,
  formatAmericanOdds,
  formatDecimalOdds,
  formatSpreadCompact,
  isHighProbabilityProp,
  PRO_CONFIDENCE_THRESHOLD,
  summarizeTeamRecent,
  type FootballMarketCategory,
  type PropStrategyMode,
} from '../utils/betting';
import {
  buildFootballMatchupInsight,
  buildFootballPropsRecommendations,
  computeFootballMatchProjections,
  evaluateAnyPropStatus,
  extractHalfTimeGoals,
  FOOTBALL_MARKET_CATEGORY_TABS,
  hasFootballBoxTracking,
  summarizeAnyGamePropsEffectiveness,
  type FootballMatchProjections,
} from '../utils/footballProps';
import type { FootballPlayerSeasonAverage, Game, PlayerGameStat, Team, TeamStanding } from '../types/database';
import type { AnyBettingContext } from './PropsSidebar';
import { isNativeAndroid } from '../utils/platform';
import { PropsEffectivenessCard, type PropResultFilter } from './PropsEffectivenessCard';
import { PastGamesHistoryPanel } from './PastGamesHistoryPanel';
import { ModalDialog } from './ModalDialog';

interface GameDetailModalProps {
  game: Game;
  sport?: 'basketball' | 'football';
  isPro: boolean;
  onClose: () => void;
  onSelectPlayer: (playerId: number) => void;
  onOpenProModal: () => void;
  onSelectGame?: (game: Game) => void;
  onSelectTeam?: (team: Team, standing?: TeamStanding) => void;
}

type ModalSection = 'betting' | 'teamstats' | 'history' | 'boxscore';

interface TeamGameTotals {
  pts: number;
  starterPts: number;
  benchPts: number;
  reb: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  fgPct: number;
  tpm: number;
  tpa: number;
  tpPct: number;
  ftm: number;
  fta: number;
  ftPct: number;
  efgPct: number;
  tsPct: number;
}

function computeTeamGameTotals(rows: PlayerGameStat[], fallbackScore = 0): TeamGameTotals {
  const active = rows.filter((r) => !r.did_not_play);
  const sum = (fn: (r: PlayerGameStat) => number) =>
    active.reduce((acc, r) => acc + Number(fn(r) || 0), 0);

  const ptsSum = sum((r) => r.pts);
  const pts = ptsSum > 0 ? ptsSum : fallbackScore;
  const starterPts = active
    .filter((r) => r.starter)
    .reduce((acc, r) => acc + Number(r.pts || 0), 0);
  const benchPts = active
    .filter((r) => !r.starter)
    .reduce((acc, r) => acc + Number(r.pts || 0), 0);
  const reb = sum((r) => r.reb);
  const oreb = sum((r) => r.oreb);
  const dreb = sum((r) => r.dreb);
  const ast = sum((r) => r.ast);
  const stl = sum((r) => r.stl);
  const blk = sum((r) => r.blk);
  const tov = sum((r) => r.tov);
  const pf = sum((r) => r.pf);
  const fgm = sum((r) => r.fgm);
  const fga = sum((r) => r.fga);
  const tpm = sum((r) => r.tpm);
  const tpa = sum((r) => r.tpa);
  const ftm = sum((r) => r.ftm);
  const fta = sum((r) => r.fta);

  const fgPct = fga > 0 ? (fgm * 100) / fga : 0;
  const tpPct = tpa > 0 ? (tpm * 100) / tpa : 0;
  const ftPct = fta > 0 ? (ftm * 100) / fta : 0;
  const efgPct = fga > 0 ? ((fgm + 0.5 * tpm) * 100) / fga : 0;
  const tsDenom = 2 * (fga + 0.44 * fta);
  const tsPct = tsDenom > 0 ? (pts * 100) / tsDenom : 0;

  return {
    pts,
    starterPts,
    benchPts,
    reb,
    oreb,
    dreb,
    ast,
    stl,
    blk,
    tov,
    pf,
    fgm,
    fga,
    fgPct,
    tpm,
    tpa,
    tpPct,
    ftm,
    fta,
    ftPct,
    efgPct,
    tsPct,
  };
}

function getDefaultSectionForGame(g: Game, sport: 'basketball' | 'football'): ModalSection {
  if (g.status === 'scheduled') return 'betting';
  return sport === 'football' ? 'teamstats' : 'boxscore';
}

export function GameDetailModal({
  game: initialGame,
  sport = 'basketball',
  isPro,
  onClose,
  onSelectPlayer,
  onOpenProModal,
  onSelectGame: _onSelectGame,
  onSelectTeam,
}: GameDetailModalProps) {
  const [game, setGame] = useState<Game>(initialGame);
  const [historyStack, setHistoryStack] = useState<Game[]>([]);
  const [section, setSection] = useState<ModalSection>(() =>
    getDefaultSectionForGame(initialGame, sport),
  );
  const [historyTeamTab, setHistoryTeamTab] = useState<'away' | 'home' | 'h2h'>('away');
  const [stats, setStats] = useState<PlayerGameStat[]>([]);
  const [loadingBox, setLoadingBox] = useState(initialGame.status !== 'scheduled');
  const [betCtx, setBetCtx] = useState<AnyBettingContext | null>(null);
  const [loadingBet, setLoadingBet] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState<number>(initialGame.away_team_id);
  const [propsScope, setPropsScope] = useState<'all' | 'team' | 'player'>('all');
  const [propsStrategy, setPropsStrategy] = useState<'safe' | 'value' | 'all'>('safe');
  const [marketCategoryFilter, setMarketCategoryFilter] = useState<'all' | FootballMarketCategory>('all');
  const [propsOrder, setPropsOrder] = useState<'asc' | 'desc'>('desc');
  const [resultFilter, setResultFilter] = useState<PropResultFilter>('all');

  useEffect(() => {
    setHistoryStack([]);
    setGame(initialGame);
  }, [initialGame.id]);

  useEffect(() => {
    setGame((prev) => (prev.id === initialGame.id ? initialGame : prev));
  }, [initialGame]);

  useEffect(() => {
    setSection(getDefaultSectionForGame(game, sport));
    setActiveTeamId(game.away_team_id);
    setHistoryTeamTab('away');
    setResultFilter('all');
    setMarketCategoryFilter('all');
  }, [game.id, game.away_team_id, sport]);

  const handleOpenPastGame = (pastGame: Game) => {
    setHistoryStack((prev) => [...prev, game]);
    setGame(pastGame);
  };

  const handleHistoryBack = () => {
    setHistoryStack((prev) => {
      if (prev.length === 0) return prev;
      const target = prev[prev.length - 1];
      setGame(target);
      return prev.slice(0, -1);
    });
  };

  useEffect(() => {
    let active = true;
    if (game.status !== 'scheduled') {
      setLoadingBox(true);
      fetchGameBoxScore(game.id)
        .then((rows) => {
          if (active) setStats(rows);
        })
        .finally(() => {
          if (active) setLoadingBox(false);
        });
    } else {
      setStats([]);
      setLoadingBox(false);
    }

    setLoadingBet(true);
    const fetcher =
      sport === 'football' ? fetchFootballGameBettingContext(game) : fetchGameBettingContext(game);
    fetcher
      .then((ctx) => {
        if (active) setBetCtx(ctx);
      })
      .finally(() => {
        if (active) setLoadingBet(false);
      });

    return () => {
      active = false;
    };
  }, [game.id, sport]);

  // Auto-refresh scoreboard & boxscore every 15s + Realtime while modal is open
  useEffect(() => {
    let active = true;

    const refreshModalLive = async () => {
      try {
        const [freshGame, freshBox] = await Promise.all([
          fetchGameById(game.id),
          fetchGameBoxScore(game.id),
        ]);
        if (!active) return;
        if (freshGame) setGame(freshGame);
        setStats(freshBox);
      } catch {
        // Ignore transient network errors
      }
    };

    const interval = setInterval(() => {
      void refreshModalLive();
    }, 15_000);

    const channel = supabase
      .channel(`modal_game_${game.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games' },
        () => {
          void refreshModalLive();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'player_game_stats' },
        () => {
          void refreshModalLive();
        },
      )
      .subscribe();

    return () => {
      active = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [game.id]);

  const teamStats = stats.filter((s) => s.team_id === activeTeamId);
  const awayTotals = useMemo(
    () =>
      computeTeamGameTotals(
        stats.filter((s) => s.team_id === game.away_team_id),
        game.away_score,
      ),
    [stats, game.away_team_id, game.away_score],
  );
  const homeTotals = useMemo(
    () =>
      computeTeamGameTotals(
        stats.filter((s) => s.team_id === game.home_team_id),
        game.home_score,
      ),
    [stats, game.home_team_id, game.home_score],
  );
  const activeTotals = activeTeamId === game.away_team_id ? awayTotals : homeTotals;
  const periods = Math.max(
    game.home_linescores?.length ?? 0,
    game.away_linescores?.length ?? 0,
    4,
  );

  const outcome = useMemo(() => evaluateGameBettingResult(game), [game]);

  const bettingAnalysis = useMemo(() => {
    if (!betCtx) return null;
    const homeRecent = summarizeTeamRecent(game.home_team_id, betCtx.homeRecentGames);
    const awayRecent = summarizeTeamRecent(game.away_team_id, betCtx.awayRecentGames);
    if (sport === 'football') {
      const fbCtx = betCtx as FootballGameBettingContext;
      const fbInput = {
        game,
        homeStanding: fbCtx.homeStanding,
        awayStanding: fbCtx.awayStanding,
        homeTeamAvg: fbCtx.homeTeamAvg,
        awayTeamAvg: fbCtx.awayTeamAvg,
        homeRecent,
        awayRecent,
        homeRecentGames: fbCtx.homeRecentGames,
        awayRecentGames: fbCtx.awayRecentGames,
        keyPlayers: fbCtx.keyPlayers,
        playerRecentLogs: fbCtx.playerRecentLogs ?? [],
        playerStatuses: fbCtx.playerStatuses,
      };
      const insight = buildFootballMatchupInsight(
        game,
        fbCtx.homeStanding,
        fbCtx.awayStanding,
        fbCtx.homeTeamAvg,
        fbCtx.awayTeamAvg,
        homeRecent,
        awayRecent,
        fbCtx.homeRecentGames,
        fbCtx.awayRecentGames,
      );
      const propsRecs = buildFootballPropsRecommendations(fbInput);
      const fbProjections = computeFootballMatchProjections(fbInput);
      return { homeRecent, awayRecent, insight, propsRecs, fbProjections };
    }
    const nbaCtx = betCtx as GameBettingContext;
    const insight = buildMatchupBettingInsight(
      game,
      nbaCtx.homeStanding,
      nbaCtx.awayStanding,
      homeRecent,
      awayRecent,
      nbaCtx.homeRecentGames,
      nbaCtx.awayRecentGames,
    );
    const propsRecs = buildGamePropsRecommendations({
      game,
      homeStanding: nbaCtx.homeStanding,
      awayStanding: nbaCtx.awayStanding,
      homeTeamAvg: nbaCtx.homeTeamAvg,
      awayTeamAvg: nbaCtx.awayTeamAvg,
      homeRecent,
      awayRecent,
      homeRecentGames: nbaCtx.homeRecentGames,
      awayRecentGames: nbaCtx.awayRecentGames,
      keyPlayers: nbaCtx.keyPlayers,
      playerRecentLogs: nbaCtx.playerRecentLogs ?? [],
      playerStatuses: nbaCtx.playerStatuses,
    });
    return {
      homeRecent,
      awayRecent,
      insight,
      propsRecs,
      fbProjections: null as FootballMatchProjections | null,
    };
  }, [game, betCtx, sport]);

  const footballCategoryCounts = useMemo(() => {
    const strategyFiltered = (bettingAnalysis?.propsRecs ?? []).filter(
      (p) => propsStrategy === 'all' || ((p.strategy ?? 'value') as PropStrategyMode) === propsStrategy,
    );
    const counts: Record<string, number> = { all: strategyFiltered.length };
    if (sport !== 'football') return counts;
    for (const p of strategyFiltered) {
      const cat = p.marketCategory ?? (p.scope === 'player' ? 'player' : 'other');
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [bettingAnalysis, propsStrategy, sport]);

  const scopedProps = useMemo(() => {
    if (!bettingAnalysis) return [];
    const list = bettingAnalysis.propsRecs.filter((p) => {
      if (propsScope !== 'all' && p.scope !== propsScope) return false;
      if (propsStrategy !== 'all' && ((p.strategy ?? 'value') as PropStrategyMode) !== propsStrategy) {
        return false;
      }
      if (sport === 'football' && marketCategoryFilter !== 'all') {
        const cat = p.marketCategory ?? (p.scope === 'player' ? 'player' : 'other');
        if (cat !== marketCategoryFilter) return false;
      }
      return true;
    });
    return list.toSorted((a, b) =>
      propsOrder === 'asc' ? a.confidence - b.confidence : b.confidence - a.confidence,
    );
  }, [bettingAnalysis, propsScope, propsStrategy, sport, marketCategoryFilter, propsOrder]);

  const propsEffectiveness = useMemo(() => {
    if (game.status !== 'final' || scopedProps.length === 0) return null;
    return summarizeAnyGamePropsEffectiveness(scopedProps, game, stats, sport);
  }, [scopedProps, game, stats, sport]);

  const filteredProps = useMemo(() => {
    if (game.status !== 'final' || resultFilter === 'all') {
      return scopedProps;
    }
    return scopedProps.filter(
      (prop) => evaluateAnyPropStatus(prop, game, stats, sport)?.state === resultFilter,
    );
  }, [scopedProps, game, stats, sport, resultFilter]);

  const odds = game.odds;
  const hasBookLines = Boolean(
    odds &&
      (odds.home_moneyline != null ||
        odds.away_moneyline != null ||
        odds.home_spread != null ||
        odds.over_under != null),
  );
  const awayImplied = americanToImpliedProb(odds?.away_moneyline);
  const homeImplied = americanToImpliedProb(odds?.home_moneyline);

  return (
    <ModalDialog
      onClose={onClose}
      ariaLabelledBy="game-modal-title"
      maxWidthCss="56rem"
      borderClass="border border-white/[0.12]"
    >
      {(requestClose) => {
        const awayFinalsCount =
          betCtx?.awayRecentGames.filter((g) => g.status === 'final').length ?? 0;
        const homeFinalsCount =
          betCtx?.homeRecentGames.filter((g) => g.status === 'final').length ?? 0;
        const h2hFinalsCount =
          betCtx?.h2hGames?.filter((g) => g.status === 'final').length ?? 0;
        const totalHistoryCount = awayFinalsCount + homeFinalsCount;
        const prevStackGame =
          historyStack.length > 0 ? historyStack[historyStack.length - 1] : null;

        return (
        <div className="flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="shrink-0 p-3.5 sm:p-5 border-b border-white/[0.08] bg-[#12151c]">
          <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              {prevStackGame && (
                <button
                  type="button"
                  onClick={handleHistoryBack}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.12] text-slate-200 hover:bg-white/[0.1] hover:text-white transition-colors shrink-0"
                >
                  <ArrowLeft className="w-3 h-3" aria-hidden="true" />
                  Volver a {prevStackGame.away_team.abbreviation} vs {prevStackGame.home_team.abbreviation}
                </button>
              )}
              <h2
                id="game-modal-title"
                className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300 truncate"
              >
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {game.away_team.abbreviation} vs {game.home_team.abbreviation} ·{' '}
                  {game.status_detail || game.game_date}
                </span>
              </h2>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="p-1.5 rounded-full bg-white/[0.05] border border-white/[0.1] text-slate-300 hover:text-white cv-touch-target inline-flex items-center justify-center shrink-0"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* Matchup Scoreboard */}
          <div className="grid grid-cols-3 items-center gap-1.5 sm:gap-2 py-0.5 sm:py-1">
            {onSelectTeam ? (
              <button
                type="button"
                onClick={() => onSelectTeam(game.away_team, betCtx?.awayStanding ?? undefined)}
                className="flex flex-col items-center text-center min-w-0 hover:opacity-85 transition-opacity group"
              >
                {game.away_team.logo_url && (
                  <img
                    src={game.away_team.logo_url}
                    alt={game.away_team.abbreviation}
                    className="w-9 h-9 sm:w-12 sm:h-12 object-contain mb-1 sm:mb-1.5"
                  />
                )}
                <span className="font-bold text-xs sm:text-base truncate max-w-full group-hover:underline">
                  {game.away_team.short_name}
                </span>
                <span className="text-[11px] text-slate-400">
                  Visita
                  {betCtx?.awayStanding
                    ? sport === 'football'
                      ? ` · ${betCtx.awayStanding.wins}-${betCtx.awayStanding.draws ?? 0}-${betCtx.awayStanding.losses}`
                      : ` · ${betCtx.awayStanding.wins}-${betCtx.awayStanding.losses}`
                    : ''}
                </span>
              </button>
            ) : (
              <div className="flex flex-col items-center text-center min-w-0">
                {game.away_team.logo_url && (
                  <img
                    src={game.away_team.logo_url}
                    alt={game.away_team.abbreviation}
                    className="w-9 h-9 sm:w-12 sm:h-12 object-contain mb-1 sm:mb-1.5"
                  />
                )}
                <span className="font-bold text-xs sm:text-base truncate max-w-full">{game.away_team.short_name}</span>
                <span className="text-[11px] text-slate-400">
                  Visita
                  {betCtx?.awayStanding
                    ? sport === 'football'
                      ? ` · ${betCtx.awayStanding.wins}-${betCtx.awayStanding.draws ?? 0}-${betCtx.awayStanding.losses}`
                      : ` · ${betCtx.awayStanding.wins}-${betCtx.awayStanding.losses}`
                    : ''}
                </span>
              </div>
            )}

            <div className="flex flex-col items-center justify-center">
              <div className="flex items-center justify-center gap-1.5 sm:gap-5 tabular-nums">
                <span
                  className={`text-2xl sm:text-4xl font-bold ${
                    game.away_score >= game.home_score && game.status !== 'scheduled'
                      ? 'text-white'
                      : 'text-slate-400'
                  }`}
                >
                  {game.status === 'scheduled' ? '-' : game.away_score}
                </span>
                <span className="text-[11px] sm:text-xs font-semibold text-slate-500">VS</span>
                <span
                  className={`text-2xl sm:text-4xl font-bold ${
                    game.home_score >= game.away_score && game.status !== 'scheduled'
                      ? 'text-white'
                      : 'text-slate-400'
                  }`}
                >
                  {game.status === 'scheduled' ? '-' : game.home_score}
                </span>
              </div>
              {sport === 'football' &&
                game.status !== 'scheduled' &&
                (game.away_linescores?.length ?? 0) >= 2 &&
                (game.home_linescores?.length ?? 0) >= 2 && (
                  <div className="mt-1 text-[10px] font-semibold text-slate-400 tabular-nums">
                    1T: {game.away_linescores![0]}-{game.home_linescores![0]} · 2T:{' '}
                    {game.away_linescores![1]}-{game.home_linescores![1]}
                  </div>
                )}
            </div>

            {onSelectTeam ? (
              <button
                type="button"
                onClick={() => onSelectTeam(game.home_team, betCtx?.homeStanding ?? undefined)}
                className="flex flex-col items-center text-center min-w-0 hover:opacity-85 transition-opacity group"
              >
                {game.home_team.logo_url && (
                  <img
                    src={game.home_team.logo_url}
                    alt={game.home_team.abbreviation}
                    className="w-9 h-9 sm:w-12 sm:h-12 object-contain mb-1 sm:mb-1.5"
                  />
                )}
                <span className="font-bold text-xs sm:text-base truncate max-w-full group-hover:underline">
                  {game.home_team.short_name}
                </span>
                <span className="text-[11px] text-slate-400">
                  Local
                  {betCtx?.homeStanding
                    ? sport === 'football'
                      ? ` · ${betCtx.homeStanding.wins}-${betCtx.homeStanding.draws ?? 0}-${betCtx.homeStanding.losses}`
                      : ` · ${betCtx.homeStanding.wins}-${betCtx.homeStanding.losses}`
                    : ''}
                </span>
              </button>
            ) : (
              <div className="flex flex-col items-center text-center min-w-0">
                {game.home_team.logo_url && (
                  <img
                    src={game.home_team.logo_url}
                    alt={game.home_team.abbreviation}
                    className="w-9 h-9 sm:w-12 sm:h-12 object-contain mb-1 sm:mb-1.5"
                  />
                )}
                <span className="font-bold text-xs sm:text-base truncate max-w-full">{game.home_team.short_name}</span>
                <span className="text-[11px] text-slate-400">
                  Local
                  {betCtx?.homeStanding
                    ? sport === 'football'
                      ? ` · ${betCtx.homeStanding.wins}-${betCtx.homeStanding.draws ?? 0}-${betCtx.homeStanding.losses}`
                      : ` · ${betCtx.homeStanding.wins}-${betCtx.homeStanding.losses}`
                    : ''}
                </span>
              </div>
            )}
          </div>

          {/* Football Key Events Timeline (Goals & Cards) */}
          {sport === 'football' &&
            game.status !== 'scheduled' &&
            (game.sport_stats?.events?.length ?? 0) > 0 && (
              <div className="mt-3 rounded-lg bg-[#0b0d11] border border-white/[0.08] px-3 py-2 flex flex-wrap items-center justify-center gap-1.5 text-[11px] tabular-nums">
                {game.sport_stats!.events!.slice(0, 12).map((ev, idx) => {
                  const isGoal =
                    ev.kind === 'goal' || ev.kind === 'penalty' || ev.kind === 'own_goal';
                  const icon = isGoal ? '⚽' : ev.kind === 'red' ? '🟥' : '🟨';
                  return (
                    <span
                      key={`${ev.minute}_${idx}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.07] text-slate-200"
                    >
                      <span aria-hidden="true">{icon}</span>
                      <span className="font-semibold text-slate-400">{ev.minute}</span>
                      <span>{ev.player}</span>
                      {isGoal && ev.assist && (
                        <span className="text-[10px] text-emerald-300/90">· {ev.assist}</span>
                      )}
                      <span className="text-[10px] text-slate-400">({ev.team_abbr})</span>
                    </span>
                  );
                })}
              </div>
            )}

          {/* Linescores by Quarter (NBA) */}
          {sport !== 'football' &&
            game.status !== 'scheduled' &&
            (game.away_linescores?.length || game.home_linescores?.length) && (
              <div className="mt-3 rounded-lg bg-[#0b0d11] border border-white/[0.08] p-2.5 overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/[0.08]">
                      <th className="text-left py-1 px-2 font-medium">EQUIPO</th>
                      {Array.from({ length: periods }).map((_, i) => (
                        <th key={i} className="text-center py-1 px-2 font-medium">
                          {i < 4 ? `Q${i + 1}` : `OT${i - 3}`}
                        </th>
                      ))}
                      <th className="text-right py-1 px-2 font-bold text-slate-200">T</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1.5 px-2 font-semibold text-slate-200">
                        {game.away_team.abbreviation}
                      </td>
                      {Array.from({ length: periods }).map((_, i) => (
                        <td key={i} className="text-center py-1.5 px-2 text-slate-400">
                          {game.away_linescores?.[i] ?? '-'}
                        </td>
                      ))}
                      <td className="text-right py-1.5 px-2 font-bold text-white">
                        {game.away_score}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2 font-semibold text-slate-200">
                        {game.home_team.abbreviation}
                      </td>
                      {Array.from({ length: periods }).map((_, i) => (
                        <td key={i} className="text-center py-1.5 px-2 text-slate-400">
                          {game.home_linescores?.[i] ?? '-'}
                        </td>
                      ))}
                      <td className="text-right py-1.5 px-2 font-bold text-white">
                        {game.home_score}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

          {game.venue && (
            <div className="mt-2.5 flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <MapPin className="w-3 h-3 text-slate-400" aria-hidden="true" />
              <span>{game.venue}</span>
            </div>
          )}
        </div>

        {/* Primary Section Switcher */}
        <div className="shrink-0 flex border-b border-white/[0.08] bg-[#0e1117] px-3 pt-2 gap-1.5 overflow-x-auto no-scrollbar sb-scroll-fade-x">
          <button
            type="button"
            onClick={(e) => {
              setSection('betting');
              e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
            className={`shrink-0 px-3 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              section === 'betting'
                ? 'border-white text-white bg-white/[0.04]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Scale className="w-3.5 h-3.5" aria-hidden="true" />
            Líneas y previa
          </button>
          <button
            type="button"
            onClick={(e) => {
              setSection('teamstats');
              e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
            className={`shrink-0 px-3 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              section === 'teamstats'
                ? 'border-white text-white bg-white/[0.04]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" />
            Estadísticas de equipo
          </button>
          <button
            type="button"
            onClick={(e) => {
              setSection('history');
              e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
            className={`shrink-0 px-3 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              section === 'history'
                ? 'border-white text-white bg-white/[0.04]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" aria-hidden="true" />
            Historial
            {totalHistoryCount > 0 && (
              <span className="text-[10px] text-slate-400 tabular-nums">({totalHistoryCount + h2hFinalsCount})</span>
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              setSection('boxscore');
              e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
            className={`shrink-0 px-3 py-2.5 text-xs font-semibold rounded-t-lg border-b-2 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              section === 'boxscore'
                ? 'border-white text-white bg-white/[0.04]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Box Score jugadores
            {game.status === 'scheduled' && (
              <span className="text-[10px] text-slate-400 font-normal">(Previa)</span>
            )}
          </button>
        </div>

        {section === 'betting' ? (
          <div className="flex-1 min-h-0 overflow-auto sb-scroller p-4 sm:p-5 space-y-4">
            {/* Market Board */}
            <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    Líneas de referencia {odds?.provider ? `· ${odds.provider}` : ''}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Cuotas en formato decimal (ej. 1.91) y americano (-110) con probabilidad implícita.
                  </p>
                </div>
                {game.status === 'final' && odds && (
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                    {outcome.totalResult && (
                      <span
                        className={`px-2 py-0.5 rounded ${
                          outcome.totalResult === 'OVER'
                            ? 'bg-emerald-500/12 text-emerald-300'
                            : outcome.totalResult === 'UNDER'
                              ? 'bg-white/[0.08] text-slate-200'
                              : 'bg-white/[0.06] text-slate-300'
                        }`}
                      >
                        Total {outcome.totalPoints} · {outcome.totalResult}
                      </span>
                    )}
                    {outcome.spreadWinner && outcome.spreadWinner !== 'PUSH' && (
                      <span className="px-2 py-0.5 rounded bg-white/[0.06] text-slate-200">
                        Cubrió{' '}
                        {outcome.spreadWinner === 'home'
                          ? game.home_team.abbreviation
                          : game.away_team.abbreviation}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {odds ? (
                <>
                  {hasBookLines ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs tabular-nums">
                        <thead>
                          <tr className="text-slate-400 border-b border-white/[0.08]">
                            <th className="text-left py-2 pr-2 font-semibold">EQUIPO</th>
                            <th className="text-center py-2 px-2 font-semibold">GANADOR (ML)</th>
                            <th className="text-center py-2 px-2 font-semibold">HÁNDICAP</th>
                            <th className="text-center py-2 pl-2 font-semibold">TOTAL (O/U)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.06]">
                          <tr>
                            <td className="py-2.5 pr-2 font-semibold text-slate-100">
                              {game.away_team.abbreviation}{' '}
                              <span className="text-[10px] font-normal text-slate-400">Visita</span>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="font-bold text-white">
                                {formatDecimalOdds(odds.away_moneyline)}{' '}
                                <span className="text-slate-400 font-normal">
                                  ({formatAmericanOdds(odds.away_moneyline)})
                                </span>
                              </div>
                              {awayImplied != null && (
                                <div className="text-[10px] text-slate-400">
                                  Prob. {awayImplied.toFixed(0)}%
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="font-semibold text-slate-100">
                                {formatSpreadCompact(odds.away_spread)}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Cuota {formatDecimalOdds(odds.away_spread_odds)}
                              </div>
                            </td>
                            <td className="py-2.5 pl-2 text-center">
                              <div className="font-semibold text-slate-100">
                                Más {odds.over_under ?? '-'}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Cuota {formatDecimalOdds(odds.over_odds)}
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2.5 pr-2 font-semibold text-slate-100">
                              {game.home_team.abbreviation}{' '}
                              <span className="text-[10px] font-normal text-slate-400">Local</span>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="font-bold text-white">
                                {formatDecimalOdds(odds.home_moneyline)}{' '}
                                <span className="text-slate-400 font-normal">
                                  ({formatAmericanOdds(odds.home_moneyline)})
                                </span>
                              </div>
                              {homeImplied != null && (
                                <div className="text-[10px] text-slate-400">
                                  Prob. {homeImplied.toFixed(0)}%
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="font-semibold text-slate-100">
                                {formatSpreadCompact(odds.home_spread)}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Cuota {formatDecimalOdds(odds.home_spread_odds)}
                              </div>
                            </td>
                            <td className="py-2.5 pl-2 text-center">
                              <div className="font-semibold text-slate-100">
                                Menos {odds.over_under ?? '-'}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Cuota {formatDecimalOdds(odds.under_odds)}
                              </div>
                            </td>
                          </tr>
                          {sport === 'football' && odds.draw_moneyline != null && (
                            <tr>
                              <td className="py-2 pr-2 font-semibold text-slate-200">
                                EMPATE <span className="text-[10px] font-normal text-slate-400">1X2</span>
                              </td>
                              <td className="py-2 px-2 text-center">
                                <div className="font-bold text-white">
                                  {formatDecimalOdds(odds.draw_moneyline)}{' '}
                                  <span className="text-slate-400 font-normal">
                                    ({formatAmericanOdds(odds.draw_moneyline)})
                                  </span>
                                </div>
                              </td>
                              <td colSpan={2} className="py-2 px-2 text-center text-[11px] text-slate-400">
                                Mercado 90 minutos reglamentarios
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-[#12151c] border border-white/[0.08] p-3 text-xs text-slate-300">
                      Líneas de referencia aún pendientes de publicación para esta fecha. Puedes revisar la proyección estadística debajo.
                    </div>
                  )}

                  {/* Win Prob Predictor Bar if available */}
                  {(odds.away_win_prob != null || odds.home_win_prob != null) && (
                    <div className="pt-2 border-t border-white/[0.08] space-y-1.5">
                      <div className="flex justify-between text-[11px] font-semibold tabular-nums">
                        <span className="text-blue-400">
                          {game.away_team.abbreviation} {Number(odds.away_win_prob ?? 50).toFixed(1)}%
                        </span>
                        <span className="text-slate-400 font-normal">Modelo ESPN Predictor</span>
                        <span className="text-slate-200">
                          {Number(odds.home_win_prob ?? 50).toFixed(1)}% {game.home_team.abbreviation}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
                        <div
                          className="bg-blue-500"
                          style={{ width: `${odds.away_win_prob ?? 50}%` }}
                        />
                        <div
                          className="bg-slate-400"
                          style={{ width: `${odds.home_win_prob ?? 50}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Opening vs Current Line Movement */}
                  {bettingAnalysis && bettingAnalysis.insight.movements.length > 0 && (
                    <div className="rounded-lg bg-[#12151c] border border-white/[0.08] p-2.5 space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Movimiento de línea (Apertura → Actual)
                      </div>
                      {bettingAnalysis.insight.movements.map((mv) => (
                        <div key={mv} className="text-xs text-slate-200 font-medium">
                          • {mv}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-lg bg-[#12151c] border border-white/[0.08] p-4 text-xs text-slate-400">
                  Aún no hay líneas publicadas para este partido. Revisa debajo el resumen estadístico de ambos equipos.
                </div>
              )}
            </div>

            {/* Matchup Context */}
            {loadingBet ? (
              <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-5 text-center text-xs text-slate-400">
                Calculando tendencias y promedios reales de ambos equipos...
              </div>
            ) : (
              bettingAnalysis && (
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                    <TrendingUp className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    Radiografía estadística del cruce
                  </div>

                  {/* Football Match Line Projections Grid */}
                  {sport === 'football' &&
                    bettingAnalysis.fbProjections &&
                    (() => {
                      const fp = bettingAnalysis.fbProjections;
                      const cards = [
                        {
                          label: 'Goles Esp.',
                          val: fp.totalGoals.toFixed(1),
                          sub: `${game.away_team.abbreviation} ${fp.awayGoals.toFixed(1)} · ${game.home_team.abbreviation} ${fp.homeGoals.toFixed(1)}`,
                        },
                        fp.htTotalGoals != null
                          ? {
                              label: 'Goles 1T Esp.',
                              val: fp.htTotalGoals.toFixed(1),
                              sub: 'Primera mitad',
                            }
                          : null,
                        fp.bttsPct != null || fp.over25Pct != null
                          ? {
                              label: 'BTTS / +2.5',
                              val: `${fp.bttsPct != null ? `${Math.round(fp.bttsPct)}%` : '-'} / ${fp.over25Pct != null ? `${Math.round(fp.over25Pct)}%` : '-'}`,
                              sub: 'Ambos / Over 2.5',
                            }
                          : null,
                        fp.totalCorners != null
                          ? {
                              label: 'Córners Total',
                              val: fp.totalCorners.toFixed(1),
                              sub: `${game.away_team.abbreviation} ${fp.awayCorners?.toFixed(1) ?? '-'} · ${game.home_team.abbreviation} ${fp.homeCorners?.toFixed(1) ?? '-'}`,
                            }
                          : null,
                        fp.totalFouls != null
                          ? {
                              label: 'Faltas Total',
                              val: fp.totalFouls.toFixed(1),
                              sub: `${game.away_team.abbreviation} ${fp.awayFouls?.toFixed(1) ?? '-'} · ${game.home_team.abbreviation} ${fp.homeFouls?.toFixed(1) ?? '-'}`,
                            }
                          : null,
                        fp.totalCards != null
                          ? {
                              label: 'Amarillas Total',
                              val: fp.totalCards.toFixed(1),
                              sub: `${game.away_team.abbreviation} ${fp.awayCards?.toFixed(1) ?? '-'} · ${game.home_team.abbreviation} ${fp.homeCards?.toFixed(1) ?? '-'}`,
                            }
                          : null,
                        fp.totalShots != null
                          ? {
                              label: 'Remates / Arco',
                              val: fp.totalShots.toFixed(1),
                              sub: `${fp.totalSot?.toFixed(1) ?? '-'} al arco`,
                            }
                          : null,
                        {
                          label: 'Modelo 1X2',
                          val: `${Math.round(fp.homeWinProb)}% / ${Math.round(fp.drawProb)}% / ${Math.round(fp.awayWinProb)}%`,
                          sub: `${game.home_team.abbreviation} · X · ${game.away_team.abbreviation}`,
                        },
                      ].filter((c): c is { label: string; val: string; sub: string } => c !== null);

                      return (
                        <div className="space-y-1.5">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Proyecciones de Líneas del Partido
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 tabular-nums">
                            {cards.map((c) => (
                              <div
                                key={c.label}
                                className="rounded-lg bg-[#12151c] border border-white/[0.08] p-2.5"
                              >
                                <div className="text-[10px] text-slate-400 font-medium">{c.label}</div>
                                <div className="text-sm font-bold text-white mt-0.5">{c.val}</div>
                                <div className="text-[10px] text-slate-400 truncate mt-0.5">{c.sub}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                  {/* Matchup Signals */}
                  {bettingAnalysis.insight.signals.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {bettingAnalysis.insight.signals.map((sig) => (
                        <div
                          key={sig.title}
                          className="rounded-lg border p-3 bg-[#12151c] border-white/[0.08]"
                        >
                          <div className="text-xs font-bold text-white">{sig.title}</div>
                          <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                            {sig.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Team Recent Games & Season Metrics Comparison */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 tabular-nums">
                    {[
                      {
                        team: game.away_team,
                        role: 'Visita',
                        st: betCtx?.awayStanding ?? null,
                        rec: bettingAnalysis.awayRecent,
                        recentGames: betCtx?.awayRecentGames ?? [],
                        locRec: betCtx?.awayStanding?.away_record,
                      },
                      {
                        team: game.home_team,
                        role: 'Local',
                        st: betCtx?.homeStanding ?? null,
                        rec: bettingAnalysis.homeRecent,
                        recentGames: betCtx?.homeRecentGames ?? [],
                        locRec: betCtx?.homeStanding?.home_record,
                      },
                    ].map((side) => {
                      const fbRecentWdl =
                        sport === 'football'
                          ? side.recentGames
                              .filter((g) => g.status === 'final')
                              .reduce(
                                (acc, g) => {
                                  const isH = g.home_team_id === side.team.id;
                                  const gf = isH ? g.home_score : g.away_score;
                                  const ga = isH ? g.away_score : g.home_score;
                                  if (gf > ga) acc.w += 1;
                                  else if (gf === ga) acc.d += 1;
                                  else acc.l += 1;
                                  return acc;
                                },
                                { w: 0, d: 0, l: 0 },
                              )
                          : null;
                      return (
                      <div
                        key={side.team.id}
                        className="rounded-lg bg-[#12151c] border border-white/[0.08] p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">
                            {side.team.short_name}{' '}
                            <span className="text-slate-400 font-normal">({side.role})</span>
                          </span>
                          <span className="text-[11px] font-semibold text-slate-200">
                            {side.st
                              ? sport === 'football'
                                ? `${side.st.wins}-${side.st.draws ?? 0}-${side.st.losses}`
                                : `${side.st.wins}-${side.st.losses}`
                              : '-'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-y-1.5 text-[11px] text-slate-300">
                          <div>
                            Récord {side.role}: <strong className="text-white">{side.locRec || '-'}</strong>
                          </div>
                          <div>
                            Últ. 10: <strong className="text-white">{side.st?.last_ten || '-'}</strong>
                          </div>
                          <div>
                            Anota / Recibe:{' '}
                            <strong className="text-white">
                              {side.st?.ppg != null ? Number(side.st.ppg).toFixed(1) : side.rec.avgFor.toFixed(1)}
                              {' / '}
                              {side.st?.oppg != null ? Number(side.st.oppg).toFixed(1) : side.rec.avgAgainst.toFixed(1)}
                            </strong>
                          </div>
                          <div>
                            Margen neto:{' '}
                            <strong
                              className={
                                Number(side.st?.diff ?? side.rec.avgMargin) >= 0
                                  ? 'text-emerald-300'
                                  : 'text-rose-300'
                              }
                            >
                              {Number(side.st?.diff ?? side.rec.avgMargin) >= 0 ? '+' : ''}
                              {Number(side.st?.diff ?? side.rec.avgMargin).toFixed(1)}
                            </strong>
                          </div>
                          {side.rec.gamesCount > 0 && (
                            <>
                              <div>
                                Últ. {side.rec.gamesCount} PJ:{' '}
                                <strong className="text-white">
                                  {fbRecentWdl
                                    ? `${fbRecentWdl.w}-${fbRecentWdl.d}-${fbRecentWdl.l}`
                                    : `${side.rec.wins}-${side.rec.losses}`}
                                </strong>
                              </div>
                              <div>
                                Prom. total PJ:{' '}
                                <strong className="text-white">
                                  {side.rec.avgCombined.toFixed(1)}{' '}
                                  {sport === 'football' ? 'goles' : 'pts'}
                                </strong>
                              </div>
                            </>
                          )}
                          {side.rec.overTracked > 0 && (
                            <div>
                              Over rec.:{' '}
                              <strong className="text-slate-100">
                                {side.rec.overHits}/{side.rec.overTracked}
                              </strong>
                            </div>
                          )}
                          {side.rec.atsTracked > 0 && (
                            <div>
                              Cubrió ATS:{' '}
                              <strong className="text-slate-100">
                                {side.rec.atsWins}/{side.rec.atsTracked}
                              </strong>
                            </div>
                          )}
                        </div>
                        {(() => {
                          const formList = side.recentGames
                            .filter((rg) => rg.status === 'final')
                            .slice(0, 5)
                            .map((rg) => {
                              const isH = rg.home_team_id === side.team.id;
                              const gf = isH ? rg.home_score : rg.away_score;
                              const ga = isH ? rg.away_score : rg.home_score;
                              return {
                                id: rg.id,
                                res: gf > ga ? 'G' : gf === ga ? 'E' : 'P',
                              };
                            });
                          if (formList.length === 0) return null;
                          return (
                            <div className="pt-1 flex items-center gap-1 text-[10px]">
                              <span className="text-slate-400 mr-1">Racha:</span>
                              {formList.map((f) => (
                                <span
                                  key={f.id}
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded font-bold border ${
                                    f.res === 'G'
                                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                      : f.res === 'P'
                                        ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                                        : 'bg-white/[0.06] text-slate-300 border-white/[0.12]'
                                  }`}
                                >
                                  {f.res}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      );
                    })}
                  </div>

                  {(betCtx?.awayRecentGames.length || betCtx?.homeRecentGames.length) ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setSection('history')}
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#12151c] border border-white/[0.1] text-slate-200 hover:border-white/[0.25] hover:text-white transition-colors"
                      >
                        <History className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                        Ver partidos jugados con estadísticas
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}

                  {/* Quick Guide Tip */}
                  <p className="text-[11px] text-slate-400 leading-relaxed bg-[#12151c] rounded-lg px-3 py-2 border border-white/[0.06]">
                    {sport === 'football' ? (
                      <>
                        <strong className="text-slate-200">Referencia fútbol:</strong> en líneas{' '}
                        <span className="text-slate-100 font-semibold">O/U</span> de Córners, Faltas,
                        Tarjetas o Goles 1T, las líneas terminadas en .0 devuelven apuesta en empate;
                        en Hándicap Asiático, <span className="text-slate-100 font-semibold">-0.5</span>{' '}
                        exige ganar y <span className="text-slate-100 font-semibold">+0.5</span> cubre
                        con empate o victoria. Toca cualquier mercado abajo para simular tu línea.
                      </>
                    ) : (
                      <>
                        <strong className="text-slate-200">Referencia:</strong> en Hándicap,{' '}
                        <span className="text-slate-100 font-semibold">-8.5</span> exige ganar por 9+
                        puntos y <span className="text-slate-100 font-semibold">+8.5</span> cubre aunque
                        pierda hasta por 8 puntos. Toca cualquier jugador abajo para revisar su tendencia de 15 partidos.
                      </>
                    )}
                  </p>
                </div>
              )
            )}

            {/* Data-Driven Props Recommendations (Team & Player Markets) */}
            {bettingAnalysis && bettingAnalysis.propsRecs.length > 0 && (
              <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                      <Target className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                      Mercados analizados ({filteredProps.length})
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {sport === 'football'
                        ? 'Córners, Faltas, Tarjetas, Goles, 1X2 y Jugadores · Ordenado por índice.'
                        : 'Cruce por MPG, Local/Visita y B2B · Ordenado por índice.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setPropsOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-[#12151c] border border-white/[0.1] text-slate-200 hover:border-white/[0.2] transition-colors"
                  >
                    <ArrowUpDown className="w-3 h-3 text-slate-400" aria-hidden="true" />
                    {propsOrder === 'desc' ? 'Mayor → Menor' : 'Menor → Mayor'}
                  </button>
                </div>

                {/* Strategy & Scope Filters */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex rounded-lg bg-[#0b0d11] border border-white/[0.08] p-0.5">
                    {(
                      [
                        { key: 'safe', label: 'Seguras' },
                        { key: 'value', label: 'Valor' },
                        { key: 'all', label: 'Todas' },
                      ] as const
                    ).map((s) => {
                      const active = propsStrategy === s.key;
                      return (
                        <button
                          key={s.key}
                          type="button"
                          onClick={() => setPropsStrategy(s.key)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                            active
                              ? s.key === 'safe'
                                ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/35'
                                : 'cv-tab-active'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(
                      [
                        { key: 'all', label: 'Todos', icon: null },
                        { key: 'team', label: 'Equipos', icon: Shield },
                        { key: 'player', label: 'Jugadores', icon: User },
                      ] as const
                    ).map((f) => {
                      const Icon = f.icon;
                      const active = propsScope === f.key;
                      return (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => {
                            setPropsScope(f.key);
                            setMarketCategoryFilter('all');
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                            active
                              ? 'cv-tab-active'
                              : 'bg-[#12151c] text-slate-300 border-white/[0.08] hover:border-white/[0.2]'
                          }`}
                        >
                          {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
                          {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Football Market Category Filter Pills */}
                {sport === 'football' && (footballCategoryCounts.all ?? 0) > 0 && (
                  <div
                    role="region"
                    aria-label="Categorías de mercados de fútbol"
                    className="flex items-center gap-1.5 overflow-x-auto no-scrollbar sb-scroll-fade-x pb-0.5"
                  >
                    {FOOTBALL_MARKET_CATEGORY_TABS.filter(
                      (c) => (footballCategoryCounts[c.key] ?? 0) > 0,
                    ).map((cat) => {
                      const active = marketCategoryFilter === cat.key;
                      const count = footballCategoryCounts[cat.key] ?? 0;
                      return (
                        <button
                          key={cat.key}
                          type="button"
                          aria-pressed={active}
                          onClick={(e) => {
                            setMarketCategoryFilter(cat.key);
                            if (cat.key !== 'all') setPropsScope('all');
                            e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                          }}
                          className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap tabular-nums ${
                            active
                              ? 'cv-tab-active'
                              : 'bg-[#12151c] text-slate-300 border-white/[0.08] hover:border-white/[0.2] hover:text-white'
                          }`}
                        >
                          {cat.label} ({count})
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Post-game Props Effectiveness Summary */}
                {propsEffectiveness && (
                  <PropsEffectivenessCard
                    summary={propsEffectiveness}
                    variant="full"
                    isPro={isPro}
                    resultFilter={resultFilter}
                    onChangeResultFilter={setResultFilter}
                  />
                )}

                {/* Props List */}
                <div className="space-y-2.5">
                  {filteredProps.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 rounded-lg bg-[#12151c] border border-white/[0.07]">
                      No hay props en esta categoría para el filtro actual.
                    </div>
                  ) : (
                    filteredProps.map((prop) => {
                      const locked = !isPro && isHighProbabilityProp(prop.confidence);
                      const propStatus = evaluateAnyPropStatus(prop, game, stats, sport);
                      const showPostGameLockedBadge =
                        locked && game.status === 'final' && propStatus && (propStatus.state === 'won' || propStatus.state === 'lost');
                      const statusPillClass =
                        propStatus?.state === 'won'
                          ? 'bg-emerald-500/12 text-emerald-300 border-emerald-500/25'
                          : propStatus?.state === 'lost'
                            ? 'bg-rose-500/12 text-rose-300 border-rose-500/25'
                            : 'bg-white/[0.06] text-slate-200 border-white/[0.1]';
                      const pickBadgeClass =
                        prop.pick === 'OVER' || prop.pick === 'DC'
                          ? 'sb-neon-over'
                          : prop.pick === 'UNDER'
                            ? 'sb-neon-under'
                            : 'bg-white/[0.08] text-slate-100 border-white/[0.14]';
                      const barColorClass =
                        prop.confidence >= 80
                          ? 'bg-blue-400'
                          : prop.confidence >= 68
                            ? 'bg-slate-300'
                            : 'bg-slate-500';

                      return (
                        <div
                          key={prop.id}
                          onClick={
                            locked
                              ? onOpenProModal
                              : prop.playerId
                                ? () => onSelectPlayer(prop.playerId!)
                                : undefined
                          }
                          className={`rounded-lg bg-[#12151c] border border-white/[0.08] p-3 space-y-2 transition-colors ${
                            locked || prop.playerId ? 'cursor-pointer hover:border-white/[0.2]' : ''
                          }`}
                        >
                          {/* Header row */}
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border bg-white/[0.04] text-slate-300 border-white/[0.08]">
                                {prop.scope === 'team' ? 'Equipo' : 'Jugador'}
                              </span>
                              <span className="text-xs font-bold text-white truncate">
                                {prop.subjectName}
                              </span>
                              <span className="text-[11px] text-slate-400 truncate">
                                · {prop.marketLabel}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 tabular-nums">
                              {!locked && propStatus && (
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${statusPillClass}`}
                                >
                                  {propStatus.label}
                                </span>
                              )}
                              {showPostGameLockedBadge && (
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${statusPillClass}`}
                                >
                                  {propStatus.state === 'won' ? 'Salió (Pro)' : 'No salió (Pro)'}
                                </span>
                              )}
                              {!locked && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300 border border-white/[0.08]">
                                  {prop.estimatedMultiplier.toFixed(2)}x
                                </span>
                              )}
                              {locked ? (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded sb-pro-pill">
                                  <Lock className="w-3 h-3" aria-hidden="true" />
                                  Plan Pro
                                </span>
                              ) : (
                                <span
                                  className={`text-xs font-bold px-2.5 py-0.5 rounded border ${pickBadgeClass}`}
                                >
                                  {prop.pickLabel}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Stats vs Market */}
                          {locked ? (
                            <div className="rounded-lg bg-[#0b0d11] px-3 py-2 border border-white/[0.07] text-[11px] text-slate-300 flex items-center justify-between gap-2">
                              <span>
                                Análisis avanzado ({PRO_CONFIDENCE_THRESHOLD}%+). Incluido en Plan Pro
                                {!isNativeAndroid() ? ' ($5 USD o S/ 19)' : ''}.
                              </span>
                            <span className="text-white font-semibold underline shrink-0">
                              Ver Plan Pro
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] bg-[#0b0d11] rounded-lg px-2.5 py-2 border border-white/[0.07] tabular-nums">
                              <div className="text-slate-300">
                                <span className="text-slate-400 font-medium">Estadística: </span>
                                {prop.statSummary}
                              </div>
                              <div className="text-slate-200 sm:text-right">
                                <span className="text-slate-400 font-medium">Referencia: </span>
                                <strong className="text-white">{prop.marketLineText}</strong>
                              </div>
                            </div>
                            {prop.contextBadges.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {prop.contextBadges.map((b, idx) => (
                                  <span
                                    key={`${b.label}_${idx}`}
                                    className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-300 border border-white/[0.08] tabular-nums"
                                  >
                                    {b.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Rationale + Confidence Meter */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
                          <p className="text-[11px] text-slate-400 flex-1 min-w-[200px]">
                            {locked
                              ? 'Pronóstico, línea exacta y respaldo estadístico disponibles en el Plan Pro.'
                              : prop.rationale}
                          </p>
                          <div className="flex items-center gap-2 shrink-0 tabular-nums">
                            <div className="w-20 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                              <div
                                className={`h-full rounded-full ${barColorClass}`}
                                style={{ width: `${prop.confidence}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-white">
                              {prop.confidence}%
                            </span>
                            <span className="text-[10px] font-medium text-slate-400">
                              ({prop.confidenceTier})
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                  )}
                </div>
              </div>
            )}

            {/* Key Players for Props Drill-Down */}
            {betCtx && betCtx.keyPlayers.length > 0 && (
              <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                  <Flame className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  Figuras del partido · Gráfica y tendencias
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {betCtx.keyPlayers.slice(0, 6).map((p) => (
                    <button
                      key={p.player_id}
                      type="button"
                      onClick={() => onSelectPlayer(p.player_id)}
                      className="flex items-center justify-between gap-2 rounded-lg bg-[#12151c] hover:bg-[#181c25] border border-white/[0.08] px-3 py-2 text-left transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">
                          {p.full_name}{' '}
                          <span className="text-[10px] text-slate-400 font-normal">
                            ({p.team_abbreviation})
                          </span>
                        </div>
                        {sport === 'football' ? (
                          (() => {
                            const fp = p as unknown as FootballPlayerSeasonAverage;
                            return (
                              <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                                <strong className="text-slate-100">{fp.goals}</strong> G ·{' '}
                                {fp.assists} A · {fp.shots} REM ({fp.shots_on_target} arco)
                              </div>
                            );
                          })()
                        ) : (
                          (() => {
                            const bp = p as GameBettingContext['keyPlayers'][number];
                            return (
                              <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                                <strong className="text-slate-100">{Number(bp.ppg).toFixed(1)}</strong> PTS ·{' '}
                                {Number(bp.rpg).toFixed(1)} REB · {Number(bp.apg).toFixed(1)} AST
                              </div>
                            );
                          })()
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : section === 'teamstats' ? (
          sport === 'football' ? (
            <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
              {game.status !== 'scheduled' && (() => {
                const hs = game.sport_stats?.home;
                const as_ = game.sport_stats?.away;
                const tracked = hasFootballBoxTracking(game);
                const ht = extractHalfTimeGoals(game);
                const totalGoals = game.home_score + game.away_score;
                const totCorners =
                  tracked && hs?.corners != null && as_?.corners != null
                    ? Number(hs.corners) + Number(as_.corners)
                    : null;
                const totFouls =
                  tracked && hs?.fouls != null && as_?.fouls != null
                    ? Number(hs.fouls) + Number(as_.fouls)
                    : null;
                const totYellow =
                  hs?.yellow_cards != null && as_?.yellow_cards != null
                    ? Number(hs.yellow_cards) + Number(as_.yellow_cards)
                    : null;
                const totRed = Number(hs?.red_cards ?? 0) + Number(as_?.red_cards ?? 0);
                const totShots =
                  tracked && hs?.shots != null && as_?.shots != null
                    ? Number(hs.shots) + Number(as_.shots)
                    : null;
                const totSot =
                  tracked && hs?.shots_on_target != null && as_?.shots_on_target != null
                    ? Number(hs.shots_on_target) + Number(as_.shots_on_target)
                    : null;
                const htText =
                  Array.isArray(game.away_linescores) &&
                  game.away_linescores.length >= 2 &&
                  Array.isArray(game.home_linescores) &&
                  game.home_linescores.length >= 2
                    ? `1T: ${game.away_linescores[0]}-${game.home_linescores[0]} · 2T: ${game.away_linescores[1]}-${game.home_linescores[1]}`
                    : ht
                      ? `1T: ${ht.total} gol(es)`
                      : 'Resultado';
                const kpis = [
                  { label: 'Goles', val: `${game.away_score} - ${game.home_score}`, sub: htText },
                  totCorners != null
                    ? {
                        label: 'Córners Tot.',
                        val: String(totCorners),
                        sub: `${as_!.corners} - ${hs!.corners}`,
                      }
                    : null,
                  totFouls != null
                    ? {
                        label: 'Faltas Tot.',
                        val: String(totFouls),
                        sub: `${as_!.fouls} - ${hs!.fouls}`,
                      }
                    : null,
                  totYellow != null
                    ? {
                        label: 'Tarjetas A/R',
                        val: `${totYellow} TA${totRed > 0 ? ` · ${totRed} TR` : ''}`,
                        sub: `${as_?.yellow_cards ?? 0} - ${hs?.yellow_cards ?? 0}`,
                      }
                    : null,
                  totShots != null
                    ? {
                        label: 'Remates / Arco',
                        val: `${totShots} (${totSot ?? 0})`,
                        sub: `${as_!.shots}-${hs!.shots} (${as_?.shots_on_target ?? 0}-${hs?.shots_on_target ?? 0})`,
                      }
                    : null,
                  game.status === 'final'
                    ? {
                        label: 'BTTS / +2.5',
                        val: `${game.home_score > 0 && game.away_score > 0 ? 'SÍ' : 'NO'} / ${totalGoals >= 3 ? 'SÍ' : 'NO'}`,
                        sub: `Total ${totalGoals} goles`,
                      }
                    : null,
                ].filter((x): x is { label: string; val: string; sub: string } => x != null);
                if (kpis.length === 0) return null;
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 tabular-nums">
                    {kpis.map((k) => (
                      <div
                        key={k.label}
                        className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-2.5 text-center"
                      >
                        <div className="text-[10px] font-semibold uppercase text-slate-400">
                          {k.label}
                        </div>
                        <div className="text-sm font-bold text-white mt-0.5">{k.val}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">{k.sub}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {game.status !== 'scheduled' && game.sport_stats?.home && game.sport_stats?.away && (
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 space-y-3.5 tabular-nums">
                  <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                    <span className="text-xs font-bold text-blue-400">{game.away_team.short_name}</span>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                      Estadísticas del partido
                    </span>
                    <span className="text-xs font-bold text-slate-200">{game.home_team.short_name}</span>
                  </div>
                  <div className="space-y-3">
                    {[
                      {
                        label: 'Posesión (%)',
                        a: Number(game.sport_stats.away.possession_pct ?? 50),
                        h: Number(game.sport_stats.home.possession_pct ?? 50),
                        suffix: '%',
                      },
                      {
                        label: 'Remates Totales',
                        a: Number(game.sport_stats.away.shots ?? 0),
                        h: Number(game.sport_stats.home.shots ?? 0),
                      },
                      {
                        label: 'Remates al Arco',
                        a: Number(game.sport_stats.away.shots_on_target ?? 0),
                        h: Number(game.sport_stats.home.shots_on_target ?? 0),
                      },
                      {
                        label: 'Tiros de Esquina (Córners)',
                        a: Number(game.sport_stats.away.corners ?? 0),
                        h: Number(game.sport_stats.home.corners ?? 0),
                      },
                      {
                        label: 'Atajadas',
                        a: Number(game.sport_stats.away.saves ?? 0),
                        h: Number(game.sport_stats.home.saves ?? 0),
                      },
                      {
                        label: 'Fueras de Juego',
                        a: Number(game.sport_stats.away.offsides ?? 0),
                        h: Number(game.sport_stats.home.offsides ?? 0),
                        lowerIsBetter: true,
                      },
                      {
                        label: 'Faltas Cometidas',
                        a: Number(game.sport_stats.away.fouls ?? 0),
                        h: Number(game.sport_stats.home.fouls ?? 0),
                        lowerIsBetter: true,
                      },
                      {
                        label: 'Tarjetas Amarillas',
                        a: Number(game.sport_stats.away.yellow_cards ?? 0),
                        h: Number(game.sport_stats.home.yellow_cards ?? 0),
                        lowerIsBetter: true,
                      },
                      ...(
                        [
                          { label: 'Tarjetas Rojas', key: 'red_cards', lowerIsBetter: true },
                          { label: 'Efectividad de Tiro (%)', key: 'shot_pct', suffix: '%', scaleUnitFraction: true },
                          { label: 'Pases Totales', key: 'total_passes' },
                          { label: 'Pases Precisos', key: 'accurate_passes' },
                          { label: 'Precisión Pase (%)', key: 'pass_pct', suffix: '%', scaleUnitFraction: true },
                          { label: 'Tiros Bloqueados', key: 'blocked_shots' },
                          { label: 'Entradas', key: 'tackles' },
                          { label: 'Entradas Efectivas', key: 'effective_tackles' },
                          { label: 'Intercepciones', key: 'interceptions' },
                          { label: 'Centros Totales', key: 'crosses' },
                          { label: 'Centros Precisos', key: 'accurate_crosses' },
                          { label: 'Despejes', key: 'clearances' },
                          { label: 'Goles de Penal', key: 'penalty_goals' },
                        ] as const
                      ).flatMap((ext) => {
                        const aVal = game.sport_stats?.away?.[ext.key];
                        const hVal = game.sport_stats?.home?.[ext.key];
                        if (aVal == null && hVal == null) return [];
                        let aNum = Number(aVal ?? 0);
                        let hNum = Number(hVal ?? 0);
                        if (aNum === 0 && hNum === 0 && ext.key !== 'red_cards') return [];
                        if ('scaleUnitFraction' in ext && ext.scaleUnitFraction) {
                          if (aNum > 0 && aNum <= 1) aNum *= 100;
                          if (hNum > 0 && hNum <= 1) hNum *= 100;
                        }
                        return [
                          {
                            label: ext.label,
                            a: aNum,
                            h: hNum,
                            lowerIsBetter: 'lowerIsBetter' in ext ? ext.lowerIsBetter : undefined,
                            suffix: 'suffix' in ext ? ext.suffix : undefined,
                          },
                        ];
                      }),
                    ].map((r) => {
                      const posA = Math.max(0.1, r.a);
                      const posH = Math.max(0.1, r.h);
                      const pctA = Math.round((posA / (posA + posH)) * 100);
                      const aBetter = r.lowerIsBetter ? r.a <= r.h : r.a >= r.h;
                      const hBetter = r.lowerIsBetter ? r.h <= r.a : r.h >= r.a;
                      const s = r.suffix ?? '';
                      return (
                        <div key={r.label}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className={aBetter ? 'font-bold text-blue-400' : 'text-slate-400'}>
                              {r.suffix ? r.a.toFixed(1) : r.a}
                              {s}
                            </span>
                            <span className="font-medium text-slate-300">{r.label}</span>
                            <span className={hBetter ? 'font-bold text-slate-100' : 'text-slate-400'}>
                              {r.suffix ? r.h.toFixed(1) : r.h}
                              {s}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
                            <div className="bg-blue-500 transition-all" style={{ width: `${pctA}%` }} />
                            <div className="bg-slate-400 transition-all" style={{ width: `${100 - pctA}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {game.status !== 'scheduled' && (game.sport_stats?.events?.length ?? 0) > 0 && (
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 space-y-2.5 tabular-nums">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Cronología completa del partido ({game.sport_stats!.events!.length})
                  </div>
                  <div className="divide-y divide-white/[0.06]">
                    {game.sport_stats!.events!.map((ev, idx) => {
                      const isGoal =
                        ev.kind === 'goal' || ev.kind === 'penalty' || ev.kind === 'own_goal';
                      const icon = isGoal ? '⚽' : ev.kind === 'red' ? '🟥' : '🟨';
                      return (
                        <div
                          key={`${ev.minute}_${idx}`}
                          className="py-1.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span aria-hidden="true">{icon}</span>
                            <span className="font-bold text-slate-300 w-10 shrink-0">
                              {ev.minute}
                            </span>
                            <span className="font-semibold text-white truncate">{ev.player}</span>
                            {ev.assist && (
                              <span className="text-[11px] text-emerald-300/90 truncate">
                                Asist. {ev.assist}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-400">
                            <span>{ev.label}</span>
                            <span className="px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-200 font-semibold">
                              {ev.team_abbr}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(() => {
                const fbCtx = betCtx as FootballGameBettingContext | null;
                if (!fbCtx?.awayTeamAvg || !fbCtx?.homeTeamAvg) return null;
                const aT = fbCtx.awayTeamAvg;
                const hT = fbCtx.homeTeamAvg;
                const rows: Array<{
                  label: string;
                  a: number;
                  h: number;
                  dec: number;
                  lowerIsBetter?: boolean;
                  suffix?: string;
                }> = [
                  { label: 'Goles a Favor / PJ', a: Number(aT.gf_pg ?? 0), h: Number(hT.gf_pg ?? 0), dec: 2 },
                  { label: 'Goles Recibidos / PJ', a: Number(aT.ga_pg ?? 0), h: Number(hT.ga_pg ?? 0), dec: 2, lowerIsBetter: true },
                  ...(aT.ht_gf_pg != null || hT.ht_gf_pg != null
                    ? [{ label: 'Goles 1T a Favor / PJ', a: Number(aT.ht_gf_pg ?? 0), h: Number(hT.ht_gf_pg ?? 0), dec: 2 }]
                    : []),
                  { label: 'Posesión Promedio', a: Number(aT.possession_avg ?? 50), h: Number(hT.possession_avg ?? 50), dec: 1, suffix: '%' },
                  ...(aT.shots_pg != null || hT.shots_pg != null
                    ? [{ label: 'Remates / PJ', a: Number(aT.shots_pg ?? 0), h: Number(hT.shots_pg ?? 0), dec: 1 }]
                    : []),
                  ...(aT.sot_pg != null || hT.sot_pg != null
                    ? [{ label: 'Al Arco / PJ', a: Number(aT.sot_pg ?? 0), h: Number(hT.sot_pg ?? 0), dec: 1 }]
                    : []),
                  ...(aT.corners_pg != null || hT.corners_pg != null
                    ? [{ label: 'Córners / PJ', a: Number(aT.corners_pg ?? 0), h: Number(hT.corners_pg ?? 0), dec: 1 }]
                    : []),
                  ...(aT.corners_against_pg != null || hT.corners_against_pg != null
                    ? [{ label: 'Córners Concedidos / PJ', a: Number(aT.corners_against_pg ?? 0), h: Number(hT.corners_against_pg ?? 0), dec: 1 }]
                    : []),
                  ...(aT.fouls_pg != null || hT.fouls_pg != null
                    ? [{ label: 'Faltas Cometidas / PJ', a: Number(aT.fouls_pg ?? 0), h: Number(hT.fouls_pg ?? 0), dec: 1, lowerIsBetter: true }]
                    : []),
                  ...(aT.fouls_drawn_pg != null || hT.fouls_drawn_pg != null
                    ? [{ label: 'Faltas Recibidas / PJ', a: Number(aT.fouls_drawn_pg ?? 0), h: Number(hT.fouls_drawn_pg ?? 0), dec: 1 }]
                    : []),
                  ...(aT.yellow_cards_pg != null || hT.yellow_cards_pg != null
                    ? [{ label: 'Amarillas / PJ', a: Number(aT.yellow_cards_pg ?? 0), h: Number(hT.yellow_cards_pg ?? 0), dec: 2, lowerIsBetter: true }]
                    : []),
                  ...(aT.offsides_pg != null || hT.offsides_pg != null
                    ? [{ label: 'Fueras de Juego / PJ', a: Number(aT.offsides_pg ?? 0), h: Number(hT.offsides_pg ?? 0), dec: 1, lowerIsBetter: true }]
                    : []),
                  ...(aT.saves_pg != null || hT.saves_pg != null
                    ? [{ label: 'Atajadas / PJ', a: Number(aT.saves_pg ?? 0), h: Number(hT.saves_pg ?? 0), dec: 1 }]
                    : []),
                  ...(aT.btts_pct != null || hT.btts_pct != null
                    ? [{ label: 'Ambos Marcan (BTTS %)', a: Number(aT.btts_pct ?? 0), h: Number(hT.btts_pct ?? 0), dec: 0, suffix: '%' }]
                    : []),
                  ...(aT.over_25_pct != null || hT.over_25_pct != null
                    ? [{ label: 'Más 2.5 Goles %', a: Number(aT.over_25_pct ?? 0), h: Number(hT.over_25_pct ?? 0), dec: 0, suffix: '%' }]
                    : []),
                  { label: 'Vallas Invictas', a: Number(aT.clean_sheets ?? 0), h: Number(hT.clean_sheets ?? 0), dec: 0 },
                ];
                return (
                  <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 space-y-3.5 tabular-nums">
                    <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                      <span className="text-xs font-bold text-blue-400">
                        {aT.team_abbreviation} ({aT.points} PTS)
                      </span>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                        Promedios de temporada
                      </span>
                      <span className="text-xs font-bold text-slate-200">
                        {hT.team_abbreviation} ({hT.points} PTS)
                      </span>
                    </div>
                    <div className="space-y-2.5">
                      {rows.map((r) => {
                        const posA = Math.max(0.1, r.a);
                        const posH = Math.max(0.1, r.h);
                        const pctA = Math.round((posA / (posA + posH)) * 100);
                        const aBetter = r.lowerIsBetter ? r.a <= r.h : r.a >= r.h;
                        const hBetter = r.lowerIsBetter ? r.h <= r.a : r.h >= r.a;
                        const s = r.suffix ?? '';
                        return (
                          <div key={r.label}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className={aBetter ? 'font-bold text-blue-400' : 'text-slate-400'}>
                                {r.a.toFixed(r.dec)}
                                {s}
                              </span>
                              <span className="font-medium text-slate-300">{r.label}</span>
                              <span className={hBetter ? 'font-bold text-slate-100' : 'text-slate-400'}>
                                {r.h.toFixed(r.dec)}
                                {s}
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden flex">
                              <div className="bg-blue-500 transition-all" style={{ width: `${pctA}%` }} />
                              <div className="bg-slate-400 transition-all" style={{ width: `${100 - pctA}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : (
          <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
            {/* Live or Final Game Collective Comparison */}
            {game.status !== 'scheduled' && stats.length > 0 && (
              <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 space-y-3.5 tabular-nums">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                  <div className="flex items-center gap-2">
                    {game.away_team.logo_url && (
                      <img
                        src={game.away_team.logo_url}
                        alt={game.away_team.abbreviation}
                        className="w-6 h-6 object-contain"
                      />
                    )}
                    <span className="text-xs font-bold text-blue-400">
                      {game.away_team.short_name}
                    </span>
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    Estadísticas colectivas del partido
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-200">
                      {game.home_team.short_name}
                    </span>
                    {game.home_team.logo_url && (
                      <img
                        src={game.home_team.logo_url}
                        alt={game.home_team.abbreviation}
                        className="w-6 h-6 object-contain"
                      />
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  {[
                    {
                      label: 'Tiros de Campo (TC%)',
                      awayVal: awayTotals.fgPct,
                      homeVal: homeTotals.fgPct,
                      awayText: `${awayTotals.fgm}/${awayTotals.fga} (${awayTotals.fgPct.toFixed(1)}%)`,
                      homeText: `${homeTotals.fgm}/${homeTotals.fga} (${homeTotals.fgPct.toFixed(1)}%)`,
                    },
                    {
                      label: 'Triples (3P%)',
                      awayVal: awayTotals.tpPct,
                      homeVal: homeTotals.tpPct,
                      awayText: `${awayTotals.tpm}/${awayTotals.tpa} (${awayTotals.tpPct.toFixed(1)}%)`,
                      homeText: `${homeTotals.tpm}/${homeTotals.tpa} (${homeTotals.tpPct.toFixed(1)}%)`,
                    },
                    {
                      label: 'Tiros Libres (TL%)',
                      awayVal: awayTotals.ftPct,
                      homeVal: homeTotals.ftPct,
                      awayText: `${awayTotals.ftm}/${awayTotals.fta} (${awayTotals.ftPct.toFixed(1)}%)`,
                      homeText: `${homeTotals.ftm}/${homeTotals.fta} (${homeTotals.ftPct.toFixed(1)}%)`,
                    },
                    {
                      label: 'Effective FG% (eFG%)',
                      awayVal: awayTotals.efgPct,
                      homeVal: homeTotals.efgPct,
                      awayText: `${awayTotals.efgPct.toFixed(1)}%`,
                      homeText: `${homeTotals.efgPct.toFixed(1)}%`,
                    },
                    {
                      label: 'True Shooting (TS%)',
                      awayVal: awayTotals.tsPct,
                      homeVal: homeTotals.tsPct,
                      awayText: `${awayTotals.tsPct.toFixed(1)}%`,
                      homeText: `${homeTotals.tsPct.toFixed(1)}%`,
                    },
                    {
                      label: 'Rebotes Totales',
                      awayVal: awayTotals.reb,
                      homeVal: homeTotals.reb,
                      awayText: String(awayTotals.reb),
                      homeText: String(homeTotals.reb),
                    },
                    {
                      label: 'Rebotes Ofensivos',
                      awayVal: awayTotals.oreb,
                      homeVal: homeTotals.oreb,
                      awayText: String(awayTotals.oreb),
                      homeText: String(homeTotals.oreb),
                    },
                    {
                      label: 'Rebotes Defensivos',
                      awayVal: awayTotals.dreb,
                      homeVal: homeTotals.dreb,
                      awayText: String(awayTotals.dreb),
                      homeText: String(homeTotals.dreb),
                    },
                    {
                      label: 'Asistencias',
                      awayVal: awayTotals.ast,
                      homeVal: homeTotals.ast,
                      awayText: String(awayTotals.ast),
                      homeText: String(homeTotals.ast),
                    },
                    {
                      label: 'Robos de Balón',
                      awayVal: awayTotals.stl,
                      homeVal: homeTotals.stl,
                      awayText: String(awayTotals.stl),
                      homeText: String(homeTotals.stl),
                    },
                    {
                      label: 'Tapones',
                      awayVal: awayTotals.blk,
                      homeVal: homeTotals.blk,
                      awayText: String(awayTotals.blk),
                      homeText: String(homeTotals.blk),
                    },
                    {
                      label: 'Pérdidas de Balón (TOV)',
                      awayVal: awayTotals.tov,
                      homeVal: homeTotals.tov,
                      awayText: String(awayTotals.tov),
                      homeText: String(homeTotals.tov),
                      lowerIsBetter: true,
                    },
                    {
                      label: 'Faltas Personales',
                      awayVal: awayTotals.pf,
                      homeVal: homeTotals.pf,
                      awayText: String(awayTotals.pf),
                      homeText: String(homeTotals.pf),
                      lowerIsBetter: true,
                    },
                    {
                      label: 'Puntos de Titulares',
                      awayVal: awayTotals.starterPts,
                      homeVal: homeTotals.starterPts,
                      awayText: String(awayTotals.starterPts),
                      homeText: String(homeTotals.starterPts),
                    },
                    {
                      label: 'Puntos de la Banca',
                      awayVal: awayTotals.benchPts,
                      homeVal: homeTotals.benchPts,
                      awayText: String(awayTotals.benchPts),
                      homeText: String(homeTotals.benchPts),
                    },
                  ].map((row) => {
                    const posA = Math.max(0.1, row.awayVal);
                    const posH = Math.max(0.1, row.homeVal);
                    const pctAway = Math.round((posA / (posA + posH)) * 100);
                    const awayBetter = row.lowerIsBetter
                      ? row.awayVal <= row.homeVal
                      : row.awayVal >= row.homeVal;
                    const homeBetter = row.lowerIsBetter
                      ? row.homeVal <= row.awayVal
                      : row.homeVal >= row.awayVal;

                    return (
                      <div key={row.label}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span
                            className={
                              awayBetter ? 'font-bold text-blue-400' : 'text-slate-400'
                            }
                          >
                            {row.awayText}
                          </span>
                          <span className="font-medium text-slate-300">{row.label}</span>
                          <span
                            className={
                              homeBetter ? 'font-bold text-slate-100' : 'text-slate-400'
                            }
                          >
                            {row.homeText}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
                          <div
                            className="bg-blue-500 transition-all"
                            style={{ width: `${pctAway}%` }}
                          />
                          <div
                            className="bg-slate-400 transition-all"
                            style={{ width: `${100 - pctAway}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Season Team Averages Comparison */}
            {(() => {
              const nbaCtx = betCtx as GameBettingContext | null;
              if (!nbaCtx?.awayTeamAvg || !nbaCtx?.homeTeamAvg) {
                return loadingBet ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    Cargando estadísticas comparativas de los equipos...
                  </div>
                ) : null;
              }
              return (
              <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 space-y-3.5 tabular-nums">
                <div className="flex items-center justify-between border-b border-white/[0.08] pb-2.5">
                  <span className="text-xs font-bold text-blue-400">
                    {game.away_team.abbreviation} ({nbaCtx.awayTeamAvg.wins}-{nbaCtx.awayTeamAvg.losses})
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    Promedios de temporada por equipo
                  </span>
                  <span className="text-xs font-bold text-slate-200">
                    {game.home_team.abbreviation} ({nbaCtx.homeTeamAvg.wins}-{nbaCtx.homeTeamAvg.losses})
                  </span>
                </div>

                <div className="space-y-2.5">
                  {[
                    {
                      label: 'Puntos a Favor (PPG)',
                      a: Number(nbaCtx.awayTeamAvg.ppg ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.ppg ?? 0),
                    },
                    {
                      label: 'Puntos Recibidos (OPPG)',
                      a: Number(nbaCtx.awayTeamAvg.oppg ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.oppg ?? 0),
                      lowerIsBetter: true,
                    },
                    {
                      label: 'Rebotes por Partido (RPG)',
                      a: Number(nbaCtx.awayTeamAvg.rpg ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.rpg ?? 0),
                    },
                    {
                      label: 'Asistencias por Partido (APG)',
                      a: Number(nbaCtx.awayTeamAvg.apg ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.apg ?? 0),
                    },
                    {
                      label: 'Triples Anotados / PJ',
                      a: Number(nbaCtx.awayTeamAvg.tpm_pg ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.tpm_pg ?? 0),
                    },
                    {
                      label: 'Tiros de Campo (TC%)',
                      a: Number(nbaCtx.awayTeamAvg.fg_pct ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.fg_pct ?? 0),
                      suffix: '%',
                    },
                    {
                      label: 'Efectividad Triples (3P%)',
                      a: Number(nbaCtx.awayTeamAvg.tp_pct ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.tp_pct ?? 0),
                      suffix: '%',
                    },
                    {
                      label: 'True Shooting (TS%)',
                      a: Number(nbaCtx.awayTeamAvg.ts_pct ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.ts_pct ?? 0),
                      suffix: '%',
                    },
                    {
                      label: 'Robos (SPG)',
                      a: Number(nbaCtx.awayTeamAvg.spg ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.spg ?? 0),
                    },
                    {
                      label: 'Tapones (BPG)',
                      a: Number(nbaCtx.awayTeamAvg.bpg ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.bpg ?? 0),
                    },
                    {
                      label: 'Puntos de la Banca',
                      a: Number(nbaCtx.awayTeamAvg.bench_ppg ?? 0),
                      h: Number(nbaCtx.homeTeamAvg.bench_ppg ?? 0),
                    },
                  ].map((r) => {
                    const posA = Math.max(0.1, r.a);
                    const posH = Math.max(0.1, r.h);
                    const pctA = Math.round((posA / (posA + posH)) * 100);
                    const s = r.suffix ?? '';
                    const aBetter = r.lowerIsBetter ? r.a <= r.h : r.a >= r.h;
                    const hBetter = r.lowerIsBetter ? r.h <= r.a : r.h >= r.a;
                    return (
                      <div key={r.label}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className={aBetter ? 'font-bold text-blue-400' : 'text-slate-400'}>
                            {r.a.toFixed(1)}
                            {s}
                          </span>
                          <span className="font-medium text-slate-300">{r.label}</span>
                          <span className={hBetter ? 'font-bold text-slate-100' : 'text-slate-400'}>
                            {r.h.toFixed(1)}
                            {s}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden flex">
                          <div
                            className="bg-blue-500 transition-all"
                            style={{ width: `${pctA}%` }}
                          />
                          <div
                            className="bg-slate-400 transition-all"
                            style={{ width: `${100 - pctA}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}
          </div>
          )
        ) : section === 'history' ? (
          <div className="flex-1 min-h-0 overflow-auto sb-scroller p-4 sm:p-5 space-y-4">
            <div
              role="region"
              aria-label="Seleccionar historial de equipo"
              className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
            >
              {(
                [
                  {
                    key: 'away',
                    label: `${game.away_team.short_name} (${awayFinalsCount})`,
                  },
                  {
                    key: 'home',
                    label: `${game.home_team.short_name} (${homeFinalsCount})`,
                  },
                  {
                    key: 'h2h',
                    label: `H2H (${h2hFinalsCount})`,
                  },
                ] as const
              ).map((t) => {
                const active = historyTeamTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={active}
                    onClick={(e) => {
                      setHistoryTeamTab(t.key);
                      e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                    }}
                    className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap tabular-nums ${
                      active
                        ? 'cv-tab-active'
                        : 'bg-[#12151c] text-slate-300 border-white/[0.08] hover:border-white/[0.18] hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>

            {loadingBet && !betCtx ? (
              <div className="py-10 text-center text-xs text-slate-400">
                Cargando historial de partidos jugados...
              </div>
            ) : (
              <PastGamesHistoryPanel
                games={
                  historyTeamTab === 'away'
                    ? betCtx?.awayRecentGames ?? []
                    : historyTeamTab === 'home'
                      ? betCtx?.homeRecentGames ?? []
                      : betCtx?.h2hGames ?? []
                }
                focusTeamId={
                  historyTeamTab === 'away'
                    ? game.away_team_id
                    : historyTeamTab === 'home'
                      ? game.home_team_id
                      : undefined
                }
                focusTeamName={
                  historyTeamTab === 'away'
                    ? game.away_team.short_name
                    : historyTeamTab === 'home'
                      ? game.home_team.short_name
                      : `${game.away_team.abbreviation} vs ${game.home_team.abbreviation}`
                }
                sport={sport}
                emptyMessage={
                  historyTeamTab === 'h2h'
                    ? 'Aún no hay enfrentamientos previos finalizados en esta competición.'
                    : 'No hay partidos finalizados recientes registrados para este equipo.'
                }
                onSelectGame={handleOpenPastGame}
              />
            )}
          </div>
        ) : (
          <>
            {/* Team Switcher for Box Score */}
            <div className="shrink-0 flex border-b border-white/[0.08] bg-[#0e1117]">
              {[game.away_team, game.home_team].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTeamId(t.id)}
                  className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 border-b-2 transition-colors ${
                    activeTeamId === t.id
                      ? 'border-white text-white bg-white/[0.04]'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.logo_url && <img src={t.logo_url} alt={t.abbreviation} className="w-4 h-4" />}
                  <span>{t.short_name}</span>
                </button>
              ))}
            </div>

            {/* Box Score Body */}
            <div
              tabIndex={0}
              role="region"
              aria-label="Box Score de Jugadores"
              className="flex-1 min-h-0 overflow-auto sb-scroller p-2 sm:p-4"
            >
              {game.status === 'scheduled' ? (
                <div className="py-10 text-center space-y-3">
                  <p className="text-slate-400 text-sm">
                    El partido aún no ha iniciado. El box score aparecerá automáticamente al comenzar.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSection('betting')}
                    className="inline-flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-lg cv-btn-primary"
                  >
                    <Scale className="w-3.5 h-3.5" aria-hidden="true" />
                    Ver líneas y previa
                  </button>
                </div>
              ) : loadingBox ? (
                <div className="py-12 text-center text-slate-400 text-sm">Cargando box score...</div>
              ) : teamStats.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  Sin estadísticas de jugadores disponibles para este partido.
                </div>
              ) : (
                <table className="w-full text-xs tabular-nums whitespace-nowrap border-separate border-spacing-0">
                  <caption className="visually-hidden">
                    Estadísticas individuales del partido
                  </caption>
                  <thead>
                    {sport === 'football' ? (
                      <tr className="text-slate-400 border-b border-white/[0.08]">
                        <th scope="col" className="text-left py-2 px-2 sticky left-0 bg-[#12151c]">
                          JUGADOR
                        </th>
                        <th scope="col" className="text-center py-2 px-2">POS</th>
                        <th scope="col" className="text-right py-2 px-2 text-white">G</th>
                        <th scope="col" className="text-right py-2 px-2">A</th>
                        <th scope="col" className="text-right py-2 px-2">REM</th>
                        <th scope="col" className="text-right py-2 px-2">ARCO</th>
                        <th scope="col" className="text-right py-2 px-2">FC</th>
                        <th scope="col" className="text-right py-2 px-2">FS</th>
                        <th scope="col" className="text-right py-2 px-2">TA</th>
                        <th scope="col" className="text-right py-2 px-2">TR</th>
                        <th scope="col" className="text-right py-2 px-2">ATAJ</th>
                      </tr>
                    ) : (
                      <tr className="text-slate-400 border-b border-white/[0.08]">
                        <th scope="col" className="text-left py-2 px-2 sticky left-0 bg-[#12151c]">
                          JUGADOR
                        </th>
                        <th scope="col" className="text-right py-2 px-2">MIN</th>
                        <th scope="col" className="text-right py-2 px-2 text-white">PTS</th>
                        <th scope="col" className="text-right py-2 px-2">REB</th>
                        <th scope="col" className="text-right py-2 px-2">AST</th>
                        <th scope="col" className="text-right py-2 px-2">TC</th>
                        <th scope="col" className="text-right py-2 px-2">3P</th>
                        <th scope="col" className="text-right py-2 px-2">TL</th>
                        <th scope="col" className="text-right py-2 px-2">ROB</th>
                        <th scope="col" className="text-right py-2 px-2">TAP</th>
                        <th scope="col" className="text-right py-2 px-2">+/-</th>
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {teamStats.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => onSelectPlayer(row.player_id)}
                        className={`cursor-pointer hover:bg-white/[0.04] ${
                          row.did_not_play ? 'opacity-45' : ''
                        }`}
                      >
                        <th scope="row" className="text-left font-normal py-2 px-2 sticky left-0 bg-[#12151c]">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-100 hover:underline">
                              {row.player?.full_name ?? `#${row.player_id}`}
                            </span>
                            {row.starter && !row.did_not_play && (
                              <span className="text-[10px] px-1 rounded bg-white/[0.08] text-slate-300 font-semibold">
                                TIT
                              </span>
                            )}
                          </div>
                        </th>
                        {row.did_not_play ? (
                          <td
                            colSpan={10}
                            className="py-2 px-2 text-right text-slate-400 italic"
                          >
                            {row.dnp_reason || 'No jugó (DNP)'}
                          </td>
                        ) : sport === 'football' ? (
                          <>
                            <td className="text-center py-2 px-2 text-slate-400">
                              {row.player?.position ?? '-'}
                            </td>
                            <td className="text-right py-2 px-2 font-bold text-white">
                              {row.sport_stats?.goals ?? row.pts ?? 0}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-200">
                              {row.sport_stats?.assists ?? row.ast ?? 0}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-200">
                              {row.sport_stats?.shots ?? 0}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-300">
                              {row.sport_stats?.shots_on_target ?? 0}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-400">
                              {row.sport_stats?.fouls_committed ?? 0}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-400">
                              {row.sport_stats?.fouls_suffered ?? 0}
                            </td>
                            <td className="text-right py-2 px-2 text-amber-300">
                              {row.sport_stats?.yellow_cards ?? 0}
                            </td>
                            <td className="text-right py-2 px-2 text-rose-400">
                              {row.sport_stats?.red_cards ?? 0}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-300">
                              {row.sport_stats?.saves ?? 0}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="text-right py-2 px-2 text-slate-300">{row.minutes}</td>
                            <td className="text-right py-2 px-2 font-bold text-white">{row.pts}</td>
                            <td className="text-right py-2 px-2 text-slate-200">{row.reb}</td>
                            <td className="text-right py-2 px-2 text-slate-200">{row.ast}</td>
                            <td className="text-right py-2 px-2 text-slate-400">
                              {row.fgm}-{row.fga}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-400">
                              {row.tpm}-{row.tpa}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-400">
                              {row.ftm}-{row.fta}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-300">{row.stl}</td>
                            <td className="text-right py-2 px-2 text-slate-300">{row.blk}</td>
                            <td
                              className={`text-right py-2 px-2 font-medium ${
                                row.plus_minus > 0
                                  ? 'text-emerald-300'
                                  : row.plus_minus < 0
                                    ? 'text-rose-300'
                                    : 'text-slate-400'
                              }`}
                            >
                              {row.plus_minus > 0 ? `+${row.plus_minus}` : row.plus_minus}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  {sport !== 'football' && (
                  <tfoot>
                    <tr className="border-t border-white/[0.14] bg-[#0e1117] font-bold text-white">
                      <td className="py-2.5 px-2 sticky left-0 bg-[#0e1117]">
                        TOTAL EQUIPO
                      </td>
                      <td className="text-right py-2.5 px-2 text-slate-400">-</td>
                      <td className="text-right py-2.5 px-2 text-white">{activeTotals.pts}</td>
                      <td className="text-right py-2.5 px-2">{activeTotals.reb}</td>
                      <td className="text-right py-2.5 px-2">{activeTotals.ast}</td>
                      <td className="text-right py-2.5 px-2 text-slate-200">
                        {activeTotals.fgm}-{activeTotals.fga} ({activeTotals.fgPct.toFixed(0)}%)
                      </td>
                      <td className="text-right py-2.5 px-2 text-slate-200">
                        {activeTotals.tpm}-{activeTotals.tpa} ({activeTotals.tpPct.toFixed(0)}%)
                      </td>
                      <td className="text-right py-2.5 px-2 text-slate-200">
                        {activeTotals.ftm}-{activeTotals.fta} ({activeTotals.ftPct.toFixed(0)}%)
                      </td>
                      <td className="text-right py-2.5 px-2">{activeTotals.stl}</td>
                      <td className="text-right py-2.5 px-2">{activeTotals.blk}</td>
                      <td className="text-right py-2.5 px-2 text-slate-400">
                        {activeTotals.tov} PER
                      </td>
                    </tr>
                  </tfoot>
                  )}
                </table>
              )}
            </div>
          </>
        )}
        </div>
        );
      }}
    </ModalDialog>
  );
}
