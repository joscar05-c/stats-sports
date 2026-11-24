import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { FootballTeamMatchStats, Game } from '../types/database';
import { evaluateGameBettingResult, summarizeTeamRecent } from '../utils/betting';
import { extractHalfTimeGoals, hasFootballBoxTracking } from '../utils/footballProps';

export interface PastFootballGamesSummary {
  count: number;
  wins: number;
  draws: number;
  losses: number;
  form: Array<'G' | 'E' | 'P'>;
  avgGf: number;
  avgGa: number;
  avgTotalGoals: number;
  bttsPct: number;
  over25Pct: number;
  trackedCount: number;
  avgPossession: number | null;
  avgCornersFor: number | null;
  avgCornersAgainst: number | null;
  avgCornersTotal: number | null;
  avgFoulsFor: number | null;
  avgFoulsAgainst: number | null;
  avgFoulsTotal: number | null;
  avgYellowFor: number | null;
  avgYellowTotal: number | null;
  avgShotsFor: number | null;
  avgShotsTotal: number | null;
  avgSotFor: number | null;
  avgSotTotal: number | null;
  avgOffsidesTotal: number | null;
  avgSavesTotal: number | null;
}

export interface PastGamesHistoryPanelProps {
  games: Game[];
  focusTeamId?: number;
  focusTeamName?: string;
  sport?: 'basketball' | 'football';
  emptyMessage?: string;
  onSelectGame?: (game: Game) => void;
}

type VenueFilter = 'all' | 'home' | 'away';
type FootballStatView = 'split' | 'total';

function getSideStats(
  game: Game,
  teamId?: number,
): { my: FootballTeamMatchStats | undefined; opp: FootballTeamMatchStats | undefined } {
  const hs = game.sport_stats?.home;
  const as_ = game.sport_stats?.away;
  if (teamId != null && game.away_team_id === teamId) {
    return { my: as_, opp: hs };
  }
  return { my: hs, opp: as_ };
}

function avgOrNull(sum: number, n: number): number | null {
  return n > 0 ? sum / n : null;
}

export function summarizePastFootballGames(
  games: Game[],
  focusTeamId?: number,
): PastFootballGamesSummary {
  const finals = games
    .filter((g) => g.status === 'final')
    .sort((a, b) => b.game_date.localeCompare(a.game_date) || b.id - a.id);

  const count = finals.length;
  if (count === 0) {
    return {
      count: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      form: [],
      avgGf: 0,
      avgGa: 0,
      avgTotalGoals: 0,
      bttsPct: 0,
      over25Pct: 0,
      trackedCount: 0,
      avgPossession: null,
      avgCornersFor: null,
      avgCornersAgainst: null,
      avgCornersTotal: null,
      avgFoulsFor: null,
      avgFoulsAgainst: null,
      avgFoulsTotal: null,
      avgYellowFor: null,
      avgYellowTotal: null,
      avgShotsFor: null,
      avgShotsTotal: null,
      avgSotFor: null,
      avgSotTotal: null,
      avgOffsidesTotal: null,
      avgSavesTotal: null,
    };
  }

  let wins = 0;
  let draws = 0;
  let losses = 0;
  const form: Array<'G' | 'E' | 'P'> = [];
  let gfSum = 0;
  let gaSum = 0;
  let totalGoalsSum = 0;
  let bttsHits = 0;
  let over25Hits = 0;

  let trackedCount = 0;
  let posSum = 0;
  let posCount = 0;
  let cornersForSum = 0;
  let cornersAgainstSum = 0;
  let cornersTotalSum = 0;
  let foulsForSum = 0;
  let foulsAgainstSum = 0;
  let foulsTotalSum = 0;
  let shotsForSum = 0;
  let shotsTotalSum = 0;
  let sotForSum = 0;
  let sotTotalSum = 0;
  let offsidesTotalSum = 0;
  let offsidesCount = 0;
  let savesTotalSum = 0;
  let savesCount = 0;

  let cardCount = 0;
  let yellowForSum = 0;
  let yellowTotalSum = 0;

  for (const g of finals) {
    const isHome = focusTeamId != null ? g.home_team_id === focusTeamId : true;
    const gf = isHome ? g.home_score : g.away_score;
    const ga = isHome ? g.away_score : g.home_score;
    const tot = g.home_score + g.away_score;

    gfSum += gf;
    gaSum += ga;
    totalGoalsSum += tot;
    if (g.home_score > 0 && g.away_score > 0) bttsHits += 1;
    if (tot >= 3) over25Hits += 1;

    if (focusTeamId != null) {
      if (gf > ga) {
        wins += 1;
        if (form.length < 5) form.push('G');
      } else if (gf === ga) {
        draws += 1;
        if (form.length < 5) form.push('E');
      } else {
        losses += 1;
        if (form.length < 5) form.push('P');
      }
    }

    const { my, opp } = getSideStats(g, focusTeamId);
    if (my && opp && (my.yellow_cards != null || opp.yellow_cards != null)) {
      cardCount += 1;
      const myY = Number(my.yellow_cards ?? 0);
      const opY = Number(opp.yellow_cards ?? 0);
      yellowForSum += myY;
      yellowTotalSum += myY + opY;
    }

    if (hasFootballBoxTracking(g) && my && opp) {
      trackedCount += 1;
      if (focusTeamId != null && my.possession_pct != null) {
        posSum += Number(my.possession_pct);
        posCount += 1;
      }
      const cF = Number(my.corners ?? 0);
      const cA = Number(opp.corners ?? 0);
      cornersForSum += cF;
      cornersAgainstSum += cA;
      cornersTotalSum += cF + cA;

      const fF = Number(my.fouls ?? 0);
      const fA = Number(opp.fouls ?? 0);
      foulsForSum += fF;
      foulsAgainstSum += fA;
      foulsTotalSum += fF + fA;

      const sF = Number(my.shots ?? 0);
      const sA = Number(opp.shots ?? 0);
      shotsForSum += sF;
      shotsTotalSum += sF + sA;

      const sotF = Number(my.shots_on_target ?? 0);
      const sotA = Number(opp.shots_on_target ?? 0);
      sotForSum += sotF;
      sotTotalSum += sotF + sotA;

      if (my.offsides != null || opp.offsides != null) {
        offsidesCount += 1;
        offsidesTotalSum += Number(my.offsides ?? 0) + Number(opp.offsides ?? 0);
      }
      if (my.saves != null || opp.saves != null) {
        savesCount += 1;
        savesTotalSum += Number(my.saves ?? 0) + Number(opp.saves ?? 0);
      }
    }
  }

  const isTeamScoped = focusTeamId != null;
  return {
    count,
    wins,
    draws,
    losses,
    form,
    avgGf: gfSum / count,
    avgGa: gaSum / count,
    avgTotalGoals: totalGoalsSum / count,
    bttsPct: Math.round((bttsHits / count) * 100),
    over25Pct: Math.round((over25Hits / count) * 100),
    trackedCount,
    avgPossession: isTeamScoped ? avgOrNull(posSum, posCount) : null,
    avgCornersFor: isTeamScoped ? avgOrNull(cornersForSum, trackedCount) : null,
    avgCornersAgainst: isTeamScoped ? avgOrNull(cornersAgainstSum, trackedCount) : null,
    avgCornersTotal: avgOrNull(cornersTotalSum, trackedCount),
    avgFoulsFor: isTeamScoped ? avgOrNull(foulsForSum, trackedCount) : null,
    avgFoulsAgainst: isTeamScoped ? avgOrNull(foulsAgainstSum, trackedCount) : null,
    avgFoulsTotal: avgOrNull(foulsTotalSum, trackedCount),
    avgYellowFor: isTeamScoped ? avgOrNull(yellowForSum, cardCount) : null,
    avgYellowTotal: avgOrNull(yellowTotalSum, cardCount),
    avgShotsFor: isTeamScoped ? avgOrNull(shotsForSum, trackedCount) : null,
    avgShotsTotal: avgOrNull(shotsTotalSum, trackedCount),
    avgSotFor: isTeamScoped ? avgOrNull(sotForSum, trackedCount) : null,
    avgSotTotal: avgOrNull(sotTotalSum, trackedCount),
    avgOffsidesTotal: avgOrNull(offsidesTotalSum, offsidesCount),
    avgSavesTotal: avgOrNull(savesTotalSum, savesCount),
  };
}

function formatPassPct(side?: FootballTeamMatchStats): string {
  if (!side) return '—';
  if (side.pass_pct != null) {
    const raw = Number(side.pass_pct);
    const val = raw <= 1 && raw > 0 ? raw * 100 : raw;
    return `${Math.round(val)}%`;
  }
  if (side.total_passes != null && side.total_passes > 0 && side.accurate_passes != null) {
    return `${Math.round((Number(side.accurate_passes) / Number(side.total_passes)) * 100)}%`;
  }
  return '—';
}

function FormBadge({ res }: { res: 'G' | 'E' | 'P' }) {
  const cls =
    res === 'G'
      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
      : res === 'P'
        ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
        : 'bg-white/[0.06] text-slate-300 border-white/[0.12]';
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold border ${cls}`}>
      {res}
    </span>
  );
}

export function PastGamesHistoryPanel({
  games,
  focusTeamId,
  focusTeamName,
  sport = 'football',
  emptyMessage = 'Aún no hay partidos finalizados registrados.',
  onSelectGame,
}: PastGamesHistoryPanelProps) {
  const [venueFilter, setVenueFilter] = useState<VenueFilter>('all');
  const [statView, setStatView] = useState<FootballStatView>(focusTeamId != null ? 'split' : 'total');

  const finalGames = useMemo(
    () =>
      games
        .filter((g) => g.status === 'final')
        .sort((a, b) => b.game_date.localeCompare(a.game_date) || b.id - a.id),
    [games],
  );

  const filteredGames = useMemo(() => {
    if (focusTeamId == null || venueFilter === 'all') return finalGames;
    return finalGames.filter((g) =>
      venueFilter === 'home' ? g.home_team_id === focusTeamId : g.away_team_id === focusTeamId,
    );
  }, [finalGames, focusTeamId, venueFilter]);

  const effectiveView: FootballStatView = focusTeamId != null ? statView : 'total';
  const fbSummary = useMemo(
    () => (sport === 'football' ? summarizePastFootballGames(filteredGames, focusTeamId) : null),
    [filteredGames, focusTeamId, sport],
  );
  const bballSummary = useMemo(
    () => (sport !== 'football' && focusTeamId != null ? summarizeTeamRecent(focusTeamId, filteredGames) : null),
    [filteredGames, focusTeamId, sport],
  );

  const bballForm = useMemo(() => {
    if (sport === 'football' || focusTeamId == null) return [];
    return filteredGames.slice(0, 5).map((g): 'G' | 'P' => {
      const isH = g.home_team_id === focusTeamId;
      const my = isH ? g.home_score : g.away_score;
      const op = isH ? g.away_score : g.home_score;
      return my > op ? 'G' : 'P';
    });
  }, [filteredGames, focusTeamId, sport]);

  const venueCounts = useMemo(() => {
    if (focusTeamId == null) return { all: finalGames.length, home: 0, away: 0 };
    return {
      all: finalGames.length,
      home: finalGames.filter((g) => g.home_team_id === focusTeamId).length,
      away: finalGames.filter((g) => g.away_team_id === focusTeamId).length,
    };
  }, [finalGames, focusTeamId]);

  const basketPeriodCount = useMemo(() => {
    let maxP = 4;
    for (const g of filteredGames) {
      maxP = Math.max(maxP, g.home_linescores?.length ?? 0, g.away_linescores?.length ?? 0);
    }
    return Math.min(maxP, 6);
  }, [filteredGames]);

  if (finalGames.length === 0) {
    return (
      <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-6 text-center text-xs text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {focusTeamId != null ? (
          <div
            role="region"
            aria-label="Filtrar partidos jugados por localía"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
          >
            {(
              [
                { key: 'all', label: `Todos (${venueCounts.all})` },
                { key: 'home', label: `Local (${venueCounts.home})` },
                { key: 'away', label: `Visita (${venueCounts.away})` },
              ] as const
            ).map((opt) => {
              const active = venueFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={active}
                  onClick={(e) => {
                    setVenueFilter(opt.key);
                    e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                  }}
                  className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors whitespace-nowrap tabular-nums ${
                    active
                      ? 'cv-tab-active'
                      : 'bg-[#0b0d11] text-slate-300 border-white/[0.08] hover:border-white/[0.18] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-[11px] font-semibold text-slate-300 tabular-nums">
            Últimos {filteredGames.length} enfrentamientos directos
          </div>
        )}

        {sport === 'football' && focusTeamId != null && (
          <div className="inline-flex rounded-lg bg-[#0b0d11] border border-white/[0.08] p-0.5 text-[11px]">
            {(
              [
                { key: 'split', label: 'Equipo (F-C)' },
                { key: 'total', label: 'Totales partido' },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={statView === m.key}
                onClick={() => setStatView(m.key)}
                className={`px-2 py-1 rounded-md font-semibold transition-colors whitespace-nowrap ${
                  statView === m.key ? 'cv-tab-active' : 'text-slate-400 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {filteredGames.length === 0 ? (
        <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-6 text-center text-xs text-slate-400">
          Sin partidos finalizados registrados en esta condición de localía.
        </div>
      ) : sport === 'football' && fbSummary ? (
        <>
          {/* Football Historical KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2 tabular-nums">
            {focusTeamId != null && (
              <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-2.5 col-span-2 sm:col-span-1">
                <div className="text-[10px] font-semibold uppercase text-slate-400">
                  Balance ({fbSummary.count} PJ)
                </div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {fbSummary.wins}-{fbSummary.draws}-{fbSummary.losses}
                </div>
                {fbSummary.form.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    {fbSummary.form.map((r, i) => (
                      <FormBadge key={`${r}_${i}`} res={r} />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-2.5">
              <div className="text-[10px] font-semibold uppercase text-slate-400">
                {focusTeamId != null ? 'Goles F-C / Tot.' : 'Goles / PJ'}
              </div>
              <div className="text-sm font-bold text-white mt-0.5">
                {focusTeamId != null
                  ? `${fbSummary.avgGf.toFixed(1)} - ${fbSummary.avgGa.toFixed(1)}`
                  : fbSummary.avgTotalGoals.toFixed(2)}
              </div>
              <div className="text-[10px] text-slate-400">
                {focusTeamId != null
                  ? `Total ${fbSummary.avgTotalGoals.toFixed(1)}/PJ`
                  : `${fbSummary.count} partidos`}
              </div>
            </div>

            <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-2.5">
              <div className="text-[10px] font-semibold uppercase text-slate-400">BTTS / +2.5</div>
              <div className="text-sm font-bold text-white mt-0.5">
                {fbSummary.bttsPct}% / {fbSummary.over25Pct}%
              </div>
              <div className="text-[10px] text-slate-400">Tendencia goles</div>
            </div>

            {fbSummary.avgCornersTotal != null && (
              <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-400">Córners / PJ</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {focusTeamId != null && fbSummary.avgCornersFor != null && fbSummary.avgCornersAgainst != null
                    ? effectiveView === 'split'
                      ? `${fbSummary.avgCornersFor.toFixed(1)} - ${fbSummary.avgCornersAgainst.toFixed(1)}`
                      : fbSummary.avgCornersTotal.toFixed(1)
                    : fbSummary.avgCornersTotal.toFixed(1)}
                </div>
                <div className="text-[10px] text-slate-400">
                  {effectiveView === 'split' && fbSummary.avgCornersTotal != null
                    ? `Tot. ${fbSummary.avgCornersTotal.toFixed(1)}/PJ`
                    : fbSummary.avgPossession != null
                      ? `Pos. ${fbSummary.avgPossession.toFixed(0)}%`
                      : `en ${fbSummary.trackedCount} PJ`}
                </div>
              </div>
            )}

            {(fbSummary.avgFoulsTotal != null || fbSummary.avgYellowTotal != null) && (
              <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-400">Faltas / TA</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {fbSummary.avgFoulsTotal != null
                    ? effectiveView === 'split' && fbSummary.avgFoulsFor != null
                      ? fbSummary.avgFoulsFor.toFixed(1)
                      : fbSummary.avgFoulsTotal.toFixed(1)
                    : '—'}{' '}
                  <span className="text-amber-300 font-semibold text-xs">
                    ·{' '}
                    {fbSummary.avgYellowTotal != null
                      ? (effectiveView === 'split' && fbSummary.avgYellowFor != null
                          ? fbSummary.avgYellowFor
                          : fbSummary.avgYellowTotal
                        ).toFixed(1)
                      : '—'}{' '}
                    TA
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">
                  {fbSummary.avgShotsTotal != null
                    ? `${fbSummary.avgShotsTotal.toFixed(1)} REM (${fbSummary.avgSotTotal?.toFixed(1) ?? '-'} arco)`
                    : 'Tarjetas/PJ'}
                </div>
              </div>
            )}
          </div>

          {/* Sticky Scrollable Table */}
          <div
            tabIndex={0}
            role="region"
            aria-label={`Historial de partidos jugados${focusTeamName ? ` de ${focusTeamName}` : ''}`}
            className="overflow-auto sb-scroller rounded-xl border border-white/[0.08] max-h-[460px]"
          >
            <table className="w-full text-xs tabular-nums whitespace-nowrap cv-sticky-table">
              <caption className="visually-hidden">
                Partidos pasados con resultado y estadísticas detalladas de juego
              </caption>
              <thead className="text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th scope="col" className="text-left py-2.5 px-3 font-semibold">
                    PARTIDO
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    RES
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    POS%
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    REM (ARCO)
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    CÓR
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    FAL
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    TA/TR
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    OFF
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    ATAJ
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    PASES%
                  </th>
                  <th scope="col" className="text-right py-2.5 px-3 font-semibold">
                    MERC
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {filteredGames.map((g) => {
                  const isHome = focusTeamId != null ? g.home_team_id === focusTeamId : true;
                  const opp = isHome ? g.away_team : g.home_team;
                  const myScore = isHome ? g.home_score : g.away_score;
                  const oppScore = isHome ? g.away_score : g.home_score;
                  const won = focusTeamId != null && myScore > oppScore;
                  const drew = focusTeamId != null && myScore === oppScore;

                  const tracked = hasFootballBoxTracking(g);
                  const { my, opp: op } = getSideStats(g, focusTeamId);
                  const hasCards = my?.yellow_cards != null || op?.yellow_cards != null;

                  const hasLinescores =
                    Array.isArray(g.away_linescores) &&
                    g.away_linescores.length >= 2 &&
                    Array.isArray(g.home_linescores) &&
                    g.home_linescores.length >= 2;
                  const htInfo = extractHalfTimeGoals(g);
                  const htLabel = hasLinescores
                    ? `1T ${isHome ? g.home_linescores![0] : g.away_linescores![0]}-${isHome ? g.away_linescores![0] : g.home_linescores![0]}`
                    : htInfo
                      ? `1T ${htInfo.total}G`
                      : null;

                  const myCorners = my?.corners ?? 0;
                  const opCorners = op?.corners ?? 0;
                  const myFouls = my?.fouls ?? 0;
                  const opFouls = op?.fouls ?? 0;
                  const myShots = my?.shots ?? 0;
                  const opShots = op?.shots ?? 0;
                  const mySot = my?.shots_on_target ?? 0;
                  const opSot = op?.shots_on_target ?? 0;
                  const myOff = my?.offsides ?? 0;
                  const opOff = op?.offsides ?? 0;
                  const mySav = my?.saves ?? 0;
                  const opSav = op?.saves ?? 0;
                  const myYc = my?.yellow_cards ?? 0;
                  const opYc = op?.yellow_cards ?? 0;
                  const totalRc = Number(my?.red_cards ?? 0) + Number(op?.red_cards ?? 0);

                  const totalGoals = g.home_score + g.away_score;
                  const btts = g.home_score > 0 && g.away_score > 0;
                  const o25 = totalGoals >= 3;

                  const matchCellContent = (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 w-10 shrink-0">
                        {g.game_date.slice(5)}
                      </span>
                      {focusTeamId != null ? (
                        <>
                          <span
                            className={`text-[10px] font-bold px-1 py-0.5 rounded border shrink-0 ${
                              isHome
                                ? 'bg-blue-500/10 text-blue-300 border-blue-500/25'
                                : 'bg-white/[0.04] text-slate-400 border-white/[0.08]'
                            }`}
                          >
                            {isHome ? 'LOC' : 'VIS'}
                          </span>
                          {opp.logo_url && (
                            <img src={opp.logo_url} alt="" aria-hidden="true" className="w-5 h-5 object-contain shrink-0" />
                          )}
                          <span className="font-semibold text-white">{opp.short_name}</span>
                        </>
                      ) : (
                        <span className="font-semibold text-white">
                          {g.away_team.abbreviation} @ {g.home_team.abbreviation}
                        </span>
                      )}
                      {onSelectGame && (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                      )}
                    </div>
                  );

                  return (
                    <tr key={g.id} className="hover:bg-white/[0.03] transition-colors">
                      <th scope="row" className="text-left py-2 px-3 font-normal">
                        {onSelectGame ? (
                          <button
                            type="button"
                            onClick={() => onSelectGame(g)}
                            className="text-left hover:text-blue-300 transition-colors focus-visible:underline"
                          >
                            {matchCellContent}
                          </button>
                        ) : (
                          matchCellContent
                        )}
                      </th>
                      <td className="text-center py-2 px-2">
                        <div className="inline-flex items-center gap-1.5">
                          {focusTeamId != null && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                won
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : drew
                                    ? 'bg-white/[0.08] text-slate-300'
                                    : 'bg-rose-500/15 text-rose-300'
                              }`}
                            >
                              {won ? 'G' : drew ? 'E' : 'P'}
                            </span>
                          )}
                          <span className="font-bold text-white">
                            {focusTeamId != null
                              ? `${myScore}-${oppScore}`
                              : `${g.away_score}-${g.home_score}`}
                          </span>
                        </div>
                        {htLabel && (
                          <div className="text-[10px] text-slate-400">{htLabel}</div>
                        )}
                      </td>
                      <td className="text-center py-2 px-2 text-slate-200">
                        {my?.possession_pct != null && op?.possession_pct != null
                          ? focusTeamId != null
                            ? effectiveView === 'split'
                              ? `${Math.round(Number(my.possession_pct))}%`
                              : `${Math.round(Number(my.possession_pct))}-${Math.round(Number(op.possession_pct))}%`
                            : `${Math.round(Number(op.possession_pct))}-${Math.round(Number(my.possession_pct))}%`
                          : '—'}
                      </td>
                      <td className="text-center py-2 px-2 text-slate-200">
                        {tracked ? (
                          effectiveView === 'split' ? (
                            <>
                              <span className="font-semibold text-white">{myShots}</span>
                              <span className="text-slate-400">-{opShots}</span>{' '}
                              <span className="text-[10px] text-slate-400">({mySot}-{opSot})</span>
                            </>
                          ) : (
                            <>
                              <span className="font-semibold text-white">{myShots + opShots}</span>{' '}
                              <span className="text-[10px] text-slate-400">({mySot + opSot})</span>
                            </>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-center py-2 px-2">
                        {tracked ? (
                          effectiveView === 'split' ? (
                            <span>
                              <strong className="text-white">{myCorners}</strong>
                              <span className="text-slate-400">-{opCorners}</span>
                            </span>
                          ) : (
                            <strong className="text-white">{myCorners + opCorners}</strong>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-center py-2 px-2 text-slate-300">
                        {tracked ? (
                          effectiveView === 'split' ? (
                            `${myFouls}-${opFouls}`
                          ) : (
                            myFouls + opFouls
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-center py-2 px-2">
                        {hasCards ? (
                          <span className="text-amber-300 font-semibold">
                            {effectiveView === 'split' ? `${myYc}-${opYc}` : myYc + opYc}
                            {totalRc > 0 && (
                              <span className="ml-1 text-rose-400">/{totalRc}R</span>
                            )}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-center py-2 px-2 text-slate-400">
                        {tracked && (my?.offsides != null || op?.offsides != null)
                          ? effectiveView === 'split'
                            ? `${myOff}-${opOff}`
                            : myOff + opOff
                          : '—'}
                      </td>
                      <td className="text-center py-2 px-2 text-slate-300">
                        {tracked && (my?.saves != null || op?.saves != null)
                          ? effectiveView === 'split'
                            ? `${mySav}-${opSav}`
                            : mySav + opSav
                          : '—'}
                      </td>
                      <td className="text-center py-2 px-2 text-slate-400">
                        {effectiveView === 'split'
                          ? formatPassPct(my)
                          : `${formatPassPct(op)} / ${formatPassPct(my)}`}
                      </td>
                      <td className="text-right py-2 px-3">
                        <div className="inline-flex items-center justify-end gap-1">
                          {btts && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-300 border border-emerald-500/25">
                              BTTS
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                              o25
                                ? 'bg-blue-500/12 text-blue-300 border-blue-500/25'
                                : 'bg-white/[0.04] text-slate-400 border-white/[0.08]'
                            }`}
                          >
                            {o25 ? '+2.5' : '-2.5'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        /* Basketball Historical KPI Strip & Sticky Table */
        <>
          {bballSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 tabular-nums">
              <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-400">
                  Balance ({bballSummary.gamesCount} PJ)
                </div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {bballSummary.wins}-{bballSummary.losses}
                </div>
                {bballForm.length > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    {bballForm.map((r, i) => (
                      <FormBadge key={`${r}_${i}`} res={r} />
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-400">PTS F-C</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {bballSummary.avgFor.toFixed(1)} - {bballSummary.avgAgainst.toFixed(1)}
                </div>
                <div className="text-[10px] text-slate-400">
                  Margen {bballSummary.avgMargin >= 0 ? '+' : ''}
                  {bballSummary.avgMargin.toFixed(1)}
                </div>
              </div>
              <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-400">Total / PJ</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {bballSummary.avgCombined.toFixed(1)}
                </div>
                <div className="text-[10px] text-slate-400">
                  Over {bballSummary.overHits}/{bballSummary.overTracked || bballSummary.gamesCount}
                </div>
              </div>
              <div className="rounded-lg bg-[#0e1117] border border-white/[0.08] p-2.5">
                <div className="text-[10px] font-semibold uppercase text-slate-400">Cubrió ATS</div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {bballSummary.atsTracked > 0
                    ? `${bballSummary.atsWins}/${bballSummary.atsTracked}`
                    : '—'}
                </div>
                <div className="text-[10px] text-slate-400">Frente al hándicap</div>
              </div>
            </div>
          )}

          <div
            tabIndex={0}
            role="region"
            aria-label={`Historial de partidos jugados${focusTeamName ? ` de ${focusTeamName}` : ''}`}
            className="overflow-auto sb-scroller rounded-xl border border-white/[0.08] max-h-[460px]"
          >
            <table className="w-full text-xs tabular-nums whitespace-nowrap cv-sticky-table">
              <caption className="visually-hidden">
                Partidos jugados con parciales por cuarto y resultados de mercado
              </caption>
              <thead className="text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th scope="col" className="text-left py-2.5 px-3 font-semibold">
                    PARTIDO
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    RES
                  </th>
                  {Array.from({ length: basketPeriodCount }).map((_, idx) => (
                    <th key={idx} scope="col" className="text-center py-2.5 px-2 font-semibold">
                      {idx < 4 ? `Q${idx + 1}` : `OT${idx - 3}`}
                    </th>
                  ))}
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    TOT
                  </th>
                  <th scope="col" className="text-center py-2.5 px-2 font-semibold">
                    O/U
                  </th>
                  <th scope="col" className="text-right py-2.5 px-3 font-semibold">
                    ATS
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {filteredGames.map((g) => {
                  const isHome = focusTeamId != null ? g.home_team_id === focusTeamId : true;
                  const opp = isHome ? g.away_team : g.home_team;
                  const myScore = isHome ? g.home_score : g.away_score;
                  const oppScore = isHome ? g.away_score : g.home_score;
                  const won = focusTeamId != null && myScore > oppScore;
                  const myLs = isHome ? g.home_linescores : g.away_linescores;
                  const opLs = isHome ? g.away_linescores : g.home_linescores;
                  const evalRes = evaluateGameBettingResult(g);
                  const teamSpread = isHome ? g.odds?.home_spread : g.odds?.away_spread;
                  const spreadAdj =
                    teamSpread != null ? myScore - oppScore + teamSpread : null;

                  const cellInner = (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 w-10 shrink-0">
                        {g.game_date.slice(5)}
                      </span>
                      {focusTeamId != null ? (
                        <>
                          <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-white/[0.05] text-slate-400">
                            {isHome ? 'LOC' : 'VIS'}
                          </span>
                          {opp.logo_url && (
                            <img src={opp.logo_url} alt="" aria-hidden="true" className="w-5 h-5 object-contain shrink-0" />
                          )}
                          <span className="font-semibold text-white">{opp.short_name}</span>
                        </>
                      ) : (
                        <span className="font-semibold text-white">
                          {g.away_team.abbreviation} @ {g.home_team.abbreviation}
                        </span>
                      )}
                      {onSelectGame && (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                      )}
                    </div>
                  );

                  return (
                    <tr key={g.id} className="hover:bg-white/[0.03] transition-colors">
                      <th scope="row" className="text-left py-2 px-3 font-normal">
                        {onSelectGame ? (
                          <button
                            type="button"
                            onClick={() => onSelectGame(g)}
                            className="text-left hover:text-blue-300 transition-colors focus-visible:underline"
                          >
                            {cellInner}
                          </button>
                        ) : (
                          cellInner
                        )}
                      </th>
                      <td className="text-center py-2 px-2">
                        <div className="inline-flex items-center gap-1.5">
                          {focusTeamId != null && (
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                won
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-rose-500/15 text-rose-300'
                              }`}
                            >
                              {won ? 'G' : 'P'}
                            </span>
                          )}
                          <span className="font-bold text-white">
                            {focusTeamId != null
                              ? `${myScore}-${oppScore}`
                              : `${g.away_score}-${g.home_score}`}
                          </span>
                        </div>
                      </td>
                      {Array.from({ length: basketPeriodCount }).map((_, idx) => (
                        <td key={idx} className="text-center py-2 px-2 text-slate-300">
                          {myLs?.[idx] != null || opLs?.[idx] != null
                            ? `${myLs?.[idx] ?? 0}-${opLs?.[idx] ?? 0}`
                            : '—'}
                        </td>
                      ))}
                      <td className="text-center py-2 px-2 font-semibold text-white">
                        {g.home_score + g.away_score}
                      </td>
                      <td className="text-center py-2 px-2">
                        {evalRes.totalResult ? (
                          <span
                            className={
                              evalRes.totalResult === 'OVER'
                                ? 'text-emerald-300 font-semibold'
                                : evalRes.totalResult === 'UNDER'
                                  ? 'text-blue-300 font-semibold'
                                  : 'text-slate-400'
                            }
                          >
                            {evalRes.totalResult === 'OVER'
                              ? 'OVER'
                              : evalRes.totalResult === 'UNDER'
                                ? 'UNDER'
                                : 'PUSH'}{' '}
                            {g.odds?.over_under != null ? `(${g.odds.over_under})` : ''}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="text-right py-2 px-3">
                        {spreadAdj != null && teamSpread != null ? (
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              spreadAdj > 0
                                ? 'bg-emerald-500/12 text-emerald-300'
                                : spreadAdj < 0
                                  ? 'bg-rose-500/12 text-rose-300'
                                  : 'bg-white/[0.06] text-slate-300'
                            }`}
                          >
                            {teamSpread > 0 ? `+${teamSpread}` : teamSpread} ·{' '}
                            {spreadAdj > 0 ? 'CUBRIÓ' : spreadAdj < 0 ? 'NO' : 'EMP'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
