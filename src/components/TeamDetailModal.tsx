import { useEffect, useMemo, useState } from 'react';
import { X, Users, Calendar, BarChart3, Flame } from 'lucide-react';
import { fetchTeamRosterAndGames } from '../services/basketballApi';
import type {
  FootballPlayerSeasonAverage,
  FootballTeamSeasonAverage,
  Game,
  Player,
  PlayerSeasonAverage,
  Team,
  TeamSeasonAverage,
  TeamStanding,
} from '../types/database';
import { ModalDialog } from './ModalDialog';
import { PlayerAvatar } from './PlayerAvatar';

interface TeamDetailModalProps {
  team: Team;
  standing?: TeamStanding;
  sport?: 'basketball' | 'football';
  onClose: () => void;
  onSelectPlayer: (playerId: number) => void;
  onSelectGame: (game: Game) => void;
}

export function TeamDetailModal({
  team,
  standing,
  sport = 'basketball',
  onClose,
  onSelectPlayer,
  onSelectGame,
}: TeamDetailModalProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [teamAvg, setTeamAvg] = useState<TeamSeasonAverage | null>(null);
  const [playerAvgs, setPlayerAvgs] = useState<PlayerSeasonAverage[]>([]);
  const [fbTeamAvg, setFbTeamAvg] = useState<FootballTeamSeasonAverage | null>(null);
  const [fbPlayerAvgs, setFbPlayerAvgs] = useState<FootballPlayerSeasonAverage[]>([]);
  const [tab, setTab] = useState<'stats' | 'roster' | 'games'>('stats');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchTeamRosterAndGames(team.id, sport)
      .then((res) => {
        if (!active) return;
        setPlayers(res.players);
        setGames(res.games);
        setTeamAvg(res.teamAverage);
        setPlayerAvgs(res.playerAverages);
        setFbTeamAvg(res.footballTeamAverage);
        setFbPlayerAvgs(res.footballPlayerAverages);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [team.id, sport]);

  const avgByPlayerId = useMemo(() => {
    const map = new Map<number, PlayerSeasonAverage>();
    playerAvgs.forEach((pa) => map.set(pa.player_id, pa));
    return map;
  }, [playerAvgs]);

  const fbAvgByPlayerId = useMemo(() => {
    const map = new Map<number, FootballPlayerSeasonAverage>();
    fbPlayerAvgs.forEach((pa) => map.set(pa.player_id, pa));
    return map;
  }, [fbPlayerAvgs]);

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

  const fbTopScorer = useMemo(
    () => fbPlayerAvgs.toSorted((a, b) => b.goals - a.goals)[0] ?? null,
    [fbPlayerAvgs],
  );
  const fbTopAssister = useMemo(
    () => fbPlayerAvgs.toSorted((a, b) => b.assists - a.assists)[0] ?? null,
    [fbPlayerAvgs],
  );
  const fbTopShooter = useMemo(
    () => fbPlayerAvgs.toSorted((a, b) => b.shots - a.shots)[0] ?? null,
    [fbPlayerAvgs],
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
        <div className="shrink-0 p-5 border-b border-white/[0.08] bg-[#12151c]">
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
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {sport === 'football'
                    ? `Club · ${team.city ?? 'Premier League'}`
                    : `${team.conference ? `Conferencia ${team.conference}` : 'Equipo'}${team.division ? ` · Div. ${team.division}` : ''}`}
                </span>
                <h2 id="team-modal-title" className="text-xl sm:text-2xl font-bold text-white">
                  {team.name}
                </h2>
                {sport === 'football' ? (
                  fbTeamAvg && (
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-300 tabular-nums">
                      <span className="font-bold text-white">{fbTeamAvg.points} PTS</span>
                      <span>
                        {fbTeamAvg.wins}G · {fbTeamAvg.draws}E · {fbTeamAvg.losses}P
                      </span>
                      {fbTeamAvg.rank && <span>Posición #{fbTeamAvg.rank}</span>}
                      <span>
                        DG {fbTeamAvg.goal_diff > 0 ? `+${fbTeamAvg.goal_diff}` : fbTeamAvg.goal_diff}
                      </span>
                    </div>
                  )
                ) : (
                  (wins > 0 || losses > 0) && (
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-300 tabular-nums">
                      <span className="font-bold text-white">
                        {wins}-{losses} ({(Number(winPct) * 100).toFixed(1)}%)
                      </span>
                      {seed && <span>Seed #{seed}</span>}
                      {streak && <span>Racha: {streak}</span>}
                      {ppg != null && <span>PPG: {Number(ppg).toFixed(1)}</span>}
                    </div>
                  )
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="p-1.5 rounded-full bg-white/[0.05] border border-white/[0.1] text-slate-300 hover:text-white"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex border-b border-white/[0.08] bg-[#0e1117]">
          <button
            onClick={() => setTab('stats')}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              tab === 'stats'
                ? 'border-white text-white bg-white/[0.04]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" aria-hidden="true" /> Estadísticas
          </button>
          <button
            onClick={() => setTab('roster')}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              tab === 'roster'
                ? 'border-white text-white bg-white/[0.04]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" aria-hidden="true" /> Plantilla ({players.length})
          </button>
          <button
            onClick={() => setTab('games')}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors ${
              tab === 'games'
                ? 'border-white text-white bg-white/[0.04]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Calendar className="w-4 h-4" aria-hidden="true" /> Partidos ({games.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto sb-scroller p-3 sm:p-4">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-sm">Cargando datos...</div>
          ) : tab === 'stats' ? (
            sport === 'football' ? (
              <div className="space-y-4">
                {fbTeamAvg ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 tabular-nums">
                      {[
                        { label: 'Puntos', val: String(fbTeamAvg.points), sub: `${fbTeamAvg.played} PJ`, color: 'text-white' },
                        { label: 'Goles a Favor', val: String(fbTeamAvg.goals_for), sub: `${Number(fbTeamAvg.gf_pg).toFixed(2)} / PJ`, color: 'text-white' },
                        { label: 'Goles Recibidos', val: String(fbTeamAvg.goals_against), sub: `${Number(fbTeamAvg.ga_pg).toFixed(2)} / PJ`, color: 'text-white' },
                        {
                          label: 'Dif. de Gol',
                          val: `${fbTeamAvg.goal_diff > 0 ? '+' : ''}${fbTeamAvg.goal_diff}`,
                          sub: `${fbTeamAvg.clean_sheets} vallas inv.`,
                          color: fbTeamAvg.goal_diff >= 0 ? 'text-emerald-300' : 'text-rose-300',
                        },
                      ].map((k) => (
                        <div key={k.label} className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3 text-center">
                          <div className="text-[11px] font-semibold uppercase text-slate-400">{k.label}</div>
                          <div className={`text-xl font-bold mt-0.5 ${k.color}`}>{k.val}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{k.sub}</div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3.5 space-y-3 tabular-nums">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
                        Promedios Colectivos por Partido
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 text-center">
                        {[
                          { label: 'Posesión', val: fbTeamAvg.possession_avg != null ? `${Number(fbTeamAvg.possession_avg).toFixed(1)}%` : '-' },
                          { label: 'Remates / PJ', val: fbTeamAvg.shots_pg != null ? Number(fbTeamAvg.shots_pg).toFixed(1) : '-' },
                          { label: 'Al Arco / PJ', val: fbTeamAvg.sot_pg != null ? Number(fbTeamAvg.sot_pg).toFixed(1) : '-' },
                          { label: 'Córners / PJ', val: fbTeamAvg.corners_pg != null ? Number(fbTeamAvg.corners_pg).toFixed(1) : '-' },
                          { label: 'Cór. Conc./PJ', val: fbTeamAvg.corners_against_pg != null ? Number(fbTeamAvg.corners_against_pg).toFixed(1) : '-' },
                          { label: 'Faltas / PJ', val: fbTeamAvg.fouls_pg != null ? Number(fbTeamAvg.fouls_pg).toFixed(1) : '-' },
                          { label: 'Faltas Rec./PJ', val: fbTeamAvg.fouls_drawn_pg != null ? Number(fbTeamAvg.fouls_drawn_pg).toFixed(1) : '-' },
                          { label: 'Amarillas / PJ', val: fbTeamAvg.yellow_cards_pg != null ? Number(fbTeamAvg.yellow_cards_pg).toFixed(2) : '-' },
                          { label: 'Tarjetas A/R', val: `${fbTeamAvg.yellow_cards}/${fbTeamAvg.red_cards}` },
                          { label: 'Offsides / PJ', val: fbTeamAvg.offsides_pg != null ? Number(fbTeamAvg.offsides_pg).toFixed(1) : '-' },
                          { label: 'Atajadas / PJ', val: fbTeamAvg.saves_pg != null ? Number(fbTeamAvg.saves_pg).toFixed(1) : '-' },
                          {
                            label: 'BTTS / +2.5',
                            val:
                              fbTeamAvg.btts_pct != null && fbTeamAvg.over_25_pct != null
                                ? `${Math.round(Number(fbTeamAvg.btts_pct))}% / ${Math.round(Number(fbTeamAvg.over_25_pct))}%`
                                : '-',
                          },
                        ].map((st) => (
                          <div key={st.label} className="rounded-lg bg-[#12151c] border border-white/[0.07] p-2.5">
                            <div className="text-[10px] text-slate-400 font-medium">{st.label}</div>
                            <div className="text-sm font-bold text-white mt-0.5">{st.val}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {(fbTopScorer || fbTopAssister || fbTopShooter) && (
                      <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3.5 space-y-2.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300">
                          <Flame className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                          Líderes del Club en la Temporada
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          {[
                            { role: 'Goles', p: fbTopScorer, val: fbTopScorer?.goals },
                            { role: 'Asistencias', p: fbTopAssister, val: fbTopAssister?.assists },
                            { role: 'Remates', p: fbTopShooter, val: fbTopShooter?.shots },
                          ].map(
                            (item) =>
                              item.p && (
                                <button
                                  key={item.role}
                                  type="button"
                                  onClick={() => onSelectPlayer(item.p!.player_id)}
                                  className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#12151c] border border-white/[0.08] hover:border-white/[0.2] text-left transition-colors"
                                >
                                  <PlayerAvatar
                                    src={item.p.headshot_url}
                                    name={item.p.full_name}
                                    className="w-10 h-10 rounded-full bg-white/[0.06] overflow-hidden shrink-0 flex items-center justify-center"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="text-[10px] font-semibold uppercase text-slate-400">
                                      {item.role}
                                    </div>
                                    <div className="text-xs font-semibold text-white truncate">
                                      {item.p.full_name}
                                    </div>
                                    <div className="text-sm font-bold text-slate-200 tabular-nums">
                                      {item.val ?? 0}
                                    </div>
                                  </div>
                                </button>
                              ),
                          )}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-10 text-center text-sm text-slate-400">
                    Sin estadísticas colectivas disponibles aún.
                  </div>
                )}
              </div>
            ) : (
            <div className="space-y-4">
              {/* Primary KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 tabular-nums">
                {[
                  {
                    label: 'Ataque (PPG)',
                    val: ppg != null ? Number(ppg).toFixed(1) : '-',
                    sub: 'Pts anotados',
                    color: 'text-white',
                  },
                  {
                    label: 'Defensa (OPPG)',
                    val: oppg != null ? Number(oppg).toFixed(1) : '-',
                    sub: 'Pts recibidos',
                    color: 'text-white',
                  },
                  {
                    label: 'Diferencial',
                    val:
                      diff != null
                        ? `${Number(diff) > 0 ? '+' : ''}${Number(diff).toFixed(1)}`
                        : '-',
                    sub: 'Margen neto',
                    color:
                      Number(diff ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300',
                  },
                  {
                    label: 'Pts de Banca',
                    val: teamAvg ? Number(teamAvg.bench_ppg).toFixed(1) : '-',
                    sub: 'Suplentes / PJ',
                    color: 'text-slate-100',
                  },
                ].map((k) => (
                  <div
                    key={k.label}
                    className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3 text-center"
                  >
                    <div className="text-[11px] font-semibold uppercase text-slate-400">{k.label}</div>
                    <div className={`text-xl font-bold mt-0.5 ${k.color}`}>{k.val}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{k.sub}</div>
                  </div>
                ))}
              </div>

              {/* Splits: Local / Visita / Últimos 10 */}
              <div className="grid grid-cols-3 gap-2.5 text-center tabular-nums">
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-2.5">
                  <div className="text-[10px] font-semibold uppercase text-slate-400">Récord Local</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {standing?.home_record ?? teamAvg?.home_record ?? '-'}
                  </div>
                </div>
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-2.5">
                  <div className="text-[10px] font-semibold uppercase text-slate-400">Récord Visita</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {standing?.away_record ?? teamAvg?.away_record ?? '-'}
                  </div>
                </div>
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-2.5">
                  <div className="text-[10px] font-semibold uppercase text-slate-400">Últimos 10</div>
                  <div className="text-sm font-bold text-white mt-0.5">
                    {standing?.last_ten ?? teamAvg?.last_ten ?? '-'}
                  </div>
                </div>
              </div>

              {/* Shooting Efficiency & Collective Box Score Averages */}
              {teamAvg && (
                <>
                  <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3.5 space-y-3 tabular-nums">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
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
                          className="rounded-lg bg-[#12151c] border border-white/[0.07] p-2.5 text-center"
                        >
                          <div className="text-[10px] font-semibold text-slate-400">{sh.label}</div>
                          <div className="text-base font-bold text-white mt-0.5">
                            {sh.pct != null ? `${Number(sh.pct).toFixed(1)}%` : '-'}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{sh.madeAtt}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3.5 space-y-3 tabular-nums">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-300">
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
                          className="rounded-lg bg-[#12151c] border border-white/[0.07] p-2.5"
                        >
                          <div className="text-[10px] text-slate-400 font-medium">{st.label}</div>
                          <div className="text-sm font-bold text-white mt-0.5">{st.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Team Leaders */}
              {(topScorer || topRebounder || topAssister) && (
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3.5 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300">
                    <Flame className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
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
                            className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[#12151c] border border-white/[0.08] hover:border-white/[0.2] text-left transition-colors"
                          >
                            <PlayerAvatar
                              src={item.p.headshot_url}
                              name={item.p.full_name}
                              className="w-10 h-10 rounded-full bg-white/[0.06] overflow-hidden shrink-0 flex items-center justify-center"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-[10px] font-semibold uppercase text-slate-400">
                                {item.role}
                              </div>
                              <div className="text-xs font-semibold text-white truncate">
                                {item.p.full_name}
                              </div>
                              <div className="text-sm font-bold text-slate-200 tabular-nums">
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
            )
          ) : tab === 'roster' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {players.map((p) => {
                const pa = avgByPlayerId.get(p.id);
                const fbPa = fbAvgByPlayerId.get(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelectPlayer(p.id)}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[#0e1117] border border-white/[0.08] hover:border-white/[0.2] text-left transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <PlayerAvatar
                        src={p.headshot_url}
                        name={p.full_name}
                        className="w-11 h-11 rounded-full bg-white/[0.06] overflow-hidden shrink-0 flex items-center justify-center"
                        fallbackText={p.jersey_number ? `#${p.jersey_number}` : undefined}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm text-white truncate">{p.full_name}</div>
                        <div className="text-xs text-slate-400">
                          #{p.jersey_number ?? '-'} · {p.position ?? 'JUG'}
                          {p.height_display ? ` · ${p.height_display}` : ''}
                        </div>
                      </div>
                    </div>

                    {sport === 'football' ? (
                      fbPa && (
                        <div className="text-right shrink-0 tabular-nums">
                          <div className="text-xs font-bold text-white">{fbPa.goals} G</div>
                          <div className="text-[10px] text-slate-400">
                            {fbPa.assists} A · {fbPa.shots} REM
                          </div>
                        </div>
                      )
                    ) : (
                      pa && (
                        <div className="text-right shrink-0 tabular-nums">
                          <div className="text-xs font-bold text-white">
                            {Number(pa.ppg).toFixed(1)} PTS
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {Number(pa.rpg).toFixed(1)} R · {Number(pa.apg).toFixed(1)} A
                          </div>
                        </div>
                      )
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
                const drew = g.status === 'final' && myScore === oppScore;
                return (
                  <button
                    key={g.id}
                    onClick={() => onSelectGame(g)}
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-[#0e1117] border border-white/[0.08] hover:border-white/[0.2] text-left tabular-nums transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-12">{g.game_date.slice(5)}</span>
                      {opp.logo_url && (
                        <img src={opp.logo_url} alt={opp.abbreviation} className="w-6 h-6" />
                      )}
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {isHome ? 'vs' : '@'} {opp.short_name}
                        </div>
                        <div className="text-[11px] text-slate-400">{g.status_detail}</div>
                      </div>
                    </div>
                    {g.status === 'scheduled' ? (
                      <span className="text-xs font-medium text-slate-400">Programado</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        {g.status === 'final' && (
                          <span
                            className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                              won
                                ? 'bg-emerald-500/12 text-emerald-300'
                                : drew
                                  ? 'bg-white/[0.06] text-slate-300'
                                  : 'bg-rose-500/12 text-rose-300'
                            }`}
                          >
                            {won ? 'G' : drew ? 'E' : 'P'}
                          </span>
                        )}
                        <span className="font-bold text-sm text-white">
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
