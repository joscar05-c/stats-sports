import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Download, Search } from 'lucide-react';
import { fetchSeasonAverages } from '../services/basketballApi';
import { downloadCompareCard } from '../utils/shareCard';
import type { PlayerSeasonAverage } from '../types/database';

interface CompareViewProps {
  leagueId: number;
  seasonId: number;
}

const AXES: Array<{ key: keyof PlayerSeasonAverage; label: string; max: number }> = [
  { key: 'ppg', label: 'PTS', max: 36 },
  { key: 'rpg', label: 'REB', max: 15 },
  { key: 'apg', label: 'AST', max: 12 },
  { key: 'spg', label: 'ROB', max: 3 },
  { key: 'fg_pct', label: 'FG%', max: 70 },
  { key: 'ts_pct', label: 'TS%', max: 75 },
];

function RadarChart({ a, b }: { a: PlayerSeasonAverage; b: PlayerSeasonAverage }) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 98;
  const n = AXES.length;

  const pointAt = (idx: number, ratio: number) => {
    const angle = (Math.PI * 2 * idx) / n - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * radius * ratio,
      y: cy + Math.sin(angle) * radius * ratio,
    };
  };

  const toPolygon = (player: PlayerSeasonAverage) =>
    AXES.map((ax, i) => {
      const val = Number(player[ax.key] ?? 0);
      const ratio = Math.min(1, Math.max(0.08, val / ax.max));
      const pt = pointAt(i, ratio);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    }).join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[280px] mx-auto overflow-visible">
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          points={AXES.map((_, i) => {
            const p = pointAt(i, ring);
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
          }).join(' ')}
          fill="none"
          stroke="rgba(148,163,184,0.18)"
          strokeWidth="1"
        />
      ))}

      {AXES.map((ax, i) => {
        const edge = pointAt(i, 1);
        const labelPt = pointAt(i, 1.18);
        return (
          <g key={ax.label}>
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
              {ax.label}
            </text>
          </g>
        );
      })}

      <polygon
        points={toPolygon(a)}
        fill="rgba(249,115,22,0.28)"
        stroke="#fb923c"
        strokeWidth="2.2"
      />
      <polygon
        points={toPolygon(b)}
        fill="rgba(56,189,248,0.26)"
        stroke="#38bdf8"
        strokeWidth="2.2"
      />
    </svg>
  );
}

export function CompareView({ leagueId, seasonId }: CompareViewProps) {
  const [players, setPlayers] = useState<PlayerSeasonAverage[]>([]);
  const [idA, setIdA] = useState<number | null>(null);
  const [idB, setIdB] = useState<number | null>(null);
  const [searchA, setSearchA] = useState('');
  const [searchB, setSearchB] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchSeasonAverages(leagueId, seasonId)
      .then((res) => {
        if (!active) return;
        const qualified = res.data.filter((p) => p.gp >= 1);
        setPlayers(qualified);
        if (qualified.length >= 2) {
          setIdA(qualified[0].player_id);
          setIdB(qualified[1].player_id);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leagueId, seasonId]);

  const playerA = useMemo(() => players.find((p) => p.player_id === idA) ?? null, [players, idA]);
  const playerB = useMemo(() => players.find((p) => p.player_id === idB) ?? null, [players, idB]);

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

  if (loading) {
    return (
      <div className="h-64 rounded-2xl bg-slate-900/60 border border-slate-800 animate-pulse" />
    );
  }

  if (!playerA || !playerB) {
    return (
      <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-8 text-center text-sm text-slate-400">
        Necesitas al menos 2 jugadores con partidos disputados para comparar.
      </div>
    );
  }

  const rows: Array<{ label: string; a: number; b: number; suffix?: string }> = [
    { label: 'Puntos (PPG)', a: Number(playerA.ppg ?? 0), b: Number(playerB.ppg ?? 0) },
    { label: 'Rebotes (RPG)', a: Number(playerA.rpg ?? 0), b: Number(playerB.rpg ?? 0) },
    { label: 'Asistencias (APG)', a: Number(playerA.apg ?? 0), b: Number(playerB.apg ?? 0) },
    { label: 'Robos (SPG)', a: Number(playerA.spg ?? 0), b: Number(playerB.spg ?? 0) },
    { label: 'Tapones (BPG)', a: Number(playerA.bpg ?? 0), b: Number(playerB.bpg ?? 0) },
    { label: 'Tiros de Campo %', a: Number(playerA.fg_pct ?? 0), b: Number(playerB.fg_pct ?? 0), suffix: '%' },
    { label: 'Triples %', a: Number(playerA.tp_pct ?? 0), b: Number(playerB.tp_pct ?? 0), suffix: '%' },
    { label: 'True Shooting %', a: Number(playerA.ts_pct ?? 0), b: Number(playerB.ts_pct ?? 0), suffix: '%' },
  ];

  return (
    <div className="space-y-4">
      {/* Selector Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          {
            label: 'Jugador A',
            color: 'border-orange-500/40',
            badge: 'bg-orange-500',
            selected: playerA,
            search: searchA,
            setSearch: setSearchA,
            list: filteredA,
            onChange: setIdA,
          },
          {
            label: 'Jugador B',
            color: 'border-sky-500/40',
            badge: 'bg-sky-500',
            selected: playerB,
            search: searchB,
            setSearch: setSearchB,
            list: filteredB,
            onChange: setIdB,
          },
        ].map((side) => (
          <div
            key={side.label}
            className={`rounded-2xl bg-slate-900/75 border ${side.color} p-3.5 space-y-2.5`}
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-300">
                <span className={`w-2.5 h-2.5 rounded-full ${side.badge}`} />
                {side.label}
              </span>
              <span className="text-[11px] text-slate-400">
                {side.selected.team_abbreviation ?? 'NBA'} · {side.selected.gp} PJ
              </span>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={side.search}
                onChange={(e) => side.setSearch(e.target.value)}
                placeholder="Filtrar nombre..."
                className="w-full bg-slate-950/70 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-orange-500"
              />
            </div>

            <select
              value={side.selected.player_id}
              onChange={(e) => side.onChange(Number(e.target.value))}
              className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-2 text-sm font-bold text-white focus:outline-none focus:border-orange-500"
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

      {/* Radar + Summary Header */}
      <div className="rounded-2xl bg-slate-900/75 border border-slate-800 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
            <ArrowLeftRight className="w-4 h-4 text-orange-400" />
            Radar Comparativo
          </div>
          <button
            onClick={() => downloadCompareCard(playerA, playerB)}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-slate-950 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Compartir PNG
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <RadarChart a={playerA} b={playerB} />

          <div className="space-y-3 tabular-nums">
            {rows.map((r) => {
              const total = r.a + r.b || 1;
              const pctA = Math.round((r.a / total) * 100);
              const s = r.suffix ?? '';
              return (
                <div key={r.label}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={r.a >= r.b ? 'font-black text-orange-400' : 'text-slate-400'}>
                      {r.a.toFixed(1)}
                      {s}
                    </span>
                    <span className="font-semibold text-slate-300">{r.label}</span>
                    <span className={r.b >= r.a ? 'font-black text-sky-400' : 'text-slate-400'}>
                      {r.b.toFixed(1)}
                      {s}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden flex">
                    <div
                      className="bg-orange-500 transition-all"
                      style={{ width: `${pctA}%` }}
                    />
                    <div
                      className="bg-sky-400 transition-all"
                      style={{ width: `${100 - pctA}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
