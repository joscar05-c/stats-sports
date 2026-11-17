import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Download, Search, Shield, User } from 'lucide-react';
import {
  fetchFootballSeasonAverages,
  fetchFootballTeamSeasonAverages,
  fetchSeasonAverages,
  fetchTeamSeasonAverages,
} from '../services/basketballApi';
import { downloadCompareCard } from '../utils/shareCard';
import type {
  FootballPlayerSeasonAverage,
  FootballTeamSeasonAverage,
  PlayerSeasonAverage,
  TeamSeasonAverage,
} from '../types/database';

interface CompareViewProps {
  leagueId: number;
  seasonId: number;
  sport?: 'basketball' | 'football';
}

type CompareMode = 'players' | 'teams';

const PLAYER_AXES: Array<{ key: keyof PlayerSeasonAverage; label: string; max: number }> = [
  { key: 'ppg', label: 'PTS', max: 36 },
  { key: 'rpg', label: 'REB', max: 15 },
  { key: 'apg', label: 'AST', max: 12 },
  { key: 'spg', label: 'ROB', max: 3 },
  { key: 'fg_pct', label: 'TC%', max: 70 },
  { key: 'ts_pct', label: 'TS%', max: 75 },
];

const TEAM_AXES: Array<{
  label: string;
  getRatio: (t: TeamSeasonAverage) => number;
}> = [
  {
    label: 'ATAQUE',
    getRatio: (t) => (Number(t.ppg ?? 100) - 95) / 35,
  },
  {
    label: 'DEFENSA',
    getRatio: (t) => (130 - Number(t.oppg ?? 115)) / 30,
  },
  {
    label: 'REB',
    getRatio: (t) => (Number(t.rpg ?? 38) - 34) / 18,
  },
  {
    label: 'AST',
    getRatio: (t) => (Number(t.apg ?? 22) - 18) / 15,
  },
  {
    label: '3P%',
    getRatio: (t) => (Number(t.tp_pct ?? 33) - 28) / 16,
  },
  {
    label: 'TS%',
    getRatio: (t) => (Number(t.ts_pct ?? 55) - 48) / 18,
  },
];

function GenericRadarChart({
  labels,
  ratiosA,
  ratiosB,
}: {
  labels: string[];
  ratiosA: number[];
  ratiosB: number[];
}) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 98;
  const n = labels.length;

  const pointAt = (idx: number, ratio: number) => {
    const angle = (Math.PI * 2 * idx) / n - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * radius * ratio,
      y: cy + Math.sin(angle) * radius * ratio,
    };
  };

  const toPolygon = (ratios: number[]) =>
    ratios
      .map((r, i) => {
        const clamped = Math.min(1, Math.max(0.1, r));
        const pt = pointAt(i, clamped);
        return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[280px] mx-auto overflow-visible">
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={labels
            .map((_, i) => {
              const p = pointAt(i, ring);
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            })
            .join(' ')}
          fill="none"
          stroke="rgba(148,163,184,0.18)"
          strokeWidth="1"
        />
      ))}

      {labels.map((lbl, i) => {
        const edge = pointAt(i, 1);
        const labelPt = pointAt(i, 1.18);
        return (
          <g key={lbl}>
            <line
              x1={cx}
              y1={cy}
              x2={edge.x}
              y2={edge.y}
              stroke="rgba(148,163,184,0.18)"
              strokeWidth="1"
            />
            <text
              x={labelPt.x}
              y={labelPt.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-400 text-[11px] font-bold"
            >
              {lbl}
            </text>
          </g>
        );
      })}

      <polygon
        points={toPolygon(ratiosA)}
        fill="rgba(59,130,246,0.24)"
        stroke="#3b82f6"
        strokeWidth="2.2"
      />
      <polygon
        points={toPolygon(ratiosB)}
        fill="rgba(203,213,225,0.18)"
        stroke="#cbd5e1"
        strokeWidth="2.2"
      />
    </svg>
  );
}

const FOOTBALL_PLAYER_AXES: Array<{ key: keyof FootballPlayerSeasonAverage; label: string; max: number }> = [
  { key: 'goals', label: 'GOL', max: 14 },
  { key: 'assists', label: 'AST', max: 10 },
  { key: 'shots_pg', label: 'REM/PJ', max: 5 },
  { key: 'sot_pg', label: 'ARCO/PJ', max: 2.5 },
  { key: 'gp', label: 'PJ', max: 15 },
  { key: 'starts', label: 'TIT', max: 15 },
];

const FOOTBALL_TEAM_AXES: Array<{
  label: string;
  getRatio: (t: FootballTeamSeasonAverage) => number;
}> = [
  { label: 'GOLES', getRatio: (t) => Number(t.gf_pg ?? 1) / 2.6 },
  { label: 'DEFENSA', getRatio: (t) => (2.6 - Number(t.ga_pg ?? 1.4)) / 2.2 },
  { label: 'POS%', getRatio: (t) => (Number(t.possession_avg ?? 50) - 35) / 35 },
  { label: 'REM', getRatio: (t) => Number(t.shots_pg ?? 10) / 18 },
  { label: 'ARCO', getRatio: (t) => Number(t.sot_pg ?? 4) / 7 },
  { label: 'PTS', getRatio: (t) => Number(t.win_pct ?? 0.5) },
];

export function CompareView({
  leagueId,
  seasonId,
  sport = 'basketball',
}: CompareViewProps) {
  const [mode, setMode] = useState<CompareMode>('players');
  const [players, setPlayers] = useState<PlayerSeasonAverage[]>([]);
  const [teams, setTeams] = useState<TeamSeasonAverage[]>([]);
  const [fbPlayers, setFbPlayers] = useState<FootballPlayerSeasonAverage[]>([]);
  const [fbTeams, setFbTeams] = useState<FootballTeamSeasonAverage[]>([]);
  const [idA, setIdA] = useState<number | null>(null);
  const [idB, setIdB] = useState<number | null>(null);
  const [teamIdA, setTeamIdA] = useState<number | null>(null);
  const [teamIdB, setTeamIdB] = useState<number | null>(null);
  const [searchA, setSearchA] = useState('');
  const [searchB, setSearchB] = useState('');
  const [teamSearchA, setTeamSearchA] = useState('');
  const [teamSearchB, setTeamSearchB] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    if (sport === 'football') {
      Promise.all([
        fetchFootballSeasonAverages(leagueId, seasonId),
        fetchFootballTeamSeasonAverages(leagueId, seasonId),
      ])
        .then(([pRes, tRes]) => {
          if (!active) return;
          const qualified = pRes.data.filter((p) => p.gp >= 1);
          setFbPlayers(qualified);
          if (qualified.length >= 2) {
            setIdA(qualified[0].player_id);
            setIdB(qualified[1].player_id);
          }
          const sortedTeams = tRes.data.toSorted(
            (a, b) => Number(b.points ?? 0) - Number(a.points ?? 0),
          );
          setFbTeams(sortedTeams);
          if (sortedTeams.length >= 2) {
            setTeamIdA(sortedTeams[0].team_id);
            setTeamIdB(sortedTeams[1].team_id);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } else {
      Promise.all([
        fetchSeasonAverages(leagueId, seasonId),
        fetchTeamSeasonAverages(leagueId, seasonId),
      ])
        .then(([pRes, tRes]) => {
          if (!active) return;
          const qualified = pRes.data.filter((p) => p.gp >= 1);
          setPlayers(qualified);
          if (qualified.length >= 2) {
            setIdA(qualified[0].player_id);
            setIdB(qualified[1].player_id);
          }
          const sortedTeams = tRes.data.toSorted(
            (a, b) => Number(b.win_pct ?? 0) - Number(a.win_pct ?? 0),
          );
          setTeams(sortedTeams);
          if (sortedTeams.length >= 2) {
            setTeamIdA(sortedTeams[0].team_id);
            setTeamIdB(sortedTeams[1].team_id);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [leagueId, seasonId, sport]);

  const playerA = useMemo(() => players.find((p) => p.player_id === idA) ?? null, [players, idA]);
  const playerB = useMemo(() => players.find((p) => p.player_id === idB) ?? null, [players, idB]);
  const fbPlayerA = useMemo(() => fbPlayers.find((p) => p.player_id === idA) ?? null, [fbPlayers, idA]);
  const fbPlayerB = useMemo(() => fbPlayers.find((p) => p.player_id === idB) ?? null, [fbPlayers, idB]);

  const teamA = useMemo(() => teams.find((t) => t.team_id === teamIdA) ?? null, [teams, teamIdA]);
  const teamB = useMemo(() => teams.find((t) => t.team_id === teamIdB) ?? null, [teams, teamIdB]);
  const fbTeamA = useMemo(() => fbTeams.find((t) => t.team_id === teamIdA) ?? null, [fbTeams, teamIdA]);
  const fbTeamB = useMemo(() => fbTeams.find((t) => t.team_id === teamIdB) ?? null, [fbTeams, teamIdB]);

  const filteredA = useMemo(() => {
    const q = searchA.trim().toLowerCase();
    return q
      ? players.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 40)
      : players.slice(0, 50);
  }, [players, searchA]);

  const filteredB = useMemo(() => {
    const q = searchB.trim().toLowerCase();
    return q
      ? players.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 40)
      : players.slice(0, 50);
  }, [players, searchB]);

  const filteredFbA = useMemo(() => {
    const q = searchA.trim().toLowerCase();
    return q
      ? fbPlayers.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 40)
      : fbPlayers.slice(0, 50);
  }, [fbPlayers, searchA]);

  const filteredFbB = useMemo(() => {
    const q = searchB.trim().toLowerCase();
    return q
      ? fbPlayers.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 40)
      : fbPlayers.slice(0, 50);
  }, [fbPlayers, searchB]);

  const filteredTeamsA = useMemo(() => {
    const q = teamSearchA.trim().toLowerCase();
    return q
      ? teams.filter(
          (t) =>
            t.team_name.toLowerCase().includes(q) ||
            t.team_abbreviation.toLowerCase().includes(q),
        )
      : teams;
  }, [teams, teamSearchA]);

  const filteredTeamsB = useMemo(() => {
    const q = teamSearchB.trim().toLowerCase();
    return q
      ? teams.filter(
          (t) =>
            t.team_name.toLowerCase().includes(q) ||
            t.team_abbreviation.toLowerCase().includes(q),
        )
      : teams;
  }, [teams, teamSearchB]);

  const filteredFbTeamsA = useMemo(() => {
    const q = teamSearchA.trim().toLowerCase();
    return q
      ? fbTeams.filter(
          (t) =>
            t.team_name.toLowerCase().includes(q) ||
            t.team_abbreviation.toLowerCase().includes(q),
        )
      : fbTeams;
  }, [fbTeams, teamSearchA]);

  const filteredFbTeamsB = useMemo(() => {
    const q = teamSearchB.trim().toLowerCase();
    return q
      ? fbTeams.filter(
          (t) =>
            t.team_name.toLowerCase().includes(q) ||
            t.team_abbreviation.toLowerCase().includes(q),
        )
      : fbTeams;
  }, [fbTeams, teamSearchB]);

  if (loading) {
    return (
      <div className="h-64 rounded-xl sb-card animate-pulse" />
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode Switcher */}
      <div className="inline-flex rounded-lg bg-[#12151c] border border-white/[0.08] p-1">
        <button
          type="button"
          onClick={() => setMode('players')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            mode === 'players'
              ? 'cv-tab-active'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <User className="w-3.5 h-3.5" aria-hidden="true" />
          Comparar Jugadores
        </button>
        <button
          type="button"
          onClick={() => setMode('teams')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            mode === 'teams'
              ? 'cv-tab-active'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Shield className="w-3.5 h-3.5" aria-hidden="true" />
          Comparar Equipos
        </button>
      </div>

      {mode === 'players' ? (
        sport === 'football' ? (
          !fbPlayerA || !fbPlayerB ? (
            <div className="sb-card rounded-xl p-8 text-center text-sm text-slate-400">
              Necesitas al menos 2 jugadores con partidos disputados para comparar.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    label: 'Jugador A',
                    badge: 'bg-blue-500',
                    selected: fbPlayerA,
                    search: searchA,
                    setSearch: setSearchA,
                    list: filteredFbA,
                    onChange: setIdA,
                  },
                  {
                    label: 'Jugador B',
                    badge: 'bg-slate-300',
                    selected: fbPlayerB,
                    search: searchB,
                    setSearch: setSearchB,
                    list: filteredFbB,
                    onChange: setIdB,
                  },
                ].map((side) => (
                  <div
                    key={side.label}
                    className="sb-card rounded-xl border border-white/[0.1] p-3.5 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                        <span className={`w-2.5 h-2.5 rounded-full ${side.badge}`} />
                        {side.label}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {side.selected.team_abbreviation ?? 'EPL'} · {side.selected.gp} PJ
                      </span>
                    </div>
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                      <input
                        type="search"
                        aria-label={`Filtrar ${side.label}`}
                        spellCheck={false}
                        enterKeyHint="search"
                        value={side.search}
                        onChange={(e) => side.setSearch(e.target.value)}
                        placeholder="Filtrar nombre..."
                        className="w-full bg-[#0b0d11] border border-white/[0.1] rounded-lg pl-8 pr-3 py-1.5 text-base sm:text-xs text-slate-200 placeholder:text-slate-500"
                      />
                    </div>
                    <select
                      aria-label={`Seleccionar ${side.label}`}
                      value={side.selected.player_id}
                      onChange={(e) => side.onChange(Number(e.target.value))}
                      className="w-full bg-[#0b0d11] border border-white/[0.1] rounded-lg px-3 py-2 text-sm font-semibold text-white"
                    >
                      {!side.list.some((p) => p.player_id === side.selected.player_id) && (
                        <option value={side.selected.player_id}>
                          {side.selected.full_name} ({side.selected.team_abbreviation})
                        </option>
                      )}
                      {side.list.map((p) => (
                        <option key={p.player_id} value={p.player_id}>
                          {p.full_name} ({p.team_abbreviation ?? 'EPL'}) — {p.goals}G {p.assists}A
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="sb-card rounded-xl p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                    <ArrowLeftRight className="w-4 h-4 text-slate-400" aria-hidden="true" />
                    Radar Comparativo de Jugadores
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                  <GenericRadarChart
                    labels={FOOTBALL_PLAYER_AXES.map((a) => a.label)}
                    ratiosA={FOOTBALL_PLAYER_AXES.map((ax) => Number(fbPlayerA[ax.key] ?? 0) / ax.max)}
                    ratiosB={FOOTBALL_PLAYER_AXES.map((ax) => Number(fbPlayerB[ax.key] ?? 0) / ax.max)}
                  />
                  <div className="space-y-3 tabular-nums">
                    {[
                      { label: 'Goles', a: Number(fbPlayerA.goals ?? 0), b: Number(fbPlayerB.goals ?? 0), dec: 0 },
                      { label: 'Asistencias', a: Number(fbPlayerA.assists ?? 0), b: Number(fbPlayerB.assists ?? 0), dec: 0 },
                      { label: 'Remates Totales', a: Number(fbPlayerA.shots ?? 0), b: Number(fbPlayerB.shots ?? 0), dec: 0 },
                      { label: 'Remates al Arco', a: Number(fbPlayerA.shots_on_target ?? 0), b: Number(fbPlayerB.shots_on_target ?? 0), dec: 0 },
                      { label: 'Goles / PJ', a: Number(fbPlayerA.goals_pg ?? 0), b: Number(fbPlayerB.goals_pg ?? 0), dec: 2 },
                      { label: 'Remates / PJ', a: Number(fbPlayerA.shots_pg ?? 0), b: Number(fbPlayerB.shots_pg ?? 0), dec: 2 },
                      { label: 'Titularidades', a: Number(fbPlayerA.starts ?? 0), b: Number(fbPlayerB.starts ?? 0), dec: 0 },
                      { label: 'Tarjetas Amarillas', a: Number(fbPlayerA.yellow_cards ?? 0), b: Number(fbPlayerB.yellow_cards ?? 0), dec: 0, lowerIsBetter: true },
                    ].map((r) => {
                      const total = r.a + r.b || 1;
                      const pctA = Math.round((r.a / total) * 100);
                      const aWin = r.lowerIsBetter ? r.a <= r.b : r.a >= r.b;
                      const bWin = r.lowerIsBetter ? r.b <= r.a : r.b >= r.a;
                      return (
                        <div key={r.label}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className={aWin ? 'font-bold text-blue-400' : 'text-slate-400'}>
                              {r.a.toFixed(r.dec)}
                            </span>
                            <span className="font-medium text-slate-300">{r.label}</span>
                            <span className={bWin ? 'font-bold text-slate-100' : 'text-slate-400'}>
                              {r.b.toFixed(r.dec)}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
                            <div className="bg-blue-500 transition-all" style={{ width: `${pctA}%` }} />
                            <div className="bg-slate-400 transition-all" style={{ width: `${100 - pctA}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )
        ) : !playerA || !playerB ? (
          <div className="sb-card rounded-xl p-8 text-center text-sm text-slate-400">
            Necesitas al menos 2 jugadores con partidos disputados para comparar.
          </div>
        ) : (
          <>
            {/* Player Selector Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  label: 'Jugador A',
                  color: 'border-white/[0.1]',
                  badge: 'bg-blue-500',
                  selected: playerA,
                  search: searchA,
                  setSearch: setSearchA,
                  list: filteredA,
                  onChange: setIdA,
                },
                {
                  label: 'Jugador B',
                  color: 'border-white/[0.1]',
                  badge: 'bg-slate-300',
                  selected: playerB,
                  search: searchB,
                  setSearch: setSearchB,
                  list: filteredB,
                  onChange: setIdB,
                },
              ].map((side) => (
                <div
                  key={side.label}
                  className={`sb-card rounded-xl border ${side.color} p-3.5 space-y-2.5`}
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                      <span className={`w-2.5 h-2.5 rounded-full ${side.badge}`} />
                      {side.label}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {side.selected.team_abbreviation ?? 'NBA'} · {side.selected.gp} PJ
                    </span>
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                    <input
                      type="search"
                      aria-label={`Filtrar ${side.label}`}
                      spellCheck={false}
                      enterKeyHint="search"
                      value={side.search}
                      onChange={(e) => side.setSearch(e.target.value)}
                      placeholder="Filtrar nombre..."
                      className="w-full bg-[#0b0d11] border border-white/[0.1] rounded-lg pl-8 pr-3 py-1.5 text-base sm:text-xs text-slate-200 placeholder:text-slate-500"
                    />
                  </div>

                  <select
                    aria-label={`Seleccionar ${side.label}`}
                    value={side.selected.player_id}
                    onChange={(e) => side.onChange(Number(e.target.value))}
                    className="w-full bg-[#0b0d11] border border-white/[0.1] rounded-lg px-3 py-2 text-sm font-semibold text-white"
                  >
                    {!side.list.some((p) => p.player_id === side.selected.player_id) && (
                      <option value={side.selected.player_id}>
                        {side.selected.full_name} ({side.selected.team_abbreviation})
                      </option>
                    )}
                    {side.list.map((p) => (
                      <option key={p.player_id} value={p.player_id}>
                        {p.full_name} ({p.team_abbreviation ?? 'NBA'}) — {Number(p.ppg).toFixed(1)} PPG
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Player Radar + Bars */}
            <div className="sb-card rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                  <ArrowLeftRight className="w-4 h-4 text-slate-400" aria-hidden="true" />
                  Radar Comparativo de Jugadores
                </div>
                <button
                  onClick={() => downloadCompareCard(playerA, playerB)}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg cv-btn-primary"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  Compartir PNG
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <GenericRadarChart
                  labels={PLAYER_AXES.map((a) => a.label)}
                  ratiosA={PLAYER_AXES.map((ax) => Number(playerA[ax.key] ?? 0) / ax.max)}
                  ratiosB={PLAYER_AXES.map((ax) => Number(playerB[ax.key] ?? 0) / ax.max)}
                />

                <div className="space-y-3 tabular-nums">
                  {[
                    { label: 'Puntos (PPG)', a: Number(playerA.ppg ?? 0), b: Number(playerB.ppg ?? 0) },
                    { label: 'Rebotes (RPG)', a: Number(playerA.rpg ?? 0), b: Number(playerB.rpg ?? 0) },
                    { label: 'Asistencias (APG)', a: Number(playerA.apg ?? 0), b: Number(playerB.apg ?? 0) },
                    { label: 'Robos (SPG)', a: Number(playerA.spg ?? 0), b: Number(playerB.spg ?? 0) },
                    { label: 'Tapones (BPG)', a: Number(playerA.bpg ?? 0), b: Number(playerB.bpg ?? 0) },
                    { label: 'Tiros de Campo %', a: Number(playerA.fg_pct ?? 0), b: Number(playerB.fg_pct ?? 0), suffix: '%' },
                    { label: 'Triples %', a: Number(playerA.tp_pct ?? 0), b: Number(playerB.tp_pct ?? 0), suffix: '%' },
                    { label: 'Tiros Libres %', a: Number(playerA.ft_pct ?? 0), b: Number(playerB.ft_pct ?? 0), suffix: '%' },
                    { label: 'True Shooting %', a: Number(playerA.ts_pct ?? 0), b: Number(playerB.ts_pct ?? 0), suffix: '%' },
                  ].map((r) => {
                    const total = r.a + r.b || 1;
                    const pctA = Math.round((r.a / total) * 100);
                    const s = r.suffix ?? '';
                    return (
                      <div key={r.label}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className={r.a >= r.b ? 'font-bold text-blue-400' : 'text-slate-400'}>
                            {r.a.toFixed(1)}
                            {s}
                          </span>
                          <span className="font-medium text-slate-300">{r.label}</span>
                          <span className={r.b >= r.a ? 'font-bold text-slate-100' : 'text-slate-400'}>
                            {r.b.toFixed(1)}
                            {s}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
                          <div
                            className="bg-blue-500 transition-all"
                            style={{ width: `${pctA}%` }}
                          />
                          <div
                            className="bg-slate-400 transition-all"
                            style={{ width: `${100 - pctA}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )
      ) : sport === 'football' ? (
        !fbTeamA || !fbTeamB ? (
          <div className="sb-card rounded-xl p-8 text-center text-sm text-slate-400">
            No hay suficientes clubes con estadísticas para comparar.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  label: 'Club A',
                  badge: 'bg-blue-500',
                  selected: fbTeamA,
                  search: teamSearchA,
                  setSearch: setTeamSearchA,
                  list: filteredFbTeamsA,
                  onChange: setTeamIdA,
                },
                {
                  label: 'Club B',
                  badge: 'bg-slate-300',
                  selected: fbTeamB,
                  search: teamSearchB,
                  setSearch: setTeamSearchB,
                  list: filteredFbTeamsB,
                  onChange: setTeamIdB,
                },
              ].map((side) => (
                <div
                  key={side.label}
                  className="sb-card rounded-xl border border-white/[0.1] p-3.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                      <span className={`w-2.5 h-2.5 rounded-full ${side.badge}`} />
                      {side.label}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-300 tabular-nums">
                      #{side.selected.rank ?? '-'} · {side.selected.points} PTS ({side.selected.wins}-{side.selected.draws}-{side.selected.losses})
                    </span>
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                    <input
                      type="search"
                      aria-label={`Filtrar ${side.label}`}
                      value={side.search}
                      onChange={(e) => side.setSearch(e.target.value)}
                      placeholder="Filtrar club..."
                      className="w-full bg-[#0b0d11] border border-white/[0.1] rounded-lg pl-8 pr-3 py-1.5 text-base sm:text-xs text-slate-200 placeholder:text-slate-500"
                    />
                  </div>
                  <div className="flex items-center gap-2.5">
                    {side.selected.logo_url && (
                      <img
                        src={side.selected.logo_url}
                        alt={side.selected.team_abbreviation}
                        className="w-8 h-8 object-contain shrink-0"
                      />
                    )}
                    <select
                      aria-label={`Seleccionar ${side.label}`}
                      value={side.selected.team_id}
                      onChange={(e) => side.onChange(Number(e.target.value))}
                      className="w-full bg-[#0b0d11] border border-white/[0.1] rounded-lg px-3 py-2 text-sm font-semibold text-white"
                    >
                      {!side.list.some((t) => t.team_id === side.selected.team_id) && (
                        <option value={side.selected.team_id}>
                          {side.selected.team_name} ({side.selected.points} PTS)
                        </option>
                      )}
                      {side.list.map((t) => (
                        <option key={t.team_id} value={t.team_id}>
                          {t.team_name} ({t.wins}-{t.draws}-{t.losses}) — {t.points} PTS
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="sb-card rounded-xl p-4 sm:p-5 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                  <ArrowLeftRight className="w-4 h-4 text-slate-400" aria-hidden="true" />
                  Radar y Comparativa ({fbTeamA.team_abbreviation} vs {fbTeamB.team_abbreviation})
                </div>
                <div className="flex items-center gap-4 text-xs font-semibold">
                  <span className="inline-flex items-center gap-1.5 text-blue-400">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                    {fbTeamA.team_short_name}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-slate-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                    {fbTeamB.team_short_name}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <GenericRadarChart
                  labels={FOOTBALL_TEAM_AXES.map((a) => a.label)}
                  ratiosA={FOOTBALL_TEAM_AXES.map((a) => a.getRatio(fbTeamA))}
                  ratiosB={FOOTBALL_TEAM_AXES.map((a) => a.getRatio(fbTeamB))}
                />
                <div className="space-y-3 tabular-nums">
                  {[
                    { label: 'Puntos en Liga', a: Number(fbTeamA.points ?? 0), b: Number(fbTeamB.points ?? 0), dec: 0 },
                    { label: 'Goles a Favor / PJ', a: Number(fbTeamA.gf_pg ?? 0), b: Number(fbTeamB.gf_pg ?? 0), dec: 2 },
                    { label: 'Goles Recibidos / PJ', a: Number(fbTeamA.ga_pg ?? 0), b: Number(fbTeamB.ga_pg ?? 0), dec: 2, lowerIsBetter: true },
                    { label: 'Posesión Promedio', a: Number(fbTeamA.possession_avg ?? 0), b: Number(fbTeamB.possession_avg ?? 0), dec: 1, suffix: '%' },
                    { label: 'Remates / PJ', a: Number(fbTeamA.shots_pg ?? 0), b: Number(fbTeamB.shots_pg ?? 0), dec: 1 },
                    { label: 'Al Arco / PJ', a: Number(fbTeamA.sot_pg ?? 0), b: Number(fbTeamB.sot_pg ?? 0), dec: 1 },
                    { label: 'Córners / PJ', a: Number(fbTeamA.corners_pg ?? 0), b: Number(fbTeamB.corners_pg ?? 0), dec: 1 },
                    { label: 'Vallas Invictas', a: Number(fbTeamA.clean_sheets ?? 0), b: Number(fbTeamB.clean_sheets ?? 0), dec: 0 },
                  ].map((r) => {
                    const posA = Math.max(0.1, r.a);
                    const posB = Math.max(0.1, r.b);
                    const total = posA + posB || 1;
                    const pctA = Math.round((posA / total) * 100);
                    const s = r.suffix ?? '';
                    const aBetter = r.lowerIsBetter ? r.a <= r.b : r.a >= r.b;
                    const bBetter = r.lowerIsBetter ? r.b <= r.a : r.b >= r.a;
                    return (
                      <div key={r.label}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className={aBetter ? 'font-bold text-blue-400' : 'text-slate-400'}>
                            {r.a.toFixed(r.dec)}
                            {s}
                          </span>
                          <span className="font-medium text-slate-300">{r.label}</span>
                          <span className={bBetter ? 'font-bold text-slate-100' : 'text-slate-400'}>
                            {r.b.toFixed(r.dec)}
                            {s}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
                          <div className="bg-blue-500 transition-all" style={{ width: `${pctA}%` }} />
                          <div className="bg-slate-400 transition-all" style={{ width: `${100 - pctA}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )
      ) : !teamA || !teamB ? (
        <div className="sb-card rounded-xl p-8 text-center text-sm text-slate-400">
          No hay suficientes equipos con estadísticas para comparar.
        </div>
      ) : (
        <>
          {/* Team Selector Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                label: 'Equipo A',
                color: 'border-white/[0.1]',
                badge: 'bg-blue-500',
                selected: teamA,
                search: teamSearchA,
                setSearch: setTeamSearchA,
                list: filteredTeamsA,
                onChange: setTeamIdA,
              },
              {
                label: 'Equipo B',
                color: 'border-white/[0.1]',
                badge: 'bg-slate-300',
                selected: teamB,
                search: teamSearchB,
                setSearch: setTeamSearchB,
                list: filteredTeamsB,
                onChange: setTeamIdB,
              },
            ].map((side) => (
              <div
                key={side.label}
                className={`sb-card rounded-xl border ${side.color} p-3.5 space-y-2.5`}
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <span className={`w-2.5 h-2.5 rounded-full ${side.badge}`} />
                    {side.label}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-300 tabular-nums">
                    {side.selected.wins}-{side.selected.losses} · Conf. {side.selected.conference ?? '-'}
                  </span>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" aria-hidden="true" />
                  <input
                    type="search"
                    aria-label={`Filtrar ${side.label}`}
                    value={side.search}
                    onChange={(e) => side.setSearch(e.target.value)}
                    placeholder="Filtrar equipo..."
                    className="w-full bg-[#0b0d11] border border-white/[0.1] rounded-lg pl-8 pr-3 py-1.5 text-base sm:text-xs text-slate-200 placeholder:text-slate-500"
                  />
                </div>

                <div className="flex items-center gap-2.5">
                  {side.selected.logo_url && (
                    <img
                      src={side.selected.logo_url}
                      alt={side.selected.team_abbreviation}
                      className="w-8 h-8 object-contain shrink-0"
                    />
                  )}
                  <select
                    aria-label={`Seleccionar ${side.label}`}
                    value={side.selected.team_id}
                    onChange={(e) => side.onChange(Number(e.target.value))}
                    className="w-full bg-[#0b0d11] border border-white/[0.1] rounded-lg px-3 py-2 text-sm font-semibold text-white"
                  >
                    {!side.list.some((t) => t.team_id === side.selected.team_id) && (
                      <option value={side.selected.team_id}>
                        {side.selected.team_name} ({side.selected.wins}-{side.selected.losses})
                      </option>
                    )}
                    {side.list.map((t) => (
                      <option key={t.team_id} value={t.team_id}>
                        {t.team_name} ({t.wins}-{t.losses}) — {Number(t.ppg).toFixed(1)} PPG
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 pt-0.5 tabular-nums">
                  <span>
                    Local: <strong className="text-slate-200">{side.selected.home_record ?? '-'}</strong>
                  </span>
                  <span>
                    Visita: <strong className="text-slate-200">{side.selected.away_record ?? '-'}</strong>
                  </span>
                  <span>
                    Últ. 10: <strong className="text-slate-200">{side.selected.last_ten ?? '-'}</strong>
                  </span>
                  <span>
                    Racha: <strong className="text-slate-200">{side.selected.streak ?? '-'}</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Team Radar + Collective Stats Comparison */}
          <div className="sb-card rounded-xl p-4 sm:p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
                <ArrowLeftRight className="w-4 h-4 text-slate-400" aria-hidden="true" />
                Radar y Comparativa Colectiva ({teamA.team_abbreviation} vs {teamB.team_abbreviation})
              </div>
              <div className="flex items-center gap-4 text-xs font-semibold">
                <span className="inline-flex items-center gap-1.5 text-blue-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  {teamA.team_short_name}
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                  {teamB.team_short_name}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              <GenericRadarChart
                labels={TEAM_AXES.map((a) => a.label)}
                ratiosA={TEAM_AXES.map((a) => a.getRatio(teamA))}
                ratiosB={TEAM_AXES.map((a) => a.getRatio(teamB))}
              />

              <div className="space-y-3 tabular-nums">
                {[
                  {
                    label: '% Victorias',
                    a: Number(teamA.win_pct ?? 0) * 100,
                    b: Number(teamB.win_pct ?? 0) * 100,
                    suffix: '%',
                  },
                  {
                    label: 'Puntos a Favor (PPG)',
                    a: Number(teamA.ppg ?? 0),
                    b: Number(teamB.ppg ?? 0),
                  },
                  {
                    label: 'Puntos Recibidos (OPPG)',
                    a: Number(teamA.oppg ?? 0),
                    b: Number(teamB.oppg ?? 0),
                    lowerIsBetter: true,
                  },
                  {
                    label: 'Rebotes Totales (RPG)',
                    a: Number(teamA.rpg ?? 0),
                    b: Number(teamB.rpg ?? 0),
                  },
                  {
                    label: 'Rebotes Ofensivos (OREB)',
                    a: Number(teamA.oreb_pg ?? 0),
                    b: Number(teamB.oreb_pg ?? 0),
                  },
                  {
                    label: 'Asistencias (APG)',
                    a: Number(teamA.apg ?? 0),
                    b: Number(teamB.apg ?? 0),
                  },
                  {
                    label: 'Robos (SPG)',
                    a: Number(teamA.spg ?? 0),
                    b: Number(teamB.spg ?? 0),
                  },
                  {
                    label: 'Tapones (BPG)',
                    a: Number(teamA.bpg ?? 0),
                    b: Number(teamB.bpg ?? 0),
                  },
                  {
                    label: 'Pérdidas (TOPG)',
                    a: Number(teamA.topg ?? 0),
                    b: Number(teamB.topg ?? 0),
                    lowerIsBetter: true,
                  },
                  {
                    label: 'Tiros de Campo %',
                    a: Number(teamA.fg_pct ?? 0),
                    b: Number(teamB.fg_pct ?? 0),
                    suffix: '%',
                  },
                  {
                    label: 'Triples por Partido (3PM)',
                    a: Number(teamA.tpm_pg ?? 0),
                    b: Number(teamB.tpm_pg ?? 0),
                  },
                  {
                    label: 'Efectividad Triples (3P%)',
                    a: Number(teamA.tp_pct ?? 0),
                    b: Number(teamB.tp_pct ?? 0),
                    suffix: '%',
                  },
                  {
                    label: 'Tiros Libres (FT%)',
                    a: Number(teamA.ft_pct ?? 0),
                    b: Number(teamB.ft_pct ?? 0),
                    suffix: '%',
                  },
                  {
                    label: 'True Shooting (TS%)',
                    a: Number(teamA.ts_pct ?? 0),
                    b: Number(teamB.ts_pct ?? 0),
                    suffix: '%',
                  },
                  {
                    label: 'Puntos de la Banca',
                    a: Number(teamA.bench_ppg ?? 0),
                    b: Number(teamB.bench_ppg ?? 0),
                  },
                ].map((r) => {
                  const posA = Math.max(0.1, r.a);
                  const posB = Math.max(0.1, r.b);
                  const total = posA + posB || 1;
                  const pctA = Math.round((posA / total) * 100);
                  const s = r.suffix ?? '';
                  const aBetter = r.lowerIsBetter ? r.a <= r.b : r.a >= r.b;
                  const bBetter = r.lowerIsBetter ? r.b <= r.a : r.b >= r.a;
                  return (
                    <div key={r.label}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className={aBetter ? 'font-bold text-blue-400' : 'text-slate-400'}>
                          {r.a.toFixed(1)}
                          {s}
                        </span>
                        <span className="font-medium text-slate-300">{r.label}</span>
                        <span className={bBetter ? 'font-bold text-slate-100' : 'text-slate-400'}>
                          {r.b.toFixed(1)}
                          {s}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden flex">
                        <div
                          className="bg-blue-500 transition-all"
                          style={{ width: `${pctA}%` }}
                        />
                        <div
                          className="bg-slate-400 transition-all"
                          style={{ width: `${100 - pctA}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
