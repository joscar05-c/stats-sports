import { useEffect, useState } from 'react';
import { CalendarDays, ChevronRight, Radio } from 'lucide-react';
import { fetchAvailableGameDates, fetchGamesByDate, triggerCloudSync } from '../services/basketballApi';
import { supabase } from '../lib/supabase';
import {
  evaluateGameBettingResult,
  formatDecimalOdds,
  formatSpreadCompact,
} from '../utils/betting';
import type { Game } from '../types/database';

interface GamesViewProps {
  leagueId: number;
  sport?: 'basketball' | 'football';
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
  onSelectGame,
  onGamesUpdated,
}: GamesViewProps) {
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchAvailableGameDates(leagueId).then((avail) => {
      if (!active) return;
      setDates(avail);
      if (avail.length > 0) {
        const now = new Date();
        const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const upcomingOrToday = avail.includes(todayIso)
          ? todayIso
          : avail
              .slice()
              .reverse()
              .find((d) => d >= todayIso) ?? avail[0];
        setSelectedDate(upcomingOrToday);
      } else {
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [leagueId]);

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
          await triggerCloudSync(0, 0, sport).catch(() => {});
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

  return (
    <div className="space-y-4 @container">
      {/* Horizontal Date Strip */}
      <div
        role="region"
        aria-label="Fechas disponibles"
        className="flex items-center gap-2 overflow-x-auto no-scrollbar sb-scroll-fade-x pb-1"
      >
        {dates.slice(0, 14).map((d) => {
          const { top, bottom } = formatDateLabel(d);
          const isSelected = d === selectedDate;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelectedDate(d)}
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
                        ? 'Resumen'
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
