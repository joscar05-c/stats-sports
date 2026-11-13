import { useEffect, useState } from 'react';
import { X, Download, Award, TrendingUp } from 'lucide-react';
import { fetchPlayerProfileAndLogs } from '../services/basketballApi';
import { downloadPlayerStatCard } from '../utils/shareCard';
import type { Player, PlayerGameStat, PlayerSeasonAverage } from '../types/database';

interface PlayerDetailModalProps {
  playerId: number;
  onClose: () => void;
}

export function PlayerDetailModal({ playerId, onClose }: PlayerDetailModalProps) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [average, setAverage] = useState<PlayerSeasonAverage | null>(null);
  const [logs, setLogs] = useState<PlayerGameStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchPlayerProfileAndLogs(playerId)
      .then((res) => {
        if (!active) return;
        setPlayer(res.player);
        setAverage(res.average);
        setLogs(res.logs);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [playerId]);

  const accent = player?.team?.primary_color || '#f97316';
  const maxPts = Math.max(...logs.map((l) => l.pts), 25);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-[#0f1623] border border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loading || !player ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            {loading ? 'Cargando ficha del jugador...' : 'No se encontró al jugador.'}
          </div>
        ) : (
          <>
            {/* Hero Header */}
            <div
              className="relative p-5 border-b border-slate-800/80"
              style={{
                background: `linear-gradient(135deg, ${accent}33 0%, #0f1623 70%)`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-2xl bg-slate-900/90 border border-slate-700/60 overflow-hidden shrink-0 flex items-center justify-center">
                    {player.headshot_url ? (
                      <img
                        src={player.headshot_url}
                        alt={player.full_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl font-black text-slate-500">
                        #{player.jersey_number ?? '?'}
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {player.team?.abbreviation && (
                        <span
                          className="text-[11px] font-bold px-2 py-0.5 rounded text-white"
                          style={{ backgroundColor: accent }}
                        >
                          {player.team.abbreviation}
                        </span>
                      )}
                      <span className="text-xs text-slate-300 font-semibold">
                        #{player.jersey_number ?? '-'} · {player.position ?? 'JUG'}
                      </span>
                    </div>
                    <h2 className="text-xl sm:text-2xl font-black text-white leading-tight">
                      {player.full_name}
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      {[
                        player.height_display,
                        player.weight_display,
                        player.age ? `${player.age} años` : null,
                        player.country,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="p-1.5 rounded-full bg-slate-900/80 text-slate-300 hover:bg-slate-800"
                  aria-label="Cerrar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {average && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3 text-xs text-slate-300">
                    <span className="inline-flex items-center gap-1">
                      <Award className="w-3.5 h-3.5 text-amber-400" />
                      Doble-Dobles: <strong className="text-white">{average.double_doubles}</strong>
                    </span>
                    {average.triple_doubles > 0 && (
                      <span>
                        Triple-Dobles:{' '}
                        <strong className="text-orange-400">{average.triple_doubles}</strong>
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => downloadPlayerStatCard(average)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Tarjeta PNG
                  </button>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto p-4 sm:p-5 space-y-5">
              {average ? (
                <>
                  {/* Main Averages Grid */}
                  <div className="grid grid-cols-4 gap-2 tabular-nums">
                    {[
                      { label: 'PPG', value: Number(average.ppg ?? 0).toFixed(1), hi: true },
                      { label: 'RPG', value: Number(average.rpg ?? 0).toFixed(1) },
                      { label: 'APG', value: Number(average.apg ?? 0).toFixed(1) },
                      { label: 'MPG', value: Number(average.mpg ?? 0).toFixed(1) },
                    ].map((st) => (
                      <div
                        key={st.label}
                        className="rounded-xl bg-slate-900/80 border border-slate-800 p-3 text-center"
                      >
                        <div className="text-[11px] font-semibold text-slate-400">{st.label}</div>
                        <div
                          className={`text-xl font-black mt-0.5 ${
                            st.hi ? 'text-orange-400' : 'text-white'
                          }`}
                        >
                          {st.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Shooting & Advanced Metrics */}
                  <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 p-3.5">
                    <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
                      Eficiencia de Tiro y Métricas Avanzadas ({average.gp} PJ)
                    </div>
                    <div className="grid grid-cols-5 gap-2 text-center tabular-nums">
                      {[
                        { label: 'FG%', val: average.fg_pct },
                        { label: '3P%', val: average.tp_pct },
                        { label: 'FT%', val: average.ft_pct },
                        { label: 'eFG%', val: average.efg_pct },
                        { label: 'TS%', val: average.ts_pct },
                      ].map((m) => (
                        <div key={m.label}>
                          <div className="text-[11px] text-slate-400">{m.label}</div>
                          <div className="text-sm font-bold text-slate-100 mt-0.5">
                            {m.val != null ? `${Number(m.val).toFixed(1)}%` : '-'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 text-center text-xs text-slate-400">
                  Este jugador aún no registra partidos finalizados en la temporada actual.
                </div>
              )}

              {/* Points Trend Chart (Lightweight Pure SVG) */}
              {logs.length > 0 && (
                <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 p-3.5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wider">
                      <TrendingUp className="w-3.5 h-3.5 text-orange-400" />
                      Puntos en últimos {logs.length} partidos
                    </span>
                  </div>
                  <div className="flex items-end gap-1.5 h-24 pt-4">
                    {[...logs].reverse().map((g) => {
                      const pct = Math.max(8, Math.round((g.pts / maxPts) * 100));
                      return (
                        <div
                          key={g.id}
                          className="flex-1 flex flex-col items-center justify-end h-full group"
                        >
                          <span className="text-[10px] font-bold text-slate-300 mb-1 tabular-nums">
                            {g.pts}
                          </span>
                          <div
                            className="w-full max-w-[26px] rounded-t-md bg-gradient-to-t from-orange-600 to-amber-400 transition-all"
                            style={{ height: `${pct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recent Game Log */}
              {logs.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Últimos Partidos
                  </h3>
                  <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full text-xs tabular-nums whitespace-nowrap">
                      <thead className="bg-slate-900/80 text-slate-400">
                        <tr>
                          <th className="text-left py-2 px-3">FECHA</th>
                          <th className="text-left py-2 px-2">RIVAL</th>
                          <th className="text-right py-2 px-2">MIN</th>
                          <th className="text-right py-2 px-2 text-orange-400">PTS</th>
                          <th className="text-right py-2 px-2">REB</th>
                          <th className="text-right py-2 px-2">AST</th>
                          <th className="text-right py-2 px-2">TC</th>
                          <th className="text-right py-2 px-3">3P</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {logs.map((row) => {
                          const isHome = row.game?.home_team_id === row.team_id;
                          const opp = isHome
                            ? row.game?.away_team?.abbreviation
                            : row.game?.home_team?.abbreviation;
                          return (
                            <tr key={row.id} className="hover:bg-slate-800/30">
                              <td className="py-2 px-3 text-slate-400">
                                {row.game?.game_date?.slice(5) ?? '-'}
                              </td>
                              <td className="py-2 px-2 font-semibold text-slate-200">
                                {isHome ? 'vs' : '@'} {opp ?? 'NBA'}
                              </td>
                              <td className="text-right py-2 px-2 text-slate-300">{row.minutes}</td>
                              <td className="text-right py-2 px-2 font-bold text-white">
                                {row.pts}
                              </td>
                              <td className="text-right py-2 px-2 text-slate-300">{row.reb}</td>
                              <td className="text-right py-2 px-2 text-slate-300">{row.ast}</td>
                              <td className="text-right py-2 px-2 text-slate-400">
                                {row.fgm}-{row.fga}
                              </td>
                              <td className="text-right py-2 px-3 text-slate-400">
                                {row.tpm}-{row.tpa}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
