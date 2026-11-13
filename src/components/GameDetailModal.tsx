import { useEffect, useState } from 'react';
import { X, MapPin, Calendar } from 'lucide-react';
import { fetchGameBoxScore } from '../services/basketballApi';
import type { Game, PlayerGameStat } from '../types/database';

interface GameDetailModalProps {
  game: Game;
  onClose: () => void;
  onSelectPlayer: (playerId: number) => void;
}

export function GameDetailModal({ game, onClose, onSelectPlayer }: GameDetailModalProps) {
  const [stats, setStats] = useState<PlayerGameStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState<number>(game.away_team_id);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchGameBoxScore(game.id)
      .then((rows) => {
        if (active) setStats(rows);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [game.id]);

  const teamStats = stats.filter((s) => s.team_id === activeTeamId);
  const periods = Math.max(
    game.home_linescores?.length ?? 0,
    game.away_linescores?.length ?? 0,
    4,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[92vh] flex flex-col bg-[#0f1623] border border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800/80 bg-gradient-to-b from-slate-900/90 to-[#0f1623]">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Calendar className="w-3.5 h-3.5 text-orange-400" />
              {game.status_detail || game.game_date}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Matchup Scoreboard */}
          <div className="grid grid-cols-3 items-center gap-2 py-2">
            <div className="flex flex-col items-center text-center">
              {game.away_team.logo_url && (
                <img
                  src={game.away_team.logo_url}
                  alt={game.away_team.abbreviation}
                  className="w-12 h-12 object-contain mb-1.5"
                />
              )}
              <span className="font-bold text-sm sm:text-base">{game.away_team.short_name}</span>
              <span className="text-[11px] text-slate-400">Visita</span>
            </div>

            <div className="flex items-center justify-center gap-3 sm:gap-5 tabular-nums">
              <span
                className={`text-3xl sm:text-4xl font-black ${
                  game.away_score >= game.home_score && game.status !== 'scheduled'
                    ? 'text-white'
                    : 'text-slate-400'
                }`}
              >
                {game.status === 'scheduled' ? '-' : game.away_score}
              </span>
              <span className="text-xs font-bold text-slate-500">VS</span>
              <span
                className={`text-3xl sm:text-4xl font-black ${
                  game.home_score >= game.away_score && game.status !== 'scheduled'
                    ? 'text-white'
                    : 'text-slate-400'
                }`}
              >
                {game.status === 'scheduled' ? '-' : game.home_score}
              </span>
            </div>

            <div className="flex flex-col items-center text-center">
              {game.home_team.logo_url && (
                <img
                  src={game.home_team.logo_url}
                  alt={game.home_team.abbreviation}
                  className="w-12 h-12 object-contain mb-1.5"
                />
              )}
              <span className="font-bold text-sm sm:text-base">{game.home_team.short_name}</span>
              <span className="text-[11px] text-slate-400">Local</span>
            </div>
          </div>

          {/* Linescores by Quarter */}
          {game.status !== 'scheduled' &&
            (game.away_linescores?.length || game.home_linescores?.length) && (
              <div className="mt-3 rounded-xl bg-slate-900/70 border border-slate-800/80 p-2.5 overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="text-left py-1 px-2 font-medium">EQUIPO</th>
                      {Array.from({ length: periods }).map((_, i) => (
                        <th key={i} className="text-center py-1 px-2 font-medium">
                          {i < 4 ? `Q${i + 1}` : `OT${i - 3}`}
                        </th>
                      ))}
                      <th className="text-right py-1 px-2 font-bold text-slate-300">T</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1.5 px-2 font-bold text-slate-200">
                        {game.away_team.abbreviation}
                      </td>
                      {Array.from({ length: periods }).map((_, i) => (
                        <td key={i} className="text-center py-1.5 px-2 text-slate-400">
                          {game.away_linescores?.[i] ?? '-'}
                        </td>
                      ))}
                      <td className="text-right py-1.5 px-2 font-extrabold text-white">
                        {game.away_score}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2 font-bold text-slate-200">
                        {game.home_team.abbreviation}
                      </td>
                      {Array.from({ length: periods }).map((_, i) => (
                        <td key={i} className="text-center py-1.5 px-2 text-slate-400">
                          {game.home_linescores?.[i] ?? '-'}
                        </td>
                      ))}
                      <td className="text-right py-1.5 px-2 font-extrabold text-white">
                        {game.home_score}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

          {game.venue && (
            <div className="mt-2.5 flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <MapPin className="w-3 h-3" />
              <span>{game.venue}</span>
            </div>
          )}
        </div>

        {/* Team Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-900/50">
          {[game.away_team, game.home_team].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTeamId(t.id)}
              className={`flex-1 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${
                activeTeamId === t.id
                  ? 'border-orange-500 text-white bg-slate-800/40'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.logo_url && <img src={t.logo_url} alt={t.abbreviation} className="w-4 h-4" />}
              <span>{t.short_name}</span>
            </button>
          ))}
        </div>

        {/* Box Score Body */}
        <div className="flex-1 overflow-auto p-2 sm:p-4">
          {game.status === 'scheduled' ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              El partido aún no ha iniciado. El box score aparecerá automáticamente al comenzar.
            </div>
          ) : loading ? (
            <div className="py-12 text-center text-slate-400 text-sm">Cargando box score...</div>
          ) : teamStats.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              Sin estadísticas de jugadores disponibles para este partido.
            </div>
          ) : (
            <table className="w-full text-xs tabular-nums whitespace-nowrap">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="text-left py-2 px-2 sticky left-0 bg-[#0f1623]">JUGADOR</th>
                  <th className="text-right py-2 px-2">MIN</th>
                  <th className="text-right py-2 px-2 text-orange-400">PTS</th>
                  <th className="text-right py-2 px-2">REB</th>
                  <th className="text-right py-2 px-2">AST</th>
                  <th className="text-right py-2 px-2">TC</th>
                  <th className="text-right py-2 px-2">3P</th>
                  <th className="text-right py-2 px-2">TL</th>
                  <th className="text-right py-2 px-2">ROB</th>
                  <th className="text-right py-2 px-2">TAP</th>
                  <th className="text-right py-2 px-2">+/-</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {teamStats.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onSelectPlayer(row.player_id)}
                    className={`cursor-pointer hover:bg-slate-800/40 ${
                      row.did_not_play ? 'opacity-45' : ''
                    }`}
                  >
                    <td className="py-2 px-2 sticky left-0 bg-[#0f1623]">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100 hover:text-orange-400">
                          {row.player?.full_name ?? `#${row.player_id}`}
                        </span>
                        {row.starter && !row.did_not_play && (
                          <span className="text-[10px] px-1 rounded bg-orange-500/15 text-orange-300 font-semibold">
                            TIT
                          </span>
                        )}
                      </div>
                    </td>
                    {row.did_not_play ? (
                      <td colSpan={10} className="py-2 px-2 text-right text-slate-500 italic">
                        {row.dnp_reason || 'No jugó (DNP)'}
                      </td>
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
                              ? 'text-emerald-400'
                              : row.plus_minus < 0
                                ? 'text-rose-400'
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
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
