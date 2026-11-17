import { useEffect, useMemo, useState } from 'react';
import { Flame, Filter, Shield, User } from 'lucide-react';
import { fetchSeasonAverages, fetchTeamSeasonAverages } from '../services/basketballApi';
import type { PlayerSeasonAverage, Team, TeamSeasonAverage } from '../types/database';

interface LeadersViewProps {
  leagueId: number;
  seasonId: number;
  onSelectPlayer: (playerId: number) => void;
  onSelectTeam?: (team: Team) => void;
}

type LeaderMode = 'players' | 'teams';

type PlayerStatMetricKey =
  | 'ppg'
  | 'rpg'
  | 'apg'
  | 'spg'
  | 'bpg'
  | 'fg_pct'
  | 'tp_pct'
  | 'ft_pct'
  | 'ts_pct'
  | 'efg_pct'
  | 'plus_minus_avg'
  | 'double_doubles'
  | 'triple_doubles';

type TeamStatMetricKey =
  | 'ppg'
  | 'oppg'
  | 'diff'
  | 'win_pct'
  | 'rpg'
  | 'oreb_pg'
  | 'apg'
  | 'spg'
  | 'bpg'
  | 'tpm_pg'
  | 'fg_pct'
  | 'tp_pct'
  | 'ft_pct'
  | 'ts_pct'
  | 'efg_pct'
  | 'ast_to_tov'
  | 'bench_ppg';

const PLAYER_CATEGORIES: Array<{
  key: PlayerStatMetricKey;
  label: string;
  suffix?: string;
  minGames?: number;
  isInt?: boolean;
  showSign?: boolean;
}> = [
  { key: 'ppg', label: 'Puntos' },
  { key: 'rpg', label: 'Rebotes' },
  { key: 'apg', label: 'Asistencias' },
  { key: 'spg', label: 'Robos' },
  { key: 'bpg', label: 'Tapones' },
  { key: 'fg_pct', label: 'TC%', suffix: '%', minGames: 4 },
  { key: 'tp_pct', label: '3P%', suffix: '%', minGames: 4 },
  { key: 'ft_pct', label: 'TL%', suffix: '%', minGames: 4 },
  { key: 'ts_pct', label: 'TS%', suffix: '%', minGames: 4 },
  { key: 'efg_pct', label: 'eFG%', suffix: '%', minGames: 4 },
  { key: 'plus_minus_avg', label: '+/- Prom.', showSign: true },
  { key: 'double_doubles', label: 'Doble-Dobles', isInt: true },
  { key: 'triple_doubles', label: 'Triple-Dobles', isInt: true },
];

const TEAM_CATEGORIES: Array<{
  key: TeamStatMetricKey;
  label: string;
  subtitle: string;
  suffix?: string;
  asc?: boolean;
  decimals?: number;
  showSign?: boolean;
}> = [
  { key: 'ppg', label: 'Ataque (PPG)', subtitle: 'Puntos anotados por partido' },
  { key: 'oppg', label: 'Defensa (OPPG)', subtitle: 'Menos puntos recibidos por partido', asc: true },
  { key: 'diff', label: 'Diferencial', subtitle: 'Margen neto de puntos por partido', showSign: true },
  { key: 'win_pct', label: '% Victorias', subtitle: 'Porcentaje de triunfos en la temporada', suffix: '%' },
  { key: 'rpg', label: 'Rebotes (RPG)', subtitle: 'Rebotes totales por partido' },
  { key: 'oreb_pg', label: 'Reb. Ofensivos', subtitle: 'Rebotes ofensivos por partido' },
  { key: 'apg', label: 'Asistencias (APG)', subtitle: 'Asistencias colectivas por partido' },
  { key: 'tpm_pg', label: 'Triples (3PM)', subtitle: 'Triples anotados por partido' },
  { key: 'fg_pct', label: 'TC%', subtitle: 'Efectividad en tiros de campo', suffix: '%' },
  { key: 'tp_pct', label: '3P%', subtitle: 'Efectividad en triples', suffix: '%' },
  { key: 'ft_pct', label: 'TL%', subtitle: 'Efectividad en tiros libres', suffix: '%' },
  { key: 'ts_pct', label: 'True Shooting %', subtitle: 'Eficiencia real de anotación (TS%)', suffix: '%' },
  { key: 'efg_pct', label: 'eFG%', subtitle: 'Porcentaje efectivo de tiro de campo', suffix: '%' },
  { key: 'spg', label: 'Robos (SPG)', subtitle: 'Recuperaciones por partido' },
  { key: 'bpg', label: 'Tapones (BPG)', subtitle: 'Bloqueos por partido' },
  { key: 'ast_to_tov', label: 'Ratio AST/TOV', subtitle: 'Asistencias por cada balón perdido', decimals: 2 },
  { key: 'bench_ppg', label: 'Pts de Banca', subtitle: 'Puntos anotados por suplentes por partido' },
];

export function LeadersView({
  leagueId,
  seasonId,
  onSelectPlayer,
  onSelectTeam,
}: LeadersViewProps) {
  const [mode, setMode] = useState<LeaderMode>('players');
  const [averages, setAverages] = useState<PlayerSeasonAverage[]>([]);
  const [teamAverages, setTeamAverages] = useState<TeamSeasonAverage[]>([]);
  const [playerMetric, setPlayerMetric] = useState<PlayerStatMetricKey>('ppg');
  const [teamMetric, setTeamMetric] = useState<TeamStatMetricKey>('ppg');
  const [minGp, setMinGp] = useState<number>(3);
  const [conferenceFilter, setConferenceFilter] = useState<'ALL' | 'East' | 'West'>('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchSeasonAverages(leagueId, seasonId),
      fetchTeamSeasonAverages(leagueId, seasonId),
    ])
      .then(([pRes, tRes]) => {
        if (!active) return;
        setAverages(pRes.data);
        setTeamAverages(tRes.data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leagueId, seasonId]);

  const activePlayerCat = PLAYER_CATEGORIES.find((c) => c.key === playerMetric)!;
  const activeTeamCat = TEAM_CATEGORIES.find((c) => c.key === teamMetric)!;

  const rankedPlayers = useMemo(() => {
    const threshold = Math.max(minGp, activePlayerCat.minGames ?? 1);
    return averages
      .filter((p) => p.gp >= threshold && p[playerMetric] != null)
      .sort((a, b) => Number(b[playerMetric] ?? 0) - Number(a[playerMetric] ?? 0))
      .slice(0, 20);
  }, [averages, playerMetric, minGp, activePlayerCat.minGames]);

  const rankedTeams = useMemo(() => {
    return teamAverages
      .filter((t) => {
        if (conferenceFilter !== 'ALL' && t.conference !== conferenceFilter) return false;
        return t[teamMetric] != null && t.gp > 0;
      })
      .sort((a, b) => {
        const valA = Number(a[teamMetric] ?? 0);
        const valB = Number(b[teamMetric] ?? 0);
        return activeTeamCat.asc ? valA - valB : valB - valA;
      });
  }, [teamAverages, teamMetric, conferenceFilter, activeTeamCat.asc]);

  const handleClickTeam = (t: TeamSeasonAverage) => {
    if (!onSelectTeam) return;
    onSelectTeam({
      id: t.team_id,
      league_id: t.league_id,
      external_id: null,
      name: t.team_name,
      short_name: t.team_short_name,
      abbreviation: t.team_abbreviation,
      city: null,
      conference: t.conference,
      division: t.division,
      primary_color: t.primary_color,
      alternate_color: t.alternate_color,
      logo_url: t.logo_url,
    });
  };

  return (
    <div className="space-y-4">
      {/* Mode Switcher: Jugadores vs Equipos */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded-xl bg-white/[0.04] border border-white/[0.08] p-1">
          <button
            type="button"
            onClick={() => setMode('players')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              mode === 'players'
                ? 'bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 shadow-[0_4px_14px_rgba(16,185,129,0.28)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            Líderes Jugadores
          </button>
          <button
            type="button"
            onClick={() => setMode('teams')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
              mode === 'teams'
                ? 'bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 shadow-[0_4px_14px_rgba(16,185,129,0.28)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Estadísticas de Equipos
          </button>
        </div>

        {mode === 'players' ? (
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Filter className="w-3.5 h-3.5 text-emerald-400" />
            Mín. PJ:
            <select
              value={minGp}
              onChange={(e) => setMinGp(Number(e.target.value))}
              className="bg-slate-950/90 border border-white/[0.1] rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-400"
            >
              <option value={1}>1+</option>
              <option value={3}>3+</option>
              <option value={5}>5+</option>
              <option value={8}>8+</option>
            </select>
          </label>
        ) : (
          <div className="inline-flex rounded-xl bg-white/[0.04] border border-white/[0.08] p-1 text-xs">
            {(
              [
                { key: 'ALL', label: 'NBA (30)' },
                { key: 'East', label: 'Este' },
                { key: 'West', label: 'Oeste' },
              ] as const
            ).map((cf) => (
              <button
                key={cf.key}
                type="button"
                onClick={() => setConferenceFilter(cf.key)}
                className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                  conferenceFilter === cf.key
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {cf.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Category Pills */}
      {mode === 'players' ? (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {PLAYER_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setPlayerMetric(cat.key)}
              className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
                playerMetric === cat.key
                  ? 'bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 border-emerald-300 shadow-[0_4px_14px_rgba(16,185,129,0.28)]'
                  : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-emerald-400/40'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {TEAM_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setTeamMetric(cat.key)}
              className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
                teamMetric === cat.key
                  ? 'bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 border-emerald-300 shadow-[0_4px_14px_rgba(16,185,129,0.28)]'
                  : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-emerald-400/40'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Section Title */}
      <div className="flex items-center justify-between px-1">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-200">
          <Flame className="w-4 h-4 text-emerald-400" />
          {mode === 'players'
            ? `Top 20 Jugadores — ${activePlayerCat.label}`
            : `Ranking de Equipos — ${activeTeamCat.label}`}
        </div>
        {mode === 'teams' && (
          <span className="text-[11px] text-slate-400">{activeTeamCat.subtitle}</span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-16 rounded-2xl sb-card animate-pulse"
            />
          ))}
        </div>
      ) : mode === 'players' ? (
        rankedPlayers.length === 0 ? (
          <div className="sb-card rounded-2xl p-8 text-center text-sm text-slate-400">
            No hay líderes que cumplan con el mínimo de partidos seleccionado.
          </div>
        ) : (
          <div className="space-y-2">
            {rankedPlayers.map((p, idx) => {
              const rawVal = Number(p[playerMetric] ?? 0);
              const prefix = activePlayerCat.showSign && rawVal > 0 ? '+' : '';
              const displayVal = activePlayerCat.isInt
                ? String(rawVal)
                : `${prefix}${rawVal.toFixed(1)}${activePlayerCat.suffix ?? ''}`;
              const isTop3 = idx < 3;

              return (
                <button
                  key={p.player_id}
                  onClick={() => onSelectPlayer(p.player_id)}
                  className="w-full flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900/75 border border-slate-800/80 hover:border-orange-500/50 transition-all text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black tabular-nums shrink-0 ${
                        idx === 0
                          ? 'bg-amber-400 text-slate-950'
                          : idx === 1
                            ? 'bg-slate-300 text-slate-950'
                            : idx === 2
                              ? 'bg-orange-700 text-white'
                              : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {idx + 1}
                    </div>

                    <div className="w-11 h-11 rounded-full bg-slate-800 overflow-hidden shrink-0">
                      {p.headshot_url ? (
                        <img
                          src={p.headshot_url}
                          alt={p.full_name}
                          className="w-full h-full object-cover"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <div className="font-bold text-sm text-white truncate">{p.full_name}</div>
                      <div className="text-xs text-slate-400 tabular-nums">
                        {p.team_abbreviation ?? 'NBA'} · {p.position ?? 'JUG'} · {p.gp} PJ ·{' '}
                        <span className="text-slate-500">
                          {Number(p.ppg).toFixed(1)} PTS · {Number(p.rpg).toFixed(1)} REB ·{' '}
                          {Number(p.apg).toFixed(1)} AST
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0 tabular-nums">
                    <div
                      className={`text-xl font-black ${
                        isTop3 ? 'text-orange-400' : 'text-white'
                      }`}
                    >
                      {displayVal}
                    </div>
                    <div className="text-[10px] font-semibold uppercase text-slate-500">
                      {activePlayerCat.label}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : rankedTeams.length === 0 ? (
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-8 text-center text-sm text-slate-400">
          No hay estadísticas de equipos disponibles para este filtro.
        </div>
      ) : (
        <div className="space-y-2">
          {rankedTeams.map((t, idx) => {
            const rawVal =
              teamMetric === 'win_pct'
                ? Number(t.win_pct ?? 0) * 100
                : Number(t[teamMetric] ?? 0);
            const decimals = activeTeamCat.decimals ?? 1;
            const prefix = activeTeamCat.showSign && rawVal > 0 ? '+' : '';
            const displayVal = `${prefix}${rawVal.toFixed(decimals)}${activeTeamCat.suffix ?? ''}`;
            const isTop3 = idx < 3;

            return (
              <button
                key={t.team_id}
                type="button"
                onClick={() => handleClickTeam(t)}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900/75 border border-slate-800/80 hover:border-orange-500/50 transition-all text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black tabular-nums shrink-0 ${
                      idx === 0
                        ? 'bg-amber-400 text-slate-950'
                        : idx === 1
                          ? 'bg-slate-300 text-slate-950'
                          : idx === 2
                            ? 'bg-orange-700 text-white'
                            : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {idx + 1}
                  </div>

                  <div className="w-11 h-11 rounded-xl bg-slate-950/70 border border-slate-800 p-1.5 flex items-center justify-center shrink-0">
                    {t.logo_url ? (
                      <img
                        src={t.logo_url}
                        alt={t.team_abbreviation}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-xs font-black text-slate-400">
                        {t.team_abbreviation}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white truncate">{t.team_name}</span>
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 tabular-nums">
                        {t.wins}-{t.losses}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 tabular-nums mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>{Number(t.ppg).toFixed(1)} PPG</span>
                      <span>·</span>
                      <span>{Number(t.oppg).toFixed(1)} OPPG</span>
                      <span>·</span>
                      <span>{Number(t.rpg).toFixed(1)} REB</span>
                      <span>·</span>
                      <span>{Number(t.apg).toFixed(1)} AST</span>
                      {t.fg_pct != null && (
                        <>
                          <span>·</span>
                          <span className="text-slate-300">{Number(t.fg_pct).toFixed(1)}% TC</span>
                        </>
                      )}
                      {t.tp_pct != null && (
                        <>
                          <span>·</span>
                          <span className="text-slate-300">{Number(t.tp_pct).toFixed(1)}% 3P</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 tabular-nums">
                  <div
                    className={`text-xl font-black ${
                      isTop3 ? 'text-orange-400' : 'text-white'
                    }`}
                  >
                    {displayVal}
                  </div>
                  <div className="text-[10px] font-semibold uppercase text-slate-500">
                    {activeTeamCat.label}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
