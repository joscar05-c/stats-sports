import { useEffect, useState } from 'react';
import { CalendarDays, ChevronRight, Radio } from 'lucide-react';
import { fetchAvailableGameDates, fetchGamesByDate } from '../services/basketballApi';
import {
  evaluateGameBettingResult,
  formatDecimalOdds,
  formatSpreadCompact,
} from '../utils/betting';
import type { Game } from '../types/database';

interface GamesViewProps {
  leagueId: number;
  onSelectGame: (game: Game) => void;
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

export function GamesView({ leagueId, onSelectGame }: GamesViewProps) {
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
    fetchGamesByDate(leagueId, selectedDate)
      .then((res) => {
        if (active) setGames(res.data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leagueId, selectedDate]);

  return (
    <div className="space-y-4">
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
                  ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-lg shadow-orange-500/20'
                  : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="text-[10px] font-extrabold tracking-wider">{top}</div>
              <div className="text-xs font-semibold mt-0.5 tabular-nums">{bottom}</div>
            </button>
          );
        })}
      </div>

      {/* Games List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-36 rounded-2xl bg-slate-900/60 border border-slate-800/80 animate-pulse"
            />
          ))}
        </div>
      ) : games.length === 0 ? (
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-10 text-center">
          <CalendarDays className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <p className="text-sm text-slate-300 font-semibold">No hay partidos registrados para esta fecha</p>
          <p className="text-xs text-slate-500 mt-1">
            Prueba seleccionando otra fecha en la barra superior.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {games.map((g) => {
            const awayWon = g.status === 'final' && g.away_score > g.home_score;
            const homeWon = g.status === 'final' && g.home_score > g.away_score;
            return (
              <button
                key={g.id}
                onClick={() => onSelectGame(g)}
                className="group text-left rounded-2xl bg-slate-900/75 border border-slate-800/90 hover:border-orange-500/50 p-4 transition-all hover:bg-slate-900"
              >
                {/* Status Header */}
                <div className="flex items-center justify-between mb-3">
                  {g.status === 'live' ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400">
                      <Radio className="w-3 h-3 animate-pulse" />
                      EN VIVO · {g.status_detail}
                    </span>
                  ) : g.status === 'final' ? (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                      {g.status_detail || 'FINAL'}
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 tabular-nums">
                      {formatTipoffLocal(g.tipoff_at)}
                    </span>
                  )}

                  <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400 group-hover:text-orange-400 transition-colors">
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
                            className="w-7 h-7 object-contain shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <div
                            className={`text-sm font-bold truncate ${
                              side.won || g.status !== 'final' ? 'text-white' : 'text-slate-400'
                            }`}
                          >
                            {side.team.short_name}{' '}
                            <span className="text-xs font-normal text-slate-500">
                              ({side.team.abbreviation})
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5">
                        {side.ml != null && (
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-800/80 text-amber-300">
                            {formatDecimalOdds(side.ml)}x
                          </span>
                        )}
                        <span
                          className={`text-xl font-black w-9 text-right ${
                            side.won
                              ? 'text-orange-400'
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
                    <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] tabular-nums">
                      <div className="flex items-center gap-2 text-slate-300">
                        {g.odds.home_spread != null && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-800/80 font-semibold">
                            Hándicap:{' '}
                            <strong className="text-amber-300">
                              {g.odds.details ||
                                `${g.home_team.abbreviation} ${formatSpreadCompact(g.odds.home_spread)}`}
                            </strong>
                          </span>
                        )}
                        {g.odds.over_under != null && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-800/80 font-semibold">
                            O/U <strong className="text-white">{g.odds.over_under}</strong>
                          </span>
                        )}
                        {g.odds.home_spread == null &&
                          g.odds.over_under == null &&
                          g.odds.away_win_prob != null &&
                          g.odds.home_win_prob != null && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-800/70 text-slate-300 font-semibold">
                              Predictor:{' '}
                              <strong className="text-orange-300">
                                {g.away_team.abbreviation} {Number(g.odds.away_win_prob).toFixed(0)}%
                              </strong>{' '}
                              ·{' '}
                              <strong className="text-sky-300">
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
                                        ? 'text-sky-400'
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
                        <span className="text-[10px] text-slate-400 font-medium">
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
