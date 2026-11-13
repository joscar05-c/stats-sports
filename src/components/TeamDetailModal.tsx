import { useEffect, useState } from 'react';
import { X, Users, Calendar } from 'lucide-react';
import { fetchTeamRosterAndGames } from '../services/basketballApi';
import type { Game, Player, Team, TeamStanding } from '../types/database';

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
  const [tab, setTab] = useState<'roster' | 'games'>('roster');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchTeamRosterAndGames(team.id)
      .then((res) => {
        if (!active) return;
        setPlayers(res.players);
        setGames(res.games);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [team.id]);

  const accent = team.primary_color || '#f97316';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-[#0f1623] border border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="p-5 border-b border-slate-800"
          style={{
            background: `linear-gradient(135deg, ${accent}38 0%, #0f1623 70%)`,
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
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-white">{team.name}</h2>
                {standing && (
                  <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-slate-300 tabular-nums">
                    <span className="font-bold text-white">
                      {standing.wins}-{standing.losses} ({(Number(standing.win_pct) * 100).toFixed(1)}%)
                    </span>
                    {standing.playoff_seed && <span>Seed #{standing.playoff_seed}</span>}
                    {standing.streak && <span>Racha: {standing.streak}</span>}
                    {standing.ppg != null && <span>PPG: {standing.ppg}</span>}
                  </div>
                )}
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
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-900/50">
          <button
            onClick={() => setTab('roster')}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 border-b-2 ${
              tab === 'roster'
                ? 'border-orange-500 text-white bg-slate-800/40'
                : 'border-transparent text-slate-400'
            }`}
          >
            <Users className="w-4 h-4" /> Plantilla ({players.length})
          </button>
          <button
            onClick={() => setTab('games')}
            className={`flex-1 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 border-b-2 ${
              tab === 'games'
                ? 'border-orange-500 text-white bg-slate-800/40'
                : 'border-transparent text-slate-400'
            }`}
          >
            <Calendar className="w-4 h-4" /> Partidos ({games.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-3 sm:p-4">
          {loading ? (
            <div className="py-12 text-center text-slate-400 text-sm">Cargando datos...</div>
          ) : tab === 'roster' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {players.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSelectPlayer(p.id)}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-orange-500/50 text-left transition-colors"
                >
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
                </button>
              ))}
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
    </div>
  );
}
