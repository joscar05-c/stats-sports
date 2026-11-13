import { useEffect, useMemo, useState } from 'react';
import { Search, ShieldCheck, Users, Sparkles } from 'lucide-react';
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
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
              subTab === tab.key
                ? 'bg-orange-500 text-slate-950 border-orange-400'
                : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab !== 'local' && (
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                subTab === 'players'
                  ? 'Buscar jugador o equipo (ej. Jokic, Lakers)...'
                  : 'Buscar franquicia...'
              }
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
            />
          </div>

          {subTab === 'players' && (
            <div className="flex gap-2">
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="bg-slate-900/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
              >
                <option value="all">Todos los equipos</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.abbreviation} — {t.short_name}
                  </option>
                ))}
              </select>

              <select
                value={posFilter}
                onChange={(e) => setPosFilter(e.target.value)}
                className="bg-slate-900/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
              >
                <option value="all">Posición</option>
                <option value="G">Guard (G)</option>
                <option value="F">Forward (F)</option>
                <option value="C">Center (C)</option>
              </select>
            </div>
          )}
        </div>
      )}

      {subTab === 'local' ? (
        <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-[#0f172a] to-orange-950/30 border border-orange-500/30 p-5 space-y-4">
          <div className="inline-flex items-center gap-2 text-xs font-bold px-2.5 py-1 rounded-full bg-orange-500/20 text-orange-300">
            <Sparkles className="w-3.5 h-3.5" />
            Arquitectura Híbrida Lista en Supabase
          </div>
          <h3 className="text-lg font-black text-white">
            Torneos Locales, Universitarios y Ligas de Barrio
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            La base de datos en Supabase ya cuenta con soporte nativo para ligas{' '}
            <code className="px-1.5 py-0.5 rounded bg-slate-800 text-orange-300 text-xs">
              source_type = 'manual'
            </code>
            , políticas RLS por organizador (<code className="text-xs text-sky-300">owner_id</code>)
            y Supabase Realtime activado en <code className="text-xs text-sky-300">games</code> y{' '}
            <code className="text-xs text-sky-300">player_game_stats</code>.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3.5 space-y-1">
              <div className="font-bold text-white flex items-center gap-1.5">
                <Users className="w-4 h-4 text-orange-400" />
                Planillero Móvil al Borde de Cancha
              </div>
              <p className="text-slate-400">
                Siguiente módulo: pantalla con botones grandes (+1, +2, +3, REB, AST, FALTA) para
                registrar partidos en vivo desde cualquier celular.
              </p>
            </div>
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3.5 space-y-1">
              <div className="font-bold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Aislamiento Seguro por RLS
              </div>
              <p className="text-slate-400">
                Solo el dueño autenticado de cada liga manual podrá editar sus equipos y box scores;
                las ligas pro quedan protegidas en modo lectura.
              </p>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-16 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse"
            />
          ))}
        </div>
      ) : subTab === 'players' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {filteredPlayers.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectPlayer(p.id)}
              className="flex items-center gap-3 p-3 rounded-2xl bg-slate-900/75 border border-slate-800/80 hover:border-orange-500/50 text-left transition-colors"
            >
              <div className="w-12 h-12 rounded-full bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
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
                  {p.team?.abbreviation ?? 'FA'} · #{p.jersey_number ?? '-'} · {p.position ?? 'JUG'}
                  {p.height_display ? ` · ${p.height_display}` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {filteredTeams.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelectTeam(t)}
              className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-900/75 border border-slate-800/80 hover:border-orange-500/50 text-left transition-colors"
            >
              {t.logo_url && (
                <img src={t.logo_url} alt={t.abbreviation} className="w-10 h-10 object-contain" />
              )}
              <div className="min-w-0">
                <div className="font-bold text-sm text-white truncate">{t.name}</div>
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
