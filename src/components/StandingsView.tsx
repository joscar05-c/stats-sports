import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { fetchStandings } from '../services/basketballApi';
import type { Team, TeamStanding } from '../types/database';

interface StandingsViewProps {
  seasonId: number;
  sport?: 'basketball' | 'football';
  onSelectTeam: (team: Team, standing?: TeamStanding) => void;
}

export function StandingsView({
  seasonId,
  sport = 'basketball',
  onSelectTeam,
}: StandingsViewProps) {
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
    .filter((s) => (sport === 'football' ? true : !s.conference || s.conference === conference))
    .sort((a, b) => (a.playoff_seed ?? 99) - (b.playoff_seed ?? 99));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="standings-heading"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider"
        >
          <Trophy className="w-4 h-4 text-slate-400" aria-hidden="true" />
          Tabla de Posiciones
        </h2>

        {sport !== 'football' && (
          <div className="inline-flex rounded-lg bg-[#12151c] border border-white/[0.08] p-1">
            {(
              [
                { key: 'East', label: 'Este' },
                { key: 'West', label: 'Oeste' },
              ] as const
            ).map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={conference === c.key}
                onClick={() => setConference(c.key)}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  conference === c.key
                    ? 'cv-tab-active'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-80 rounded-xl sb-card animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="sb-card rounded-xl p-8 text-center text-sm text-slate-400">
          Sin tabla de posiciones disponible para esta liga/temporada.
        </div>
      ) : (
        <div className="sb-card rounded-xl overflow-hidden">
          <div
            tabIndex={0}
            role="region"
            aria-labelledby="standings-heading"
            className="overflow-x-auto sb-scroller"
          >
            <table className="w-full text-xs tabular-nums whitespace-nowrap border-separate border-spacing-0">
              <caption className="visually-hidden">
                {sport === 'football'
                  ? 'Tabla general de posiciones'
                  : `Tabla de posiciones Conferencia ${conference === 'East' ? 'Este' : 'Oeste'}`}
              </caption>
              <thead className="bg-[#0e1117] text-slate-400 border-b border-white/[0.08]">
                {sport === 'football' ? (
                  <tr>
                    <th scope="col" className="text-left py-2.5 px-3 sticky left-0 bg-[#0e1117] z-10">
                      # CLUB
                    </th>
                    <th scope="col" className="text-right py-2.5 px-2.5">PJ</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">G</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">E</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">P</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">GF</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">GC</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">DG</th>
                    <th scope="col" className="text-right py-2.5 px-3">PTS</th>
                  </tr>
                ) : (
                  <tr>
                    <th scope="col" className="text-left py-2.5 px-3 sticky left-0 bg-[#0e1117] z-10">
                      # EQUIPO
                    </th>
                    <th scope="col" className="text-right py-2.5 px-2.5">G</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">P</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">PCT</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">JD</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">LOCAL</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">VISITA</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">PPG</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">OPPG</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">DIFF</th>
                    <th scope="col" className="text-right py-2.5 px-2.5">ÚLT 10</th>
                    <th scope="col" className="text-right py-2.5 px-3">RACHA</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {rows.map((s, index) => {
                  const seed = s.playoff_seed ?? index + 1;
                  const seedZone =
                    sport === 'football'
                      ? seed <= 4
                        ? 'bg-emerald-400/75'
                        : seed === 5
                          ? 'bg-blue-400/75'
                          : seed >= 18
                            ? 'bg-rose-400/75'
                            : 'bg-slate-700'
                      : seed <= 6
                        ? 'bg-emerald-400/75'
                        : seed <= 10
                          ? 'bg-blue-400/75'
                          : 'bg-slate-700';

                  return (
                    <tr
                      key={s.id}
                      onClick={() => onSelectTeam(s.team, s)}
                      className="cursor-pointer hover:bg-white/[0.04] transition-colors"
                    >
                      <th scope="row" className="text-left font-normal py-2.5 px-3 sticky left-0 bg-[#12151c]">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-1 h-5 rounded-full ${seedZone}`} />
                          <span className="w-4 text-slate-400 font-semibold">{seed}</span>
                          {s.team.logo_url && (
                            <img
                              src={s.team.logo_url}
                              alt={s.team.abbreviation}
                              className="w-5 h-5 object-contain"
                            />
                          )}
                          <span className="font-semibold text-slate-100">{s.team.short_name}</span>
                          <span className="text-[11px] text-slate-400 hidden sm:inline">
                            {s.team.abbreviation}
                          </span>
                        </div>
                      </th>
                      {sport === 'football' ? (
                        <>
                          <td className="text-right py-2.5 px-2.5 text-slate-300">{s.played ?? 0}</td>
                          <td className="text-right py-2.5 px-2.5 text-slate-200 font-semibold">{s.wins}</td>
                          <td className="text-right py-2.5 px-2.5 text-slate-300">{s.draws ?? 0}</td>
                          <td className="text-right py-2.5 px-2.5 text-slate-400">{s.losses}</td>
                          <td className="text-right py-2.5 px-2.5 text-slate-300">{s.goals_for ?? 0}</td>
                          <td className="text-right py-2.5 px-2.5 text-slate-300">{s.goals_against ?? 0}</td>
                          <td
                            className={`text-right py-2.5 px-2.5 font-semibold ${
                              (s.goal_diff ?? 0) > 0
                                ? 'text-emerald-300'
                                : (s.goal_diff ?? 0) < 0
                                  ? 'text-rose-300'
                                  : 'text-slate-400'
                            }`}
                          >
                            {s.goal_diff != null
                              ? s.goal_diff > 0
                                ? `+${s.goal_diff}`
                                : s.goal_diff
                              : '-'}
                          </td>
                          <td className="text-right py-2.5 px-3 font-bold text-white">
                            {s.points ?? 0}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="text-right py-2.5 px-2.5 font-bold text-white">{s.wins}</td>
                          <td className="text-right py-2.5 px-2.5 text-slate-300">{s.losses}</td>
                          <td className="text-right py-2.5 px-2.5 text-slate-300">
                            {Number(s.win_pct).toFixed(3).replace(/^0/, '')}
                          </td>
                          <td className="text-right py-2.5 px-2.5 text-slate-400">
                            {s.games_behind ?? '-'}
                          </td>
                          <td className="text-right py-2.5 px-2.5 text-slate-300">
                            {s.home_record ?? '-'}
                          </td>
                          <td className="text-right py-2.5 px-2.5 text-slate-300">
                            {s.away_record ?? '-'}
                          </td>
                          <td className="text-right py-2.5 px-2.5 font-semibold text-slate-200">
                            {s.ppg != null ? Number(s.ppg).toFixed(1) : '-'}
                          </td>
                          <td className="text-right py-2.5 px-2.5 text-slate-300">
                            {s.oppg != null ? Number(s.oppg).toFixed(1) : '-'}
                          </td>
                          <td
                            className={`text-right py-2.5 px-2.5 font-semibold ${
                              (s.diff ?? 0) > 0
                                ? 'text-emerald-300'
                                : (s.diff ?? 0) < 0
                                  ? 'text-rose-300'
                                  : 'text-slate-400'
                            }`}
                          >
                            {s.diff != null ? (s.diff > 0 ? `+${s.diff}` : s.diff) : '-'}
                          </td>
                          <td className="text-right py-2.5 px-2.5 text-slate-300">
                            {s.last_ten ?? '-'}
                          </td>
                          <td className="text-right py-2.5 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                                s.streak?.startsWith('W')
                                  ? 'bg-emerald-500/12 text-emerald-300'
                                  : 'bg-rose-500/12 text-rose-300'
                              }`}
                            >
                              {s.streak ?? '-'}
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2.5 bg-[#0e1117] border-t border-white/[0.06] flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
            {sport === 'football' ? (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400/75" />
                  1-4 UEFA Champions League
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-400/75" />
                  5 UEFA Europa League
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-400/75" />
                  18-20 Descenso
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400/75" />
                  1-6 Playoffs directos
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-400/75" />
                  7-10 Torneo Play-In
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
