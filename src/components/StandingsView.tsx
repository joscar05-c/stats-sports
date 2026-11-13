import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { fetchStandings } from '../services/basketballApi';
import type { Team, TeamStanding } from '../types/database';

interface StandingsViewProps {
  seasonId: number;
  onSelectTeam: (team: Team, standing?: TeamStanding) => void;
}

export function StandingsView({ seasonId, onSelectTeam }: StandingsViewProps) {
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [conference, setConference] = useState<'East' | 'West'>('East');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchStandings(seasonId)
      .then((res) => {
        if (active) setStandings(res.data);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [seasonId]);

  const rows = standings
    .filter((s) => !s.conference || s.conference === conference)
    .sort((a, b) => (a.playoff_seed ?? 99) - (b.playoff_seed ?? 99));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
          <Trophy className="w-4 h-4 text-orange-400" />
          Tabla de Posiciones
        </div>

        <div className="inline-flex rounded-xl bg-slate-900 border border-slate-800 p-1">
          {(
            [
              { key: 'East', label: 'Este' },
              { key: 'West', label: 'Oeste' },
            ] as const
          ).map((c) => (
            <button
              key={c.key}
              onClick={() => setConference(c.key)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                conference === c.key
                  ? 'bg-orange-500 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-80 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-8 text-center text-sm text-slate-400">
          Sin tabla de posiciones disponible para esta liga/temporada.
        </div>
      ) : (
        <div className="rounded-2xl bg-slate-900/75 border border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums whitespace-nowrap">
              <thead className="bg-slate-900 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="text-left py-2.5 px-3 sticky left-0 bg-slate-900"># EQUIPO</th>
                  <th className="text-right py-2.5 px-2.5">G</th>
                  <th className="text-right py-2.5 px-2.5">P</th>
                  <th className="text-right py-2.5 px-2.5">PCT</th>
                  <th className="text-right py-2.5 px-2.5">JD</th>
                  <th className="text-right py-2.5 px-2.5">ÚLT 10</th>
                  <th className="text-right py-2.5 px-2.5">RACHA</th>
                  <th className="text-right py-2.5 px-3">DIFF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rows.map((s, index) => {
                  const seed = s.playoff_seed ?? index + 1;
                  const seedZone =
                    seed <= 6
                      ? 'bg-emerald-500'
                      : seed <= 10
                        ? 'bg-amber-400'
                        : 'bg-slate-700';

                  return (
                    <tr
                      key={s.id}
                      onClick={() => onSelectTeam(s.team, s)}
                      className="cursor-pointer hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-3 sticky left-0 bg-[#0d1421]">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-1 h-5 rounded-full ${seedZone}`} />
                          <span className="w-4 text-slate-500 font-bold">{seed}</span>
                          {s.team.logo_url && (
                            <img
                              src={s.team.logo_url}
                              alt={s.team.abbreviation}
                              className="w-5 h-5 object-contain"
                            />
                          )}
                          <span className="font-bold text-slate-100">{s.team.short_name}</span>
                          <span className="text-[11px] text-slate-500 hidden sm:inline">
                            {s.team.abbreviation}
                          </span>
                        </div>
                      </td>
                      <td className="text-right py-2.5 px-2.5 font-bold text-white">{s.wins}</td>
                      <td className="text-right py-2.5 px-2.5 text-slate-300">{s.losses}</td>
                      <td className="text-right py-2.5 px-2.5 text-slate-300">
                        {Number(s.win_pct).toFixed(3).replace(/^0/, '')}
                      </td>
                      <td className="text-right py-2.5 px-2.5 text-slate-400">
                        {s.games_behind ?? '-'}
                      </td>
                      <td className="text-right py-2.5 px-2.5 text-slate-300">
                        {s.last_ten ?? '-'}
                      </td>
                      <td className="text-right py-2.5 px-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                            s.streak?.startsWith('W')
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-rose-500/15 text-rose-400'
                          }`}
                        >
                          {s.streak ?? '-'}
                        </span>
                      </td>
                      <td
                        className={`text-right py-2.5 px-3 font-semibold ${
                          (s.diff ?? 0) > 0
                            ? 'text-emerald-400'
                            : (s.diff ?? 0) < 0
                              ? 'text-rose-400'
                              : 'text-slate-400'
                        }`}
                      >
                        {s.diff != null ? (s.diff > 0 ? `+${s.diff}` : s.diff) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2.5 bg-slate-950/60 border-t border-slate-800/80 flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              1-6 Playoffs Directos
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              7-10 Torneo Play-In
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
