import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Download,
  Award,
  TrendingUp,
  Minus,
  Plus,
  RotateCcw,
  Target,
  ArrowUpDown,
  Lock,
} from 'lucide-react';
import { fetchPlayerProfileAndLogs } from '../services/basketballApi';
import { downloadPlayerStatCard } from '../utils/shareCard';
import {
  buildSinglePlayerPropsRecommendations,
  isHighProbabilityProp,
  PLAYER_CHART_METRICS,
  suggestPropLine,
  type PlayerChartMetric,
} from '../utils/betting';
import type { Player, PlayerGameStat, PlayerSeasonAverage } from '../types/database';

interface PlayerDetailModalProps {
  playerId: number;
  isPro: boolean;
  onClose: () => void;
  onOpenProModal: () => void;
}

const METRIC_ORDER: PlayerChartMetric[] = ['pts', 'reb', 'ast', 'pra', 'tpm'];

export function PlayerDetailModal({
  playerId,
  isPro,
  onClose,
  onOpenProModal,
}: PlayerDetailModalProps) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [average, setAverage] = useState<PlayerSeasonAverage | null>(null);
  const [logs, setLogs] = useState<PlayerGameStat[]>([]);
  const [loading, setLoading] = useState(true);

  // Interactive chart metric + sportsbook prop line + evaluated side
  const [chartMetric, setChartMetric] = useState<PlayerChartMetric>('pts');
  const [propLine, setPropLine] = useState<number>(15.5);
  const [targetSide, setTargetSide] = useState<'OVER' | 'UNDER'>('OVER');
  const [selectedBarIdx, setSelectedBarIdx] = useState<number | null>(null);
  const [propsOrder, setPropsOrder] = useState<'asc' | 'desc'>('desc');

  const playerProps = useMemo(() => {
    const recs = buildSinglePlayerPropsRecommendations(average, logs);
    return propsOrder === 'desc' ? recs : [...recs].reverse();
  }, [average, logs, propsOrder]);

  useEffect(() => {
    const matching = playerProps.find((p) => p.metricKey === chartMetric);
    if (matching) {
      setTargetSide(matching.pick === 'UNDER' ? 'UNDER' : 'OVER');
    } else {
      setTargetSide('OVER');
    }
  }, [playerId, chartMetric, playerProps]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchPlayerProfileAndLogs(playerId)
      .then((res) => {
        if (!active) return;
        setPlayer(res.player);
        setAverage(res.average);
        setLogs(res.logs);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [playerId]);

  const metricCfg = PLAYER_CHART_METRICS[chartMetric];

  const defaultLineForMetric = useMemo(() => {
    const avgVal = metricCfg.getSeasonAvg(average, logs);
    return suggestPropLine(avgVal);
  }, [metricCfg, average, logs]);

  // Reset suggested prop line when player, data, or selected metric changes
  useEffect(() => {
    setPropLine(defaultLineForMetric);
    setSelectedBarIdx(null);
  }, [playerId, defaultLineForMetric]);

  const chartLogs = useMemo(() => [...logs].reverse(), [logs]);

  const chartStats = useMemo(() => {
    if (chartLogs.length === 0) {
      return {
        values: [] as number[],
        maxScale: 20,
        hitCount: 0,
        last5Hit: 0,
        last5Total: 0,
        stretchAvg: 0,
        minVal: 0,
        maxVal: 0,
      };
    }
    const isHit = (v: number) => (targetSide === 'OVER' ? v > propLine : v < propLine);
    const values = chartLogs.map((g) => metricCfg.getStatValue(g));
    const maxRaw = Math.max(...values, propLine, 4);
    const maxScale = Math.max(5, Math.ceil(maxRaw * 1.15));
    const hitCount = values.filter(isHit).length;
    const recent5 = values.slice(-5);
    const last5Hit = recent5.filter(isHit).length;
    const stretchAvg = values.reduce((sum, v) => sum + v, 0) / values.length;
    return {
      values,
      maxScale,
      hitCount,
      last5Hit,
      last5Total: recent5.length,
      stretchAvg,
      minVal: Math.min(...values),
      maxVal: Math.max(...values),
    };
  }, [chartLogs, metricCfg, propLine, targetSide]);

  const accent = player?.team?.primary_color || '#f97316';
  const hitRatePct =
    chartLogs.length > 0 ? Math.round((chartStats.hitCount / chartLogs.length) * 100) : 0;
  const lineBottomPct = Math.min(96, Math.max(4, (propLine / chartStats.maxScale) * 100));

  const adjustPropLine = (delta: number) => {
    setPropLine((prev) => Math.max(0.5, Number((prev + delta).toFixed(1))));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-[#080d1a] border border-white/[0.1] rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        {loading || !player ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            {loading ? 'Cargando ficha del jugador...' : 'No se encontró al jugador.'}
          </div>
        ) : (
          <>
            {/* Hero Header */}
            <div
              className="shrink-0 relative p-5 border-b border-white/[0.08]"
              style={{
                background: `linear-gradient(135deg, ${accent}38 0%, #080d1a 72%)`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-2xl bg-slate-950/90 border border-white/[0.12] overflow-hidden shrink-0 flex items-center justify-center shadow-lg">
                    {player.headshot_url ? (
                      <img
                        src={player.headshot_url}
                        alt={player.full_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl font-black text-slate-500">
                        #{player.jersey_number ?? '?'}
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {player.team?.abbreviation && (
                        <span
                          className="text-[11px] font-bold px-2 py-0.5 rounded text-white shadow-sm"
                          style={{ backgroundColor: accent }}
                        >
                          {player.team.abbreviation}
                        </span>
                      )}
                      <span className="text-xs text-slate-300 font-semibold">
                        #{player.jersey_number ?? '-'} · {player.position ?? 'JUG'}
                      </span>
                    </div>
                    <h2 className="text-xl sm:text-2xl font-black text-white leading-tight">
                      {player.full_name}
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">
                      {[
                        player.height_display,
                        player.weight_display,
                        player.age ? `${player.age} años` : null,
                        player.country,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="p-1.5 rounded-full bg-black/50 border border-white/[0.1] text-slate-300 hover:text-white"
                  aria-label="Cerrar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {average && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3 text-xs text-slate-300">
                    <span className="inline-flex items-center gap-1">
                      <Award className="w-3.5 h-3.5 text-amber-400" />
                      Doble-Dobles: <strong className="text-white">{average.double_doubles}</strong>
                    </span>
                    {average.triple_doubles > 0 && (
                      <span>
                        Triple-Dobles:{' '}
                        <strong className="text-emerald-400">{average.triple_doubles}</strong>
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => downloadPlayerStatCard(average)}
                    className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Tarjeta PNG
                  </button>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-5">
              {average ? (
                <>
                  {/* Main Averages Grid */}
                  <div className="grid grid-cols-4 gap-2 tabular-nums">
                    {[
                      { label: 'PPG', value: Number(average.ppg ?? 0).toFixed(1), hi: true },
                      { label: 'RPG', value: Number(average.rpg ?? 0).toFixed(1) },
                      { label: 'APG', value: Number(average.apg ?? 0).toFixed(1) },
                      { label: 'MPG', value: Number(average.mpg ?? 0).toFixed(1) },
                    ].map((st) => (
                      <div
                        key={st.label}
                        className="sb-card rounded-xl p-3 text-center"
                      >
                        <div className="text-[11px] font-semibold text-slate-400">{st.label}</div>
                        <div
                          className={`text-xl font-black mt-0.5 ${
                            st.hi ? 'text-emerald-400' : 'text-white'
                          }`}
                        >
                          {st.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Shooting & Advanced Metrics */}
                  <div className="sb-card rounded-xl p-3.5">
                    <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
                      Eficiencia de Tiro y Métricas Avanzadas ({average.gp} PJ)
                    </div>
                    <div className="grid grid-cols-5 gap-2 text-center tabular-nums">
                      {[
                        { label: 'FG%', val: average.fg_pct },
                        { label: '3P%', val: average.tp_pct },
                        { label: 'FT%', val: average.ft_pct },
                        { label: 'eFG%', val: average.efg_pct },
                        { label: 'TS%', val: average.ts_pct },
                      ].map((m) => (
                        <div key={m.label}>
                          <div className="text-[11px] text-slate-400">{m.label}</div>
                          <div className="text-sm font-bold text-slate-100 mt-0.5">
                            {m.val != null ? `${Number(m.val).toFixed(1)}%` : '-'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="sb-card rounded-xl p-4 text-center text-xs text-slate-400">
                  Este jugador aún no registra partidos finalizados en la temporada actual.
                </div>
              )}

              {/* Suggested Props for this Player */}
              {playerProps.length > 0 && (
                <div className="sb-card rounded-xl p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-emerald-400">
                        <Target className="w-3.5 h-3.5" />
                        Props Sugeridos del Jugador
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Toca un mercado para graficarlo abajo · Ordenado por confianza.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPropsOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                      className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-lg bg-black/40 border border-white/[0.1] text-slate-200 hover:border-emerald-400/50 transition-colors"
                    >
                      <ArrowUpDown className="w-3 h-3 text-emerald-400" />
                      {propsOrder === 'desc' ? 'Mayor → Menor' : 'Menor → Mayor'}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {playerProps.map((prop) => {
                      const locked = !isPro && isHighProbabilityProp(prop.confidence);
                      const isSelected = !locked && chartMetric === prop.metricKey;
                      const badgeCls =
                        prop.pick === 'OVER' ? 'sb-neon-over' : 'sb-neon-under';
                      return (
                        <button
                          key={prop.id}
                          type="button"
                          onClick={() => {
                            if (locked) {
                              onOpenProModal();
                              return;
                            }
                            if (prop.metricKey) {
                              setChartMetric(prop.metricKey);
                              setPropLine(prop.lineValue);
                              setTargetSide(prop.pick === 'UNDER' ? 'UNDER' : 'OVER');
                            }
                          }}
                          className={`w-full text-left rounded-xl p-2.5 border transition-all ${
                            isSelected
                              ? 'bg-emerald-500/10 border-emerald-400/60'
                              : 'bg-black/35 border-white/[0.08] hover:border-emerald-400/35'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold text-white">{prop.marketLabel}</span>
                            <div className="flex items-center gap-2 tabular-nums">
                              {!locked && (
                                <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-white/[0.06] text-amber-300 border border-white/[0.1]">
                                  {prop.estimatedMultiplier.toFixed(2)}x
                                </span>
                              )}
                              {locked ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md sb-pro-pill">
                                  <Lock className="w-3 h-3" />
                                  PRO ($5 / S/ 19)
                                </span>
                              ) : (
                                <span
                                  className={`text-[11px] font-black px-2 py-0.5 rounded-md border ${badgeCls}`}
                                >
                                  {prop.pickLabel}
                                </span>
                              )}
                              <span className="text-xs font-black text-emerald-400">
                                {prop.confidence}%
                              </span>
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
                            <span>{locked ? 'Prop de alta probabilidad bloqueado.' : prop.statSummary}</span>
                            <span className="text-amber-300 font-semibold">
                              {locked ? 'Desbloquear PRO' : `${prop.marketLineText} · ${prop.confidenceTier}`}
                            </span>
                          </div>
                          {!locked && prop.contextBadges.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {prop.contextBadges.map((b, idx) => (
                                <span
                                  key={`${b.label}_${idx}`}
                                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300 border border-white/[0.08] tabular-nums"
                                >
                                  {b.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Interactive Trend Chart + Sportsbook Prop Line Hit Rate */}
              {chartLogs.length > 0 && (
                <div className="sb-card rounded-xl p-3.5 space-y-3">
                  {/* Title + Metric Selector */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-200 uppercase tracking-wider">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      {metricCfg.label} · Últimos {chartLogs.length} PJ
                    </span>

                    <div className="flex items-center gap-1 bg-black/50 p-1 rounded-lg border border-white/[0.08]">
                      {METRIC_ORDER.map((mKey) => {
                        const cfg = PLAYER_CHART_METRICS[mKey];
                        const active = chartMetric === mKey;
                        return (
                          <button
                            key={mKey}
                            type="button"
                            onClick={() => setChartMetric(mKey)}
                            className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${
                              active
                                ? 'bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {cfg.short}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Interactive Sportsbook O/U Line & Hit Rate */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950/70 border border-slate-800/80 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-slate-400">
                        Línea O/U (Casa):
                      </span>
                      <div className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900 overflow-hidden tabular-nums">
                        <button
                          type="button"
                          onClick={() => adjustPropLine(-0.5)}
                          className="p-1.5 text-slate-300 hover:bg-slate-800"
                          aria-label="Bajar línea 0.5"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="px-2.5 text-xs font-black text-amber-300">
                          {propLine.toFixed(1)}
                        </span>
                        <button
                          type="button"
                          onClick={() => adjustPropLine(0.5)}
                          className="p-1.5 text-slate-300 hover:bg-slate-800"
                          aria-label="Subir línea 0.5"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      {Math.abs(propLine - defaultLineForMetric) > 0.01 && (
                        <button
                          type="button"
                          onClick={() => setPropLine(defaultLineForMetric)}
                          className="text-[10px] inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
                          title="Volver a línea sugerida"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Prom.
                        </button>
                      )}
                      <div className="inline-flex rounded-lg bg-slate-900 border border-slate-700 p-0.5 text-[10px]">
                        {(['OVER', 'UNDER'] as const).map((side) => (
                          <button
                            key={side}
                            type="button"
                            onClick={() => setTargetSide(side)}
                            className={`px-2 py-0.5 rounded font-bold transition-colors ${
                              targetSide === side
                                ? 'bg-slate-200 text-slate-950'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {side}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] tabular-nums">
                      <span
                        className={`font-extrabold px-2 py-0.5 rounded-full ${
                          hitRatePct >= 60
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : hitRatePct <= 40
                              ? 'bg-rose-500/20 text-rose-300'
                              : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {targetSide} {chartStats.hitCount}/{chartLogs.length} ({hitRatePct}%)
                      </span>
                      <span className="text-slate-400">
                        Últ. {chartStats.last5Total}:{' '}
                        <strong className="text-slate-200">
                          {chartStats.last5Hit}/{chartStats.last5Total}
                        </strong>
                      </span>
                      <span className="text-slate-400">
                        Prom:{' '}
                        <strong className="text-slate-200">
                          {chartStats.stretchAvg.toFixed(1)}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Bar Chart with Dashed O/U Line */}
                  <div className="relative pt-5 pb-1">
                    <div className="relative flex items-end gap-1 sm:gap-1.5 h-32">
                      {/* Dashed Reference Line */}
                      <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-amber-400/75 pointer-events-none z-10 flex justify-end"
                        style={{ bottom: `${lineBottomPct}%` }}
                      >
                        <span className="-translate-y-4 text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 tabular-nums">
                          {propLine.toFixed(1)}
                        </span>
                      </div>

                      {chartLogs.map((g, idx) => {
                        const val = metricCfg.getStatValue(g);
                        const isHit = targetSide === 'OVER' ? val > propLine : val < propLine;
                        const pct = Math.max(8, Math.round((val / chartStats.maxScale) * 100));
                        const isHome = g.game?.home_team_id === g.team_id;
                        const opp = isHome
                          ? g.game?.away_team?.abbreviation
                          : g.game?.home_team?.abbreviation;
                        const isFocused = selectedBarIdx === idx;
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => setSelectedBarIdx(isFocused ? null : idx)}
                            className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group focus:outline-none"
                            title={`${g.game?.game_date ?? ''} ${isHome ? 'vs' : '@'} ${opp ?? 'NBA'}: ${val} ${metricCfg.short}`}
                          >
                            <span
                              className={`text-[10px] font-bold mb-1 tabular-nums ${
                                isHit ? 'text-emerald-300' : 'text-rose-300/90'
                              }`}
                            >
                              {val}
                            </span>
                            <div
                              className={`w-full max-w-[26px] rounded-t-md transition-all ${
                                isFocused ? 'ring-2 ring-white/80' : ''
                              } ${
                                isHit
                                  ? 'bg-gradient-to-t from-emerald-600 to-emerald-400'
                                  : 'bg-gradient-to-t from-rose-700/80 to-rose-500/85'
                              }`}
                              style={{ height: `${pct}%` }}
                            />
                            <span className="mt-1 text-[8px] sm:text-[9px] text-slate-500 font-semibold truncate max-w-full">
                              {opp ?? '-'}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />
                          Cumple ({targetSide} {propLine.toFixed(1)})
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />
                          No cumple
                        </span>
                      </div>
                      <span className="tabular-nums">
                        Mín: <strong className="text-slate-200">{chartStats.minVal}</strong> · Máx:{' '}
                        <strong className="text-slate-200">{chartStats.maxVal}</strong>
                      </span>
                    </div>

                    {selectedBarIdx !== null && chartLogs[selectedBarIdx] && (
                      <div className="mt-2 rounded-lg bg-slate-800/70 border border-slate-700 px-3 py-1.5 text-[11px] text-slate-200 flex items-center justify-between tabular-nums">
                        <span>
                          {chartLogs[selectedBarIdx].game?.game_date} ·{' '}
                          {chartLogs[selectedBarIdx].game?.home_team_id ===
                          chartLogs[selectedBarIdx].team_id
                            ? 'vs'
                            : '@'}{' '}
                          {chartLogs[selectedBarIdx].game?.home_team_id ===
                          chartLogs[selectedBarIdx].team_id
                            ? chartLogs[selectedBarIdx].game?.away_team?.abbreviation
                            : chartLogs[selectedBarIdx].game?.home_team?.abbreviation}
                        </span>
                        <span className="font-bold">
                          {chartLogs[selectedBarIdx].pts} PTS · {chartLogs[selectedBarIdx].reb} REB
                          · {chartLogs[selectedBarIdx].ast} AST · {chartLogs[selectedBarIdx].tpm} 3P
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Recent Game Log */}
              {logs.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Últimos Partidos
                  </h3>
                  <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full text-xs tabular-nums whitespace-nowrap">
                      <thead className="bg-slate-900/80 text-slate-400">
                        <tr>
                          <th className="text-left py-2 px-3">FECHA</th>
                          <th className="text-left py-2 px-2">RIVAL</th>
                          <th className="text-right py-2 px-2">MIN</th>
                          <th
                            className={`text-right py-2 px-2 ${
                              chartMetric === 'pts' ? 'text-orange-400' : ''
                            }`}
                          >
                            PTS
                          </th>
                          <th
                            className={`text-right py-2 px-2 ${
                              chartMetric === 'reb' ? 'text-orange-400' : ''
                            }`}
                          >
                            REB
                          </th>
                          <th
                            className={`text-right py-2 px-2 ${
                              chartMetric === 'ast' ? 'text-orange-400' : ''
                            }`}
                          >
                            AST
                          </th>
                          <th className="text-right py-2 px-2">TC</th>
                          <th
                            className={`text-right py-2 px-2 ${
                              chartMetric === 'tpm' ? 'text-orange-400' : ''
                            }`}
                          >
                            3P
                          </th>
                          <th className="text-center py-2 px-2">ESTADO</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {logs.map((row) => {
                          const isHome = row.game?.home_team_id === row.team_id;
                          const opp = isHome
                            ? row.game?.away_team?.abbreviation
                            : row.game?.home_team?.abbreviation;
                          const metricVal = metricCfg.getStatValue(row);
                          const isHit =
                            targetSide === 'OVER' ? metricVal > propLine : metricVal < propLine;
                          return (
                            <tr key={row.id} className="hover:bg-slate-800/30">
                              <td className="py-2 px-3 text-slate-400">
                                {row.game?.game_date?.slice(5) ?? '-'}
                              </td>
                              <td className="py-2 px-2 font-semibold text-slate-200">
                                {isHome ? 'vs' : '@'} {opp ?? 'NBA'}
                              </td>
                              <td className="text-right py-2 px-2 text-slate-300">{row.minutes}</td>
                              <td
                                className={`text-right py-2 px-2 ${
                                  chartMetric === 'pts'
                                    ? 'font-black text-white'
                                    : 'font-semibold text-slate-200'
                                }`}
                              >
                                {row.pts}
                              </td>
                              <td
                                className={`text-right py-2 px-2 ${
                                  chartMetric === 'reb'
                                    ? 'font-black text-white'
                                    : 'text-slate-300'
                                }`}
                              >
                                {row.reb}
                              </td>
                              <td
                                className={`text-right py-2 px-2 ${
                                  chartMetric === 'ast'
                                    ? 'font-black text-white'
                                    : 'text-slate-300'
                                }`}
                              >
                                {row.ast}
                              </td>
                              <td className="text-right py-2 px-2 text-slate-400">
                                {row.fgm}-{row.fga}
                              </td>
                              <td
                                className={`text-right py-2 px-2 ${
                                  chartMetric === 'tpm'
                                    ? 'font-bold text-white'
                                    : 'text-slate-400'
                                }`}
                              >
                                {row.tpm}-{row.tpa}
                              </td>
                              <td className="text-center py-2 px-2">
                                <span
                                  className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                    isHit
                                      ? 'bg-emerald-500/20 text-emerald-300'
                                      : 'bg-rose-500/15 text-rose-300'
                                  }`}
                                >
                                  {isHit ? 'Cumple' : 'No cumple'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
