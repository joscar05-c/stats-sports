import { useEffect, useMemo, useState } from 'react';
import { X, Users, Calendar, BarChart3, Flame } from 'lucide-react';
import { fetchTeamRosterAndGames } from '../services/basketballApi';
import type {
  Game,
  Player,
  PlayerSeasonAverage,
  Team,
  TeamSeasonAverage,
  TeamStanding,
} from '../types/database';
import { ModalDialog } from './ModalDialog';

interface TeamDetailModalProps {
  team: Team;
  standing?: TeamStanding;
  onClose: () => void;
  onSelectPlayer: (playerId: number) => void;
  onSelectGame: (game: Game) => void;
}

export function TeamDetailModal({
  team,
  standing,
  onClose,
  onSelectPlayer,
  onSelectGame,
}: TeamDetailModalProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [teamAvg, setTeamAvg] = useState<TeamSeasonAverage | null>(null);
  const [playerAvgs, setPlayerAvgs] = useState<PlayerSeasonAverage[]>([]);
  const [tab, setTab] = useState<'stats' | 'roster' | 'games'>('stats');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchTeamRosterAndGames(team.id)
      .then((res) => {
        if (!active) return;
        setPlayers(res.players);
        setGames(res.games);
        setTeamAvg(res.teamAverage);
        setPlayerAvgs(res.playerAverages);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [team.id]);

  const accent = team.primary_color || '#f97316';

  const avgByPlayerId = useMemo(() => {
    const map = new Map<number, PlayerSeasonAverage>();
    playerAvgs.forEach((pa) => map.set(pa.player_id, pa));
    return map;
  }, [playerAvgs]);

  const topScorer = useMemo(
    () => playerAvgs.toSorted((a, b) => Number(b.ppg ?? 0) - Number(a.ppg ?? 0))[0] ?? null,
    [playerAvgs],
  );
  const topRebounder = useMemo(
    () => playerAvgs.toSorted((a, b) => Number(b.rpg ?? 0) - Number(a.rpg ?? 0))[0] ?? null,
    [playerAvgs],
  );
  const topAssister = useMemo(
    () => playerAvgs.toSorted((a, b) => Number(b.apg ?? 0) - Number(a.apg ?? 0))[0] ?? null,
    [playerAvgs],
  );

  const wins = standing?.wins ?? teamAvg?.wins ?? 0;
  const losses = standing?.losses ?? teamAvg?.losses ?? 0;
  const winPct = standing?.win_pct ?? teamAvg?.win_pct ?? 0;
  const seed = standing?.playoff_seed ?? teamAvg?.playoff_seed;
  const streak = standing?.streak ?? teamAvg?.streak;
  const ppg = standing?.ppg ?? teamAvg?.ppg;
  const oppg = standing?.oppg ?? teamAvg?.oppg;
  const diff = standing?.diff ?? teamAvg?.diff;

  return (
    <ModalDialog
      onClose={onClose}
      ariaLabelledBy="team-modal-title"
      maxWidthCss="42rem"
      borderClass="border border-white/[0.1]"
    >
      {(requestClose) => (
        <div className="flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div
          className="shrink-0 p-5 border-b border-white/[0.08]"
          style={{
            background: `linear-gradient(135deg, ${accent}38 0%, #080d1a 72%)`,
          }}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              {team.logo_url && (
                <img
                  src={team.logo_url}
                  alt={team.abbreviation}
                  className="w-16 h-16 object-contain"
                />
              )}
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {team.conference ? `Conferencia ${team.conference}` : 'Equipo'}
                  {team.division ? ` · Div. ${team.division}` : ''}
                </span>
                <h2 id="team-modal-title" className="text-xl sm:text-2xl font-black text-white">
                  {team.name}
                </h2>
                {(wins > 0 || losses > 0) && (
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-300 tabular-nums">
                    <span className="font-bold text-white">
                      {wins}-{losses} ({(Number(winPct) * 100).toFixed(1)}%)
                    </span>
                    {seed && <span>Seed #{seed}</span>}
                    {streak && <span>Racha: {streak}</span>}
                    {ppg != null && <span>PPG: {Number(ppg).toFixed(1)}</span>}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="p-1.5 rounded-full bg-slate-900/80 text-slate-300 hover:bg-slate-800"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex border-b border-slate-800 bg-slate-900/50">
          <button
            onClick={() => setTab('stats')}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              tab === 'stats'
                ? 'border-orange-500 text-white bg-slate-800/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" /> Estadísticas
          </button>
          <button
            onClick={() => setTab('roster')}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              tab === 'roster'
                ? 'border-orange-500 text-white bg-slate-800/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" /> Plantilla ({players.length})
          </button>
          <button
            onClick={() => setTab('games')}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              tab === 'games'
                ? 'border-orange-500 text-white bg-slate-800/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-4 h-4" /> Partidos ({games.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto sb-scroller p-3 sm:p-4">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-sm">Cargando datos...</div>
          ) : tab === 'stats' ? (
            <div className="space-y-4">
              {/* Primary KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 tabular-nums">
                {[
                  {
                    label: 'Ataque (PPG)',
                    val: ppg != null ? Number(ppg).toFixed(1) : '-',
                    sub: 'Pts anotados',
                    color: 'text-orange-400',
                  },
                  {
                    label: 'Defensa (OPPG)',
                    val: oppg != null ? Number(oppg).toFixed(1) : '-',
                    sub: 'Pts recibidos',
                    color: 'text-sky-400',
                  },
                  {
                    label: 'Diferencial',
                    val:
                      diff != null
                        ? `${Number(diff) > 0 ? '+' : ''}${Number(diff).toFixed(1)}`
                        : '-',
                    sub: 'Margen neto',
                    color:
                      Number(diff ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400',
                  },
                  {
                    label: 'Pts de Banca',
                    val: teamAvg ? Number(teamAvg.bench_ppg).toFixed(1) : '-',
                    sub: 'Suplentes / PJ',
                    color: 'text-amber-300',
                  },
                ].map((k) => (
                  <div
                    key={k.label}
                    className="rounded-xl bg-slate-900/80 border border-slate-800 p-3 text-center"
                  >
                    <div className="text-[11px] font-bold uppercase text-slate-400">{k.label}</div>
                    <div className={`text-xl font-black mt-0.5 ${k.color}`}>{k.val}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{k.sub}</div>
                  </div>
                ))}
              </div>

              {/* Splits: Local / Visita / Últimos 10 */}
              <div className="grid grid-cols-3 gap-2.5 text-center tabular-nums">
                <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 p-2.5">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Récord Local</div>
                  <div className="text-sm font-black text-white mt-0.5">
                    {standing?.home_record ?? teamAvg?.home_record ?? '-'}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 p-2.5">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Récord Visita</div>
                  <div className="text-sm font-black text-white mt-0.5">
                    {standing?.away_record ?? teamAvg?.away_record ?? '-'}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-900/60 border border-slate-800/80 p-2.5">
                  <div className="text-[10px] font-bold uppercase text-slate-400">Últimos 10</div>
                  <div className="text-sm font-black text-white mt-0.5">
                    {standing?.last_ten ?? teamAvg?.last_ten ?? '-'}
                  </div>
                </div>
              </div>

              {/* Shooting Efficiency & Collective Box Score Averages */}
              {teamAvg && (
                <>
                  <div className="rounded-2xl bg-slate-900/75 border border-slate-800 p-3.5 space-y-3 tabular-nums">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                      Eficiencia de Tiro Colectiva
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                      {[
                        {
                          label: 'Tiros Campo',
                          pct: teamAvg.fg_pct,
                          madeAtt: `${Number(teamAvg.fgm_pg).toFixed(1)}/${Number(teamAvg.fga_pg).toFixed(1)}`,
                        },
                        {
                          label: 'Triples (3P)',
                          pct: teamAvg.tp_pct,
                          madeAtt: `${Number(teamAvg.tpm_pg).toFixed(1)}/${Number(teamAvg.tpa_pg).toFixed(1)}`,
                        },
                        {
                          label: 'Tiros Libres',
                          pct: teamAvg.ft_pct,
                          madeAtt: `${Number(teamAvg.ftm_pg).toFixed(1)}/${Number(teamAvg.fta_pg).toFixed(1)}`,
                        },
                        {
                          label: 'Effective FG%',
                          pct: teamAvg.efg_pct,
                          madeAtt: 'eFG%',
                        },
                        {
                          label: 'True Shooting',
                          pct: teamAvg.ts_pct,
                          madeAtt: 'TS%',
                        },
                      ].map((sh) => (
                        <div
                          key={sh.label}
                          className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5 text-center"
                        >
                          <div className="text-[10px] font-bold text-slate-400">{sh.label}</div>
                          <div className="text-base font-black text-orange-400 mt-0.5">
                            {sh.pct != null ? `${Number(sh.pct).toFixed(1)}%` : '-'}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{sh.madeAtt}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-900/75 border border-slate-800 p-3.5 space-y-3 tabular-nums">
                    <div className="text-xs font-extrabold uppercase tracking-wider text-slate-300">
                      Promedios Colectivos por Partido
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center">
                      {[
                        { label: 'Rebotes (RPG)', val: Number(teamAvg.rpg).toFixed(1) },
                        { label: 'Reb. Ofensivos', val: Number(teamAvg.oreb_pg).toFixed(1) },
                        { label: 'Reb. Defensivos', val: Number(teamAvg.dreb_pg).toFixed(1) },
                        { label: 'Asistencias', val: Number(teamAvg.apg).toFixed(1) },
                        { label: 'Ratio AST/TOV', val: Number(teamAvg.ast_to_tov ?? 0).toFixed(2) },
                        { label: 'Robos (SPG)', val: Number(teamAvg.spg).toFixed(1) },
                        { label: 'Tapones (BPG)', val: Number(teamAvg.bpg).toFixed(1) },
                        { label: 'Pérdidas (TOV)', val: Number(teamAvg.topg).toFixed(1) },
                        { label: 'Faltas (PF)', val: Number(teamAvg.pf_pg).toFixed(1) },
                        { label: 'Partidos (PJ)', val: String(teamAvg.gp) },
                      ].map((st) => (
                        <div
                          key={st.label}
                          className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5"
                        >
                          <div className="text-[10px] text-slate-400 font-semibold">{st.label}</div>
                          <div className="text-sm font-black text-white mt-0.5">{st.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Team Leaders */}
              {(topScorer || topRebounder || topAssister) && (
                <div className="rounded-2xl bg-slate-900/75 border border-slate-800 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-300">
                    <Flame className="w-3.5 h-3.5 text-orange-400" />
                    Líderes del Equipo en la Temporada
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {[
                      { role: 'Puntos (PPG)', p: topScorer, val: topScorer?.ppg },
                      { role: 'Rebotes (RPG)', p: topRebounder, val: topRebounder?.rpg },
                      { role: 'Asistencias (APG)', p: topAssister, val: topAssister?.apg },
                    ].map(
                      (item) =>
                        item.p && (
                          <button
                            key={item.role}
                            type="button"
                            onClick={() => onSelectPlayer(item.p!.player_id)}
                            className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-orange-500/50 text-left transition-colors"
                          >
                            <div className="w-10 h-10 rounded-full bg-slate-800 overflow-hidden shrink-0">
                              {item.p.headshot_url && (
                                <img
                                  src={item.p.headshot_url}
                                  alt={item.p.full_name}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-bold uppercase text-orange-400">
                                {item.role}
                              </div>
                              <div className="text-xs font-bold text-white truncate">
                                {item.p.full_name}
                              </div>
                              <div className="text-sm font-black text-slate-200 tabular-nums">
                                {Number(item.val ?? 0).toFixed(1)}
                              </div>
                            </div>
                          </button>
                        ),
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'roster' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {players.map((p) => {
                const pa = avgByPlayerId.get(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelectPlayer(p.id)}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-orange-500/50 text-left transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-full bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                        {p.headshot_url ? (
                          <img
                            src={p.headshot_url}
                            alt={p.full_name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-xs font-bold text-slate-400">
                            #{p.jersey_number ?? '?'}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-sm text-white truncate">{p.full_name}</div>
                        <div className="text-xs text-slate-400">
                          #{p.jersey_number ?? '-'} · {p.position ?? 'JUG'}
                          {p.height_display ? ` · ${p.height_display}` : ''}
                        </div>
                      </div>
                    </div>

                    {pa && (
                      <div className="text-right shrink-0 tabular-nums">
                        <div className="text-xs font-black text-orange-400">
                          {Number(pa.ppg).toFixed(1)} PTS
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {Number(pa.rpg).toFixed(1)} R · {Number(pa.apg).toFixed(1)} A
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {games.map((g) => {
                const isHome = g.home_team_id === team.id;
                const opp = isHome ? g.away_team : g.home_team;
                const myScore = isHome ? g.home_score : g.away_score;
                const oppScore = isHome ? g.away_score : g.home_score;
                const won = g.status === 'final' && myScore > oppScore;
                return (
                  <button
                    key={g.id}
                    onClick={() => onSelectGame(g)}
                    className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-orange-500/50 text-left tabular-nums"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-12">{g.game_date.slice(5)}</span>
                      {opp.logo_url && (
                        <img src={opp.logo_url} alt={opp.abbreviation} className="w-6 h-6" />
                      )}
                      <div>
                        <div className="text-sm font-bold text-white">
                          {isHome ? 'vs' : '@'} {opp.short_name}
                        </div>
                        <div className="text-[11px] text-slate-400">{g.status_detail}</div>
                      </div>
                    </div>
                    {g.status === 'scheduled' ? (
                      <span className="text-xs font-semibold text-slate-400">Programado</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        {g.status === 'final' && (
                          <span
                            className={`text-[11px] font-black px-1.5 py-0.5 rounded ${
                              won
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {won ? 'G' : 'P'}
                          </span>
                        )}
                        <span className="font-black text-sm text-white">
                          {myScore}-{oppScore}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        </div>
      )}
    </ModalDialog>
  );
}
