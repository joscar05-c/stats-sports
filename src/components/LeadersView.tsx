import { useEffect, useMemo, useState } from 'react';
import { Flame, Filter } from 'lucide-react';
import { fetchSeasonAverages } from '../services/basketballApi';
import type { PlayerSeasonAverage } from '../types/database';

interface LeadersViewProps {
  leagueId: number;
  seasonId: number;
  onSelectPlayer: (playerId: number) => void;
}

type StatMetricKey =
  | 'ppg'
  | 'rpg'
  | 'apg'
  | 'spg'
  | 'bpg'
  | 'tp_pct'
  | 'ts_pct'
  | 'efg_pct'
  | 'double_doubles';

const CATEGORIES: Array<{ key: StatMetricKey; label: string; suffix?: string; minGames?: number }> = [
  { key: 'ppg', label: 'Puntos' },
  { key: 'rpg', label: 'Rebotes' },
  { key: 'apg', label: 'Asistencias' },
  { key: 'spg', label: 'Robos' },
  { key: 'bpg', label: 'Tapones' },
  { key: 'ts_pct', label: 'TS%', suffix: '%', minGames: 4 },
  { key: 'efg_pct', label: 'eFG%', suffix: '%', minGames: 4 },
  { key: 'tp_pct', label: '3P%', suffix: '%', minGames: 4 },
  { key: 'double_doubles', label: 'Doble-Dobles' },
];

export function LeadersView({ leagueId, seasonId, onSelectPlayer }: LeadersViewProps) {
  const [averages, setAverages] = useState<PlayerSeasonAverage[]>([]);
  const [metric, setMetric] = useState<StatMetricKey>('ppg');
  const [minGp, setMinGp] = useState<number>(3);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchSeasonAverages(leagueId, seasonId)
      .then((res) => {
        if (active) setAverages(res.data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leagueId, seasonId]);

  const activeCategory = CATEGORIES.find((c) => c.key === metric)!;

  const ranked = useMemo(() => {
    const threshold = Math.max(minGp, activeCategory.minGames ?? 1);
    return averages
      .filter((p) => p.gp >= threshold && p[metric] != null)
      .sort((a, b) => Number(b[metric] ?? 0) - Number(a[metric] ?? 0))
      .slice(0, 20);
  }, [averages, metric, minGp, activeCategory.minGames]);

  return (
    <div className="space-y-4">
      {/* Category Pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setMetric(cat.key)}
            className={`shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
              metric === cat.key
                ? 'bg-orange-500 text-slate-950 border-orange-400 shadow-lg shadow-orange-500/20'
                : 'bg-slate-900/70 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Min GP Filter */}
      <div className="flex items-center justify-between px-1">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-300">
          <Flame className="w-4 h-4 text-orange-400" />
          Top 20 — {activeCategory.label}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          <Filter className="w-3.5 h-3.5" />
          Mín. PJ:
          <select
            value={minGp}
            onChange={(e) => setMinGp(Number(e.target.value))}
            className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
          >
            <option value={1}>1+</option>
            <option value={3}>3+</option>
            <option value={5}>5+</option>
            <option value={8}>8+</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-16 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse"
            />
          ))}
        </div>
      ) : ranked.length === 0 ? (
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-8 text-center text-sm text-slate-400">
          No hay líderes que cumplan con el mínimo de partidos seleccionado.
        </div>
      ) : (
        <div className="space-y-2">
          {ranked.map((p, idx) => {
            const rawVal = Number(p[metric] ?? 0);
            const displayVal =
              metric === 'double_doubles'
                ? String(rawVal)
                : `${rawVal.toFixed(1)}${activeCategory.suffix ?? ''}`;
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
                        {Number(p.ppg).toFixed(1)}/{Number(p.rpg).toFixed(1)}/{Number(p.apg).toFixed(1)}
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
                    {activeCategory.label}
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
