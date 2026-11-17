import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Search, ShieldCheck, Users } from 'lucide-react';
import { fetchPlayers, fetchTeams } from '../services/basketballApi';
import type { League, Player, Team } from '../types/database';

interface ExploreViewProps {
  league: League;
  onSelectPlayer: (playerId: number) => void;
  onSelectTeam: (team: Team) => void;
}

export function ExploreView({ league, onSelectPlayer, onSelectTeam }: ExploreViewProps) {
  const [subTab, setSubTab] = useState<'players' | 'teams' | 'local'>('players');
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [posFilter, setPosFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([fetchPlayers(league.id), fetchTeams(league.id)])
      .then(([pList, tList]) => {
        if (!active) return;
        setPlayers(pList);
        setTeams(tList);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [league.id]);

  const filteredPlayers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return players
      .filter((p) => {
        if (teamFilter !== 'all' && String(p.team_id) !== teamFilter) return false;
        if (posFilter !== 'all' && !(p.position ?? '').includes(posFilter)) return false;
        if (!q) return true;
        return (
          p.full_name.toLowerCase().includes(q) ||
          (p.team?.short_name ?? '').toLowerCase().includes(q) ||
          (p.team?.abbreviation ?? '').toLowerCase().includes(q)
        );
      })
      .slice(0, 60);
  }, [players, query, teamFilter, posFilter]);

  const filteredTeams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.abbreviation.toLowerCase().includes(q) ||
        (t.city ?? '').toLowerCase().includes(q),
    );
  }, [teams, query]);

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <div className="flex items-center gap-2">
        {(
          [
            { key: 'players', label: `Jugadores (${players.length})` },
            { key: 'teams', label: `Equipos (${teams.length})` },
            { key: 'local', label: 'Ligas Locales' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              subTab === tab.key
                ? 'cv-tab-active'
                : 'bg-[#12151c] text-slate-300 border-white/[0.08] hover:border-white/[0.18] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab !== 'local' && (
        <search>
          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-3"
                aria-hidden="true"
              />
              <label htmlFor="explore-search" className="visually-hidden">
                {subTab === 'players' ? 'Buscar jugador o equipo' : 'Buscar franquicia'}
              </label>
              <input
                id="explore-search"
                name="q"
                type="search"
                spellCheck={false}
                enterKeyHint="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  subTab === 'players'
                    ? 'Buscar jugador o equipo (ej. Jokic, Lakers)...'
                    : 'Buscar franquicia...'
                }
                className="w-full bg-[#12151c] border border-white/[0.1] rounded-lg pl-9 pr-3 py-2 text-base sm:text-sm text-white placeholder:text-slate-500"
              />
            </div>

            {subTab === 'players' && (
              <div className="flex gap-2">
                <select
                  aria-label="Filtrar por equipo"
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="bg-[#12151c] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-slate-200"
                >
                  <option value="all">Todos los equipos</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.abbreviation} — {t.short_name}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filtrar por posición"
                  value={posFilter}
                  onChange={(e) => setPosFilter(e.target.value)}
                  className="bg-[#12151c] border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-slate-200"
                >
                  <option value="all">Posición</option>
                  <option value="G">Guard (G)</option>
                  <option value="F">Forward (F)</option>
                  <option value="C">Center (C)</option>
                </select>
              </div>
            )}
          </form>
        </search>
      )}

      {subTab === 'local' ? (
        <div className="sb-card rounded-xl p-5 space-y-4">
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-2.5 py-1 rounded-md bg-white/[0.06] text-slate-200 border border-white/[0.1]">
            <CalendarDays className="w-3.5 h-3.5 text-slate-300" aria-hidden="true" />
            Torneos locales y universitarios
          </div>
          <h3 className="text-lg font-bold text-white">
            Gestión de ligas locales y amateur
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
            Además de seguir la temporada NBA en tiempo real, la plataforma está preparada para
            incorporar torneos locales, universitarios y ligas independientes con registro de
            equipos, calendario y planillas de partido.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-3.5 space-y-1">
              <div className="font-semibold text-white flex items-center gap-1.5">
                <Users className="w-4 h-4 text-slate-300" aria-hidden="true" />
                Planilla de partido en cancha
              </div>
              <p className="text-slate-400">
                Registro ágil de puntos, rebotes, asistencias y faltas desde el teléfono durante el juego.
              </p>
            </div>
            <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-3.5 space-y-1">
              <div className="font-semibold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-slate-300" aria-hidden="true" />
                Control por organizador
              </div>
              <p className="text-slate-400">
                Cada organizador administra exclusivamente los equipos y actas de su torneo mientras las ligas oficiales permanecen en solo lectura.
              </p>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-16 rounded-xl sb-card animate-pulse"
            />
          ))}
        </div>
      ) : subTab === 'players' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {filteredPlayers.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectPlayer(p.id)}
              className={`flex items-center gap-3 p-3 rounded-xl sb-card sb-card-hover text-left ${
                idx >= 8 ? 'sb-deferred-item' : ''
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-white/[0.06] overflow-hidden shrink-0 flex items-center justify-center">
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
                <div className="font-semibold text-sm text-white truncate">{p.full_name}</div>
                <div className="text-xs text-slate-400">
                  {p.team?.abbreviation ?? 'FA'} · #{p.jersey_number ?? '-'} · {p.position ?? 'JUG'}
                  {p.height_display ? ` · ${p.height_display}` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filteredTeams.map((t, idx) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelectTeam(t)}
              className={`flex items-center gap-3 p-3.5 rounded-xl sb-card sb-card-hover text-left ${
                idx >= 9 ? 'sb-deferred-item' : ''
              }`}
            >
              {t.logo_url && (
                <img src={t.logo_url} alt={t.abbreviation} className="w-10 h-10 object-contain" />
              )}
              <div className="min-w-0">
                <div className="font-semibold text-sm text-white truncate">{t.name}</div>
                <div className="text-xs text-slate-400">
                  {t.abbreviation} · {t.conference ?? 'Liga'}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
