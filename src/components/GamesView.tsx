import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Radio } from 'lucide-react';
import {
  fetchAvailableGameDateSummaries,
  fetchGamesByDate,
  triggerCloudSync,
  type GameDateSummary,
} from '../services/basketballApi';
import { supabase } from '../lib/supabase';
import {
  evaluateGameBettingResult,
  formatDecimalOdds,
  formatSpreadCompact,
} from '../utils/betting';
import { extractHalfTimeGoals, hasFootballBoxTracking } from '../utils/footballProps';
import type { Game } from '../types/database';

type DateFilterMode = 'all' | 'final' | 'upcoming';

function getTodayIsoLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

interface GamesViewProps {
  leagueId: number;
  sport?: 'basketball' | 'football';
  leagueCode?: string;
  onSelectGame: (game: Game) => void;
  onGamesUpdated?: (games: Game[]) => void;
}

function formatDateLabel(isoDate: string): { top: string; bottom: string } {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const weekday = dt.toLocaleDateString('es-PE', { weekday: 'short' }).replace('.', '');
  const dayMonth = dt.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }).replace('.', '');

  if (diffDays === 0) return { top: 'HOY', bottom: dayMonth };
  if (diffDays === -1) return { top: 'AYER', bottom: dayMonth };
  if (diffDays === 1) return { top: 'MAÑANA', bottom: dayMonth };
  return { top: weekday.toUpperCase(), bottom: dayMonth };
}

function formatTipoffLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export function GamesView({
  leagueId,
  sport = 'basketball',
  leagueCode = 'eng.1',
  onSelectGame,
  onGamesUpdated,
}: GamesViewProps) {
  const [dateSummaries, setDateSummaries] = useState<GameDateSummary[]>([]);
  const [dateFilter, setDateFilter] = useState<DateFilterMode>('all');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setDateFilter('all');
    fetchAvailableGameDateSummaries(leagueId).then((avail) => {
      if (!active) return;
      setDateSummaries(avail);
      if (avail.length > 0) {
        const todayIso = getTodayIsoLocal();
        const dateStrings = avail.map((d) => d.game_date);
        const upcomingOrToday = dateStrings.includes(todayIso)
          ? todayIso
          : dateStrings
              .slice()
              .reverse()
              .find((d) => d >= todayIso) ?? dateStrings[0];
        setSelectedDate(upcomingOrToday);
      } else {
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [leagueId]);

  const filterCounts = useMemo(
    () => ({
      all: dateSummaries.length,
      final: dateSummaries.filter((d) => d.finalCount > 0).length,
      upcoming: dateSummaries.filter((d) => d.liveCount > 0 || d.scheduledCount > 0).length,
    }),
    [dateSummaries],
  );

  const visibleDates = useMemo(() => {
    if (dateFilter === 'final') return dateSummaries.filter((d) => d.finalCount > 0);
    if (dateFilter === 'upcoming') {
      return dateSummaries.filter((d) => d.liveCount > 0 || d.scheduledCount > 0);
    }
    return dateSummaries;
  }, [dateSummaries, dateFilter]);

  const handleChangeDateFilter = (nextMode: DateFilterMode) => {
    setDateFilter(nextMode);
    const nextList =
      nextMode === 'final'
        ? dateSummaries.filter((d) => d.finalCount > 0)
        : nextMode === 'upcoming'
          ? dateSummaries.filter((d) => d.liveCount > 0 || d.scheduledCount > 0)
          : dateSummaries;
    if (nextList.length === 0) return;
    if (nextList.some((d) => d.game_date === selectedDate)) return;
    if (nextMode === 'final') {
      setSelectedDate(nextList[0].game_date);
    } else {
      const todayIso = getTodayIsoLocal();
      const nearest =
        nextList
          .map((d) => d.game_date)
          .slice()
          .reverse()
          .find((d) => d >= todayIso) ?? nextList[0].game_date;
      setSelectedDate(nearest);
    }
  };

  useEffect(() => {
    if (!selectedDate) return;
    let active = true;
    setLoading(true);

    const refreshGamesSilently = async () => {
      try {
        const res = await fetchGamesByDate(leagueId, selectedDate);
        if (active) {
          setGames(res.data);
          onGamesUpdated?.(res.data);
        }
      } catch {
        // Ignore transient network errors
      }
    };

    fetchGamesByDate(leagueId, selectedDate)
      .then((res) => {
        if (active) {
          setGames(res.data);
          onGamesUpdated?.(res.data);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // Subscribe to Realtime changes on games for instant UI updates when pg_cron updates scores
    const channel = supabase
      .channel(`games_live_${leagueId}_${selectedDate}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'games',
        },
        () => {
          void refreshGamesSilently();
        },
      )
      .subscribe();

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void refreshGamesSilently();
      }
    };
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    return () => {
      active = false;
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      supabase.removeChannel(channel);
    };
  }, [leagueId, selectedDate]);

  // Continuous silent auto-refresh every 15s (plus ESPN Edge Function nudge every 45s when games are live/starting)
  const hasLiveOrStarting = games.some(
    (g) =>
      g.status === 'live' ||
      (g.status === 'scheduled' && new Date(g.tipoff_at).getTime() <= Date.now() + 15 * 60 * 1000),
  );

  useEffect(() => {
    if (!selectedDate) return;
    let active = true;
    let tick = 0;

    const timer = window.setInterval(async () => {
      tick += 1;
      try {
        if (hasLiveOrStarting && tick % 3 === 0) {
          await triggerCloudSync(0, 0, sport, leagueCode).catch(() => {});
        }
        const res = await fetchGamesByDate(leagueId, selectedDate);
        if (active) {
          setGames(res.data);
          onGamesUpdated?.(res.data);
        }
      } catch {
        // Ignore transient network errors during live polling
      }
    }, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [leagueId, selectedDate, hasLiveOrStarting]);

  const selectedIdx = visibleDates.findIndex((d) => d.game_date === selectedDate);
  const canStepNewer = selectedIdx > 0;
  const canStepOlder = selectedIdx >= 0 && selectedIdx < visibleDates.length - 1;

  return (
    <div className="space-y-4 @container">
      {/* Status Filter + Full Season Date Strip */}
      <div className="space-y-2">
        {dateSummaries.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              role="region"
              aria-label="Filtrar fechas por estado"
              className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
            >
              {(
                [
                  { key: 'all', label: `Todas (${filterCounts.all})` },
                  { key: 'final', label: `Jugados (${filterCounts.final})` },
                  { key: 'upcoming', label: `Próximos (${filterCounts.upcoming})` },
                ] as const
              ).map((f) => {
                const active = dateFilter === f.key;
                const disabled = filterCounts[f.key] === 0;
                return (
                  <button
                    key={f.key}
                    type="button"
                    disabled={disabled}
                    aria-pressed={active}
                    onClick={() => handleChangeDateFilter(f.key)}
                    className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap tabular-nums ${
                      active
                        ? 'cv-tab-active'
                        : disabled
                          ? 'bg-[#0e1117] text-slate-600 border-white/[0.04] cursor-not-allowed'
                          : 'bg-[#12151c] text-slate-300 border-white/[0.08] hover:border-white/[0.18] hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            {visibleDates.length > 1 && (
              <div className="inline-flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={!canStepNewer}
                  onClick={() => canStepNewer && setSelectedDate(visibleDates[selectedIdx - 1].game_date)}
                  aria-label="Fecha más reciente"
                  className="p-1.5 rounded-md bg-[#12151c] border border-white/[0.08] text-slate-300 hover:border-white/[0.2] hover:text-white disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={!canStepOlder}
                  onClick={() => canStepOlder && setSelectedDate(visibleDates[selectedIdx + 1].game_date)}
                  aria-label="Fecha anterior"
                  className="p-1.5 rounded-md bg-[#12151c] border border-white/[0.08] text-slate-300 hover:border-white/[0.2] hover:text-white disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}

        <div
          role="region"
          aria-label="Fechas disponibles"
          className="flex items-center gap-2 overflow-x-auto no-scrollbar sb-scroll-fade-x pb-1"
        >
          {visibleDates.map((summary) => {
            const d = summary.game_date;
            const { top, bottom } = formatDateLabel(d);
            const isSelected = d === selectedDate;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={isSelected}
                onClick={(e) => {
                  setSelectedDate(d);
                  e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                }}
                className={`shrink-0 px-3.5 py-2 rounded-lg border text-center transition-colors ${
                  isSelected
                    ? 'cv-tab-active'
                    : 'bg-[#12151c] text-slate-300 border-white/[0.08] hover:border-white/[0.18] hover:text-white'
                }`}
              >
                <div className="text-[10px] font-bold tracking-wider">{top}</div>
                <div className="text-xs font-semibold mt-0.5 tabular-nums">{bottom}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Games List */}
      {loading ? (
        <div className="grid grid-cols-1 @[620px]:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-40 rounded-2xl sb-card animate-pulse"
            />
          ))}
        </div>
      ) : games.length === 0 ? (
        <div className="sb-card rounded-xl p-10 text-center">
          <CalendarDays className="w-8 h-8 text-slate-500 mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm text-slate-200 font-semibold">No hay partidos registrados para esta fecha</p>
          <p className="text-xs text-slate-400 mt-1">
            Prueba seleccionando otra fecha en la barra superior.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 @[620px]:grid-cols-2 gap-3.5">
          {games.map((g) => {
            const awayWon = g.status === 'final' && g.away_score > g.home_score;
            const homeWon = g.status === 'final' && g.home_score > g.away_score;
            const showFootballStats =
              sport === 'football' &&
              g.status !== 'scheduled' &&
              Boolean(g.sport_stats?.home && g.sport_stats?.away) &&
              hasFootballBoxTracking(g);
            const hasHalves =
              sport === 'football' &&
              g.status !== 'scheduled' &&
              Array.isArray(g.away_linescores) &&
              g.away_linescores.length >= 2 &&
              Array.isArray(g.home_linescores) &&
              g.home_linescores.length >= 2;
            const htFallback =
              sport === 'football' && g.status !== 'scheduled' && !hasHalves
                ? extractHalfTimeGoals(g)
                : null;
            const hs = g.sport_stats?.home;
            const as_ = g.sport_stats?.away;
            const totalGoals = g.home_score + g.away_score;
            const isBtts = g.status === 'final' && g.home_score > 0 && g.away_score > 0;
            const isOver25 = g.status === 'final' && totalGoals >= 3;

            return (
              <button
                key={g.id}
                onClick={() => onSelectGame(g)}
                className="group relative text-left rounded-xl sb-card sb-card-hover p-4"
              >
                {/* Status Header */}
                <div className="flex items-center justify-between mb-3">
                  {g.status === 'live' ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-md bg-red-500/12 text-red-300 border border-red-500/25">
                      <Radio className="w-3 h-3" aria-hidden="true" />
                      EN VIVO · {g.status_detail}
                    </span>
                  ) : g.status === 'final' ? (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white/[0.04] text-slate-400 border border-white/[0.08]">
                      {g.status_detail || 'FINAL'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white/[0.04] text-slate-300 border border-white/[0.08] tabular-nums">
                      {formatTipoffLocal(g.tipoff_at)}
                    </span>
                  )}

                  <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-400 group-hover:text-slate-100 transition-colors">
                    {g.status === 'scheduled'
                      ? 'Líneas y previa'
                      : sport === 'football'
                        ? 'Estadísticas y resumen'
                        : 'Box Score'}
                    <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                </div>

                {/* Teams & Scores */}
                <div className="space-y-2.5 tabular-nums">
                  {[
                    {
                      team: g.away_team,
                      score: g.away_score,
                      won: awayWon,
                      ml: g.odds?.away_moneyline,
                      tag: sport === 'football' ? 'VIS' : null,
                    },
                    {
                      team: g.home_team,
                      score: g.home_score,
                      won: homeWon,
                      ml: g.odds?.home_moneyline,
                      tag: sport === 'football' ? 'LOC' : null,
                    },
                  ].map((side) => (
                    <div key={side.team.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {side.team.logo_url && (
                          <img
                            src={side.team.logo_url}
                            alt={side.team.abbreviation}
                            className="w-7 h-7 object-contain shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <div
                            className={`text-sm font-semibold truncate ${
                              side.won || g.status !== 'final' ? 'text-slate-100' : 'text-slate-400'
                            }`}
                          >
                            {side.team.short_name}{' '}
                            <span className="text-xs font-normal text-slate-400">
                              ({side.team.abbreviation})
                            </span>
                            {side.tag && (
                              <span className="ml-1.5 text-[10px] font-semibold px-1 py-0.5 rounded bg-white/[0.04] text-slate-400">
                                {side.tag}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        {side.ml != null && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white/[0.04] text-slate-300 border border-white/[0.08]">
                            {formatDecimalOdds(side.ml)}x
                          </span>
                        )}
                        <span
                          className={`text-xl font-bold w-9 text-right ${
                            side.won
                              ? 'text-white'
                              : g.status === 'scheduled'
                                ? 'text-slate-500'
                                : 'text-slate-400'
                          }`}
                        >
                          {g.status === 'scheduled' ? '-' : side.score}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Football Played Match Stats Strip */}
                {(showFootballStats || hasHalves || htFallback) && (
                  <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center gap-1.5 text-[10px] tabular-nums text-slate-300">
                    {hasHalves ? (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                        1T <strong className="text-white">{g.away_linescores![0]}-{g.home_linescores![0]}</strong>
                      </span>
                    ) : htFallback ? (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                        1T <strong className="text-white">{htFallback.total}G</strong>
                      </span>
                    ) : null}
                    {showFootballStats && as_?.possession_pct != null && hs?.possession_pct != null && (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                        POS <strong className="text-white">{Math.round(Number(as_.possession_pct))}-{Math.round(Number(hs.possession_pct))}%</strong>
                      </span>
                    )}
                    {showFootballStats && as_?.shots != null && hs?.shots != null && (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                        REM <strong className="text-white">{as_.shots}-{hs.shots}</strong>{' '}
                        <span className="text-slate-400">({as_.shots_on_target ?? 0}-{hs.shots_on_target ?? 0})</span>
                      </span>
                    )}
                    {showFootballStats && as_?.corners != null && hs?.corners != null && (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                        CÓR <strong className="text-white">{as_.corners}-{hs.corners}</strong>{' '}
                        <span className="text-slate-400">(Tot {Number(as_.corners) + Number(hs.corners)})</span>
                      </span>
                    )}
                    {showFootballStats && as_?.fouls != null && hs?.fouls != null && (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                        FAL <strong className="text-white">{as_.fouls}-{hs.fouls}</strong>
                      </span>
                    )}
                    {showFootballStats && as_?.yellow_cards != null && hs?.yellow_cards != null && (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                        TA <strong className="text-amber-300">{as_.yellow_cards}-{hs.yellow_cards}</strong>
                        {Number(as_.red_cards ?? 0) + Number(hs.red_cards ?? 0) > 0 && (
                          <span className="text-rose-400 font-bold ml-1">
                            · {Number(as_.red_cards ?? 0) + Number(hs.red_cards ?? 0)} TR
                          </span>
                        )}
                      </span>
                    )}
                    {showFootballStats && as_?.saves != null && hs?.saves != null && (
                      <span className="px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                        ATAJ <strong className="text-white">{as_.saves}-{hs.saves}</strong>
                      </span>
                    )}
                    {g.status === 'final' && sport === 'football' && (
                      <div className="flex items-center gap-1 ml-auto">
                        {isBtts && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-300 border border-emerald-500/25 font-semibold">
                            BTTS
                          </span>
                        )}
                        <span
                          className={`px-1.5 py-0.5 rounded border font-semibold ${
                            isOver25
                              ? 'bg-blue-500/12 text-blue-300 border-blue-500/25'
                              : 'bg-white/[0.04] text-slate-400 border-white/[0.08]'
                          }`}
                        >
                          {isOver25 ? '+2.5' : '-2.5'}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Market Summary Strip */}
                {g.odds &&
                  (g.odds.home_spread != null ||
                    g.odds.over_under != null ||
                    g.odds.home_win_prob != null) && (
                    <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums">
                      <div className="flex items-center gap-1.5 text-slate-300">
                        {g.odds.home_spread != null && (
                          <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                            Hándicap:{' '}
                            <strong className="text-slate-100 font-semibold">
                              {g.odds.details ||
                                `${g.home_team.abbreviation} ${formatSpreadCompact(g.odds.home_spread)}`}
                            </strong>
                          </span>
                        )}
                        {g.odds.over_under != null && (
                          <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                            O/U <strong className="text-slate-100 font-semibold">{g.odds.over_under}</strong>
                          </span>
                        )}
                        {sport === 'football' && g.odds.draw_moneyline != null && (
                          <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.07]">
                            Empate{' '}
                            <strong className="text-slate-100 font-semibold">
                              {formatDecimalOdds(g.odds.draw_moneyline)}x
                            </strong>
                          </span>
                        )}
                        {g.odds.home_spread == null &&
                          g.odds.over_under == null &&
                          g.odds.away_win_prob != null &&
                          g.odds.home_win_prob != null && (
                            <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.07] text-slate-300">
                              Prob.:{' '}
                              <strong className="text-slate-100 font-semibold">
                                {g.away_team.abbreviation} {Number(g.odds.away_win_prob).toFixed(0)}%
                              </strong>{' '}
                              ·{' '}
                              <strong className="text-slate-100 font-semibold">
                                {g.home_team.abbreviation} {Number(g.odds.home_win_prob).toFixed(0)}%
                              </strong>
                            </span>
                          )}
                      </div>
                      {g.status === 'final' ? (
                        (() => {
                          const evalRes = evaluateGameBettingResult(g);
                          return (
                            <div className="flex items-center gap-1.5 font-semibold">
                              {evalRes.totalResult && (
                                <span
                                  className={
                                    evalRes.totalResult === 'OVER'
                                      ? 'text-emerald-300'
                                      : evalRes.totalResult === 'UNDER'
                                        ? 'text-slate-300'
                                        : 'text-slate-400'
                                  }
                                >
                                  {evalRes.totalPoints} ({evalRes.totalResult})
                                </span>
                              )}
                            </div>
                          );
                        })()
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          {g.odds.provider || 'Predictor'}
                        </span>
                      )}
                    </div>
                  )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
