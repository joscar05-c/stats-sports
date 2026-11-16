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

export function GamesView({ leagueId, onSelectGame, onGamesUpdated }: GamesViewProps) {
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
        const best = avail.includes(todayIso) ? todayIso : avail[0];
        setSelectedDate(best);
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
          await triggerCloudSync(0, 0).catch(() => {});
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
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {dates.slice(0, 14).map((d) => {
          const { top, bottom } = formatDateLabel(d);
          const isSelected = d === selectedDate;
          return (
            <button
              key={d}
              onClick={() => setSelectedDate(d)}
              className={`shrink-0 px-3.5 py-2 rounded-xl border text-center transition-all ${
                isSelected
                  ? 'bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 border-emerald-300 shadow-[0_6px_20px_rgba(16,185,129,0.28)]'
                  : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-emerald-400/40'
              }`}
            >
              <div className="text-[10px] font-black tracking-wider">{top}</div>
              <div className="text-xs font-bold mt-0.5 tabular-nums">{bottom}</div>
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
        <div className="sb-card rounded-2xl p-10 text-center">
          <CalendarDays className="w-8 h-8 text-emerald-400/60 mx-auto mb-2" />
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
            const awayColor = g.away_team.primary_color || '#06b6d4';
            const homeColor = g.home_team.primary_color || '#10b981';

            return (
              <button
                key={g.id}
                onClick={() => onSelectGame(g)}
                className="group relative overflow-hidden text-left rounded-2xl sb-card sb-card-hover p-4"
              >
                {/* Team Color Split Accent Bar */}
                <div
                  className="absolute top-0 inset-x-0 h-[3px] opacity-85"
                  style={{
                    background: `linear-gradient(90deg, ${awayColor} 0%, ${awayColor} 45%, ${homeColor} 55%, ${homeColor} 100%)`,
                  }}
                />

                {/* Status Header */}
                <div className="flex items-center justify-between mb-3 pt-0.5">
                  {g.status === 'live' ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      <Radio className="w-3 h-3 animate-pulse" />
                      EN VIVO · {g.status_detail}
                    </span>
                  ) : g.status === 'final' ? (
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-white/[0.06] text-slate-300 border border-white/[0.08]">
                      {g.status_detail || 'FINAL'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 tabular-nums">
                      {formatTipoffLocal(g.tipoff_at)}
                    </span>
                  )}

                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-slate-400 group-hover:text-emerald-300 transition-colors">
                    {g.status === 'scheduled' ? 'Líneas y Previa' : 'Box Score'}
                    <ChevronRight className="w-3.5 h-3.5" />
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
                    },
                    {
                      team: g.home_team,
                      score: g.home_score,
                      won: homeWon,
                      ml: g.odds?.home_moneyline,
                    },
                  ].map((side) => (
                    <div key={side.team.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {side.team.logo_url && (
                          <img
                            src={side.team.logo_url}
                            alt={side.team.abbreviation}
                            className="w-7 h-7 object-contain shrink-0 drop-shadow"
                          />
                        )}
                        <div className="min-w-0">
                          <div
                            className={`text-sm font-bold truncate ${
                              side.won || g.status !== 'final' ? 'text-white' : 'text-slate-400'
                            }`}
                          >
                            {side.team.short_name}{' '}
                            <span className="text-xs font-medium text-slate-500">
                              ({side.team.abbreviation})
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        {side.ml != null && (
                          <span className="text-[11px] font-black px-2 py-0.5 rounded-md bg-white/[0.06] text-amber-300 border border-white/[0.1]">
                            {formatDecimalOdds(side.ml)}x
                          </span>
                        )}
                        <span
                          className={`text-xl font-black w-9 text-right ${
                            side.won
                              ? 'text-emerald-400'
                              : g.status === 'scheduled'
                                ? 'text-slate-600'
                                : 'text-slate-200'
                          }`}
                        >
                          {g.status === 'scheduled' ? '-' : side.score}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Sportsbook Market Strip */}
                {g.odds &&
                  (g.odds.home_spread != null ||
                    g.odds.over_under != null ||
                    g.odds.home_win_prob != null) && (
                    <div className="mt-3 pt-2.5 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums">
                      <div className="flex items-center gap-1.5 text-slate-300">
                        {g.odds.home_spread != null && (
                          <span className="px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.08] font-semibold">
                            Hándicap:{' '}
                            <strong className="text-amber-300">
                              {g.odds.details ||
                                `${g.home_team.abbreviation} ${formatSpreadCompact(g.odds.home_spread)}`}
                            </strong>
                          </span>
                        )}
                        {g.odds.over_under != null && (
                          <span className="px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.08] font-semibold">
                            O/U <strong className="text-white">{g.odds.over_under}</strong>
                          </span>
                        )}
                        {g.odds.home_spread == null &&
                          g.odds.over_under == null &&
                          g.odds.away_win_prob != null &&
                          g.odds.home_win_prob != null && (
                            <span className="px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.08] text-slate-300 font-semibold">
                              Predictor:{' '}
                              <strong className="text-emerald-300">
                                {g.away_team.abbreviation} {Number(g.odds.away_win_prob).toFixed(0)}%
                              </strong>{' '}
                              ·{' '}
                              <strong className="text-cyan-300">
                                {g.home_team.abbreviation} {Number(g.odds.home_win_prob).toFixed(0)}%
                              </strong>
                            </span>
                          )}
                      </div>
                      {g.status === 'final' ? (
                        (() => {
                          const evalRes = evaluateGameBettingResult(g);
                          return (
                            <div className="flex items-center gap-1.5 font-bold">
                              {evalRes.totalResult && (
                                <span
                                  className={
                                    evalRes.totalResult === 'OVER'
                                      ? 'text-emerald-400'
                                      : evalRes.totalResult === 'UNDER'
                                        ? 'text-cyan-300'
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
                        <span className="text-[10px] text-slate-400 font-semibold">
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
