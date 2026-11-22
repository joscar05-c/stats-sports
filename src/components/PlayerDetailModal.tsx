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
import type {
  FootballPlayerSeasonAverage,
  Player,
  PlayerGameStat,
  PlayerSeasonAverage,
} from '../types/database';
import { getFootballPlayerStatValue } from '../utils/footballProps';
import { ModalDialog } from './ModalDialog';
import { PlayerAvatar } from './PlayerAvatar';

interface PlayerDetailModalProps {
  playerId: number;
  sport?: 'basketball' | 'football';
  isPro: boolean;
  onClose: () => void;
  onOpenProModal: () => void;
}

const METRIC_ORDER: PlayerChartMetric[] = ['pts', 'reb', 'ast', 'pra', 'tpm'];

type FootballMetricKey = 'goals' | 'assists' | 'shots' | 'sot';
const FOOTBALL_METRICS: Array<{ key: FootballMetricKey; label: string; short: string }> = [
  { key: 'shots', label: 'Remates Totales', short: 'REM' },
  { key: 'sot', label: 'Remates al Arco', short: 'ARCO' },
  { key: 'goals', label: 'Goles', short: 'GOL' },
  { key: 'assists', label: 'Asistencias', short: 'AST' },
];

export function PlayerDetailModal({
  playerId,
  sport = 'basketball',
  isPro,
  onClose,
  onOpenProModal,
}: PlayerDetailModalProps) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [average, setAverage] = useState<PlayerSeasonAverage | null>(null);
  const [fbAverage, setFbAverage] = useState<FootballPlayerSeasonAverage | null>(null);
  const [logs, setLogs] = useState<PlayerGameStat[]>([]);
  const [loading, setLoading] = useState(true);

  // Interactive chart metric + sportsbook prop line + evaluated side
  const [chartMetric, setChartMetric] = useState<PlayerChartMetric>('pts');
  const [fbMetric, setFbMetric] = useState<FootballMetricKey>('shots');
  const [propLine, setPropLine] = useState<number>(15.5);
  const [targetSide, setTargetSide] = useState<'OVER' | 'UNDER'>('OVER');
  const [selectedBarIdx, setSelectedBarIdx] = useState<number | null>(null);
  const [propsOrder, setPropsOrder] = useState<'asc' | 'desc'>('desc');

  const playerProps = useMemo(() => {
    if (sport === 'football') return [];
    const recs = buildSinglePlayerPropsRecommendations(average, logs);
    return propsOrder === 'desc' ? recs : recs.toReversed();
  }, [sport, average, logs, propsOrder]);

  useEffect(() => {
    if (sport === 'football') return;
    const matching = playerProps.find((p) => p.metricKey === chartMetric);
    if (matching) {
      setTargetSide(matching.pick === 'UNDER' ? 'UNDER' : 'OVER');
    } else {
      setTargetSide('OVER');
    }
  }, [sport, playerId, chartMetric, playerProps]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchPlayerProfileAndLogs(playerId, sport)
      .then((res) => {
        if (!active) return;
        setPlayer(res.player);
        setAverage(res.average);
        setFbAverage(res.footballAverage);
        setLogs(res.logs);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [playerId, sport]);

  const metricCfg = PLAYER_CHART_METRICS[chartMetric];
  const fbMetricCfg = FOOTBALL_METRICS.find((m) => m.key === fbMetric) ?? FOOTBALL_METRICS[0];

  const defaultLineForMetric = useMemo(() => {
    if (sport === 'football') {
      if (fbMetric === 'shots') {
        return (fbAverage?.shots_pg ?? 1.5) >= 2.2 ? 2.5 : 1.5;
      }
      return 0.5;
    }
    const avgVal = metricCfg.getSeasonAvg(average, logs);
    return suggestPropLine(avgVal);
  }, [sport, fbMetric, fbAverage, metricCfg, average, logs]);

  // Reset suggested prop line when player, data, or selected metric changes
  useEffect(() => {
    setPropLine(defaultLineForMetric);
    setSelectedBarIdx(null);
  }, [playerId, defaultLineForMetric]);

  const chartLogs = useMemo(() => logs.toReversed(), [logs]);

  const chartStats = useMemo(() => {
    if (chartLogs.length === 0) {
      return {
        values: [] as number[],
        maxScale: sport === 'football' ? 5 : 20,
        hitCount: 0,
        last5Hit: 0,
        last5Total: 0,
        stretchAvg: 0,
        minVal: 0,
        maxVal: 0,
      };
    }
    const isHit = (v: number) => (targetSide === 'OVER' ? v > propLine : v < propLine);
    const values = chartLogs.map((g) =>
      sport === 'football'
        ? getFootballPlayerStatValue(g, fbMetric)
        : metricCfg.getStatValue(g),
    );
    const maxRaw = Math.max(...values, propLine, sport === 'football' ? 2 : 4);
    const maxScale = Math.max(sport === 'football' ? 3 : 5, Math.ceil(maxRaw * 1.15));
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
  }, [sport, chartLogs, fbMetric, metricCfg, propLine, targetSide]);

  const hitRatePct =
    chartLogs.length > 0 ? Math.round((chartStats.hitCount / chartLogs.length) * 100) : 0;
  const lineBottomPct = Math.min(96, Math.max(4, (propLine / chartStats.maxScale) * 100));

  const adjustPropLine = (delta: number) => {
    setPropLine((prev) => Math.max(0.5, Number((prev + delta).toFixed(1))));
  };

  return (
    <ModalDialog
      onClose={onClose}
      ariaLabelledBy="player-modal-title"
      ariaLabel="Ficha del jugador"
      maxWidthCss="42rem"
      borderClass="border border-white/[0.1]"
    >
      {(requestClose) => (
        <div className="flex flex-col flex-1 min-h-0">
        {loading || !player ? (
          <div className="p-10 text-center text-slate-400 text-sm">
            {loading ? 'Cargando ficha del jugador...' : 'No se encontró al jugador.'}
          </div>
        ) : (
          <>
            {/* Hero Header */}
            <div className="shrink-0 relative p-5 border-b border-white/[0.08] bg-[#12151c]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-4">
                  <PlayerAvatar
                    src={player.headshot_url}
                    name={player.full_name}
                    className="w-20 h-20 rounded-xl bg-[#0b0d11] border border-white/[0.12] overflow-hidden shrink-0 flex items-center justify-center"
                    fallbackText={player.jersey_number ? `#${player.jersey_number}` : undefined}
                  />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {player.team?.abbreviation && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-white/[0.08] text-slate-100 border border-white/[0.12]">
                          {player.team.abbreviation}
                        </span>
                      )}
                      <span className="text-xs text-slate-300 font-semibold">
                        #{player.jersey_number ?? '-'} · {player.position ?? 'JUG'}
                      </span>
                    </div>
                    <h2 id="player-modal-title" className="text-xl sm:text-2xl font-bold text-white leading-tight">
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
                  type="button"
                  onClick={requestClose}
                  className="p-1.5 rounded-full bg-white/[0.05] border border-white/[0.1] text-slate-300 hover:text-white"
                  aria-label="Cerrar"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              {average && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3 text-xs text-slate-300">
                    <span className="inline-flex items-center gap-1">
                      <Award className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                      Doble-Dobles: <strong className="text-white">{average.double_doubles}</strong>
                    </span>
                    {average.triple_doubles > 0 && (
                      <span>
                        Triple-Dobles:{' '}
                        <strong className="text-white">{average.triple_doubles}</strong>
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => downloadPlayerStatCard(average)}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg cv-btn-primary"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    Tarjeta PNG
                  </button>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-auto sb-scroller p-4 sm:p-5 space-y-5">
              {sport === 'football' ? (
                fbAverage ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 tabular-nums">
                      {[
                        { label: 'GOLES', value: String(fbAverage.goals) },
                        { label: 'ASIST', value: String(fbAverage.assists) },
                        { label: 'REMATES', value: String(fbAverage.shots) },
                        { label: 'AL ARCO', value: String(fbAverage.shots_on_target) },
                      ].map((st) => (
                        <div
                          key={st.label}
                          className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-2.5 sm:p-3 text-center"
                        >
                          <div className="text-[11px] font-semibold text-slate-400">{st.label}</div>
                          <div className="text-lg sm:text-xl font-bold mt-0.5 text-white">{st.value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3.5">
                      <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
                        Resumen de Temporada ({fbAverage.gp} PJ · {fbAverage.starts} titularidades)
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center tabular-nums">
                        {[
                          { label: 'Gol/PJ', val: Number(fbAverage.goals_pg).toFixed(2) },
                          { label: 'Rem/PJ', val: Number(fbAverage.shots_pg).toFixed(1) },
                          { label: 'Arco/PJ', val: Number(fbAverage.sot_pg).toFixed(2) },
                          { label: 'Atajadas', val: String(fbAverage.saves) },
                          { label: 'TA / TR', val: `${fbAverage.yellow_cards}/${fbAverage.red_cards}` },
                        ].map((m) => (
                          <div key={m.label}>
                            <div className="text-[11px] text-slate-400">{m.label}</div>
                            <div className="text-sm font-bold text-slate-100 mt-0.5">{m.val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 text-center text-xs text-slate-400">
                    Este jugador aún no registra participaciones en la temporada actual.
                  </div>
                )
              ) : average ? (
                <>
                  {/* Main Averages Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 tabular-nums">
                    {[
                      { label: 'PPG', value: Number(average.ppg ?? 0).toFixed(1) },
                      { label: 'RPG', value: Number(average.rpg ?? 0).toFixed(1) },
                      { label: 'APG', value: Number(average.apg ?? 0).toFixed(1) },
                      { label: 'MPG', value: Number(average.mpg ?? 0).toFixed(1) },
                    ].map((st) => (
                      <div
                        key={st.label}
                        className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-2.5 sm:p-3 text-center"
                      >
                        <div className="text-[11px] font-semibold text-slate-400">{st.label}</div>
                        <div className="text-lg sm:text-xl font-bold mt-0.5 text-white">
                          {st.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Shooting & Advanced Metrics */}
                  <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3.5">
                    <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5">
                      Eficiencia de Tiro y Métricas Avanzadas ({average.gp} PJ)
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center tabular-nums">
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
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-4 text-center text-xs text-slate-400">
                  Este jugador aún no registra partidos finalizados en la temporada actual.
                </div>
              )}

              {/* Suggested Props for this Player */}
              {playerProps.length > 0 && (
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-200">
                        <Target className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                        Mercados Analizados del Jugador
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Toca un mercado para graficarlo abajo · Ordenado por índice.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPropsOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#12151c] border border-white/[0.1] text-slate-200 hover:border-white/[0.2] transition-colors"
                    >
                      <ArrowUpDown className="w-3 h-3 text-slate-400" aria-hidden="true" />
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
                          className={`w-full text-left rounded-lg p-2.5 border transition-colors ${
                            isSelected
                              ? 'bg-[#181c25] border-blue-400/60'
                              : 'bg-[#12151c] border-white/[0.08] hover:border-white/[0.18]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
                                  prop.strategy === 'safe'
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                }`}
                              >
                                {prop.strategy === 'safe' ? 'Segura' : 'Valor'}
                              </span>
                              <span className="text-xs font-semibold text-white truncate">{prop.marketLabel}</span>
                            </div>
                            <div className="flex items-center gap-2 tabular-nums">
                              {!locked && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-300 border border-white/[0.08]">
                                  {prop.estimatedMultiplier.toFixed(2)}x
                                </span>
                              )}
                              {locked ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded sb-pro-pill">
                                  <Lock className="w-3 h-3" aria-hidden="true" />
                                  Plan Pro
                                </span>
                              ) : (
                                <span
                                  className={`text-[11px] font-bold px-2 py-0.5 rounded border ${badgeCls}`}
                                >
                                  {prop.pickLabel}
                                </span>
                              )}
                              <span className="text-xs font-bold text-slate-100">
                                {prop.confidence}%
                              </span>
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
                            <span>{locked ? 'Análisis avanzado reservado para Plan Pro.' : prop.statSummary}</span>
                            <span className="text-slate-300 font-medium">
                              {locked ? 'Ver Plan Pro' : `${prop.marketLineText} · ${prop.confidenceTier}`}
                            </span>
                          </div>
                          {!locked && prop.contextBadges.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {prop.contextBadges.map((b, idx) => (
                                <span
                                  key={`${b.label}_${idx}`}
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-300 border border-white/[0.08] tabular-nums"
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
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-3.5 space-y-3">
                  {/* Title + Metric Selector */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-200 uppercase tracking-wider">
                      <TrendingUp className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                      {sport === 'football' ? fbMetricCfg.label : metricCfg.label} · Últimos{' '}
                      {chartLogs.length} PJ
                    </span>

                    <div className="flex items-center gap-1 bg-[#12151c] p-1 rounded-lg border border-white/[0.08]">
                      {sport === 'football'
                        ? FOOTBALL_METRICS.map((cfg) => {
                            const active = fbMetric === cfg.key;
                            return (
                              <button
                                key={cfg.key}
                                type="button"
                                onClick={() => setFbMetric(cfg.key)}
                                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                                  active
                                    ? 'cv-tab-active'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {cfg.short}
                              </button>
                            );
                          })
                        : METRIC_ORDER.map((mKey) => {
                            const cfg = PLAYER_CHART_METRICS[mKey];
                            const active = chartMetric === mKey;
                            return (
                              <button
                                key={mKey}
                                type="button"
                                onClick={() => setChartMetric(mKey)}
                                className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                                  active
                                    ? 'cv-tab-active'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {cfg.short}
                              </button>
                            );
                          })}
                    </div>
                  </div>

                  {/* Interactive O/U Line & Hit Rate */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#12151c] border border-white/[0.08] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-slate-400">
                        Línea de referencia:
                      </span>
                      <div className="inline-flex items-center rounded-lg border border-white/[0.12] bg-[#0b0d11] overflow-hidden tabular-nums">
                        <button
                          type="button"
                          onClick={() => adjustPropLine(-0.5)}
                          className="p-1.5 text-slate-300 hover:bg-white/[0.06]"
                          aria-label="Bajar línea 0.5"
                        >
                          <Minus className="w-3 h-3" aria-hidden="true" />
                        </button>
                        <span className="px-2.5 text-xs font-bold text-white">
                          {propLine.toFixed(1)}
                        </span>
                        <button
                          type="button"
                          onClick={() => adjustPropLine(0.5)}
                          className="p-1.5 text-slate-300 hover:bg-white/[0.06]"
                          aria-label="Subir línea 0.5"
                        >
                          <Plus className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                      {Math.abs(propLine - defaultLineForMetric) > 0.01 && (
                        <button
                          type="button"
                          onClick={() => setPropLine(defaultLineForMetric)}
                          className="text-[11px] inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
                          title="Volver a línea sugerida"
                        >
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                          Prom.
                        </button>
                      )}
                      <div className="inline-flex rounded-lg bg-[#0b0d11] border border-white/[0.1] p-0.5 text-[10px]">
                        {(['OVER', 'UNDER'] as const).map((side) => (
                          <button
                            key={side}
                            type="button"
                            onClick={() => setTargetSide(side)}
                            className={`px-2 py-0.5 rounded font-semibold transition-colors ${
                              targetSide === side
                                ? 'cv-tab-active'
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
                        className={`font-semibold px-2 py-0.5 rounded ${
                          hitRatePct >= 60
                            ? 'bg-emerald-500/12 text-emerald-300'
                            : hitRatePct <= 40
                              ? 'bg-rose-500/12 text-rose-300'
                              : 'bg-white/[0.06] text-slate-200'
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

                  {/* Bar Chart with Dashed Reference Line */}
                  <div className="relative pt-5 pb-1">
                    <div className="relative flex items-end gap-1 sm:gap-1.5 h-32">
                      {/* Dashed Reference Line */}
                      <div
                        className="absolute left-0 right-0 border-t border-dashed border-slate-400/75 pointer-events-none z-10 flex justify-end"
                        style={{ bottom: `${lineBottomPct}%` }}
                      >
                        <span className="-translate-y-4 text-[10px] font-semibold px-1.5 rounded bg-[#12151c] text-slate-200 border border-white/[0.15] tabular-nums">
                          {propLine.toFixed(1)}
                        </span>
                      </div>

                      {chartLogs.map((g, idx) => {
                        const val =
                          sport === 'football'
                            ? getFootballPlayerStatValue(g, fbMetric)
                            : metricCfg.getStatValue(g);
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
                              className={`text-[10px] font-semibold mb-1 tabular-nums ${
                                isHit ? 'text-emerald-300' : 'text-rose-300'
                              }`}
                            >
                              {val}
                            </span>
                            <div
                              className={`w-full max-w-[26px] rounded-t transition-colors ${
                                isFocused ? 'ring-2 ring-white/80' : ''
                              } ${
                                isHit
                                  ? 'bg-emerald-500/80'
                                  : 'bg-rose-500/70'
                              }`}
                              style={{ height: `${pct}%` }}
                            />
                            <span className="mt-1 text-[9px] text-slate-400 font-medium truncate max-w-full">
                              {opp ?? '-'}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80 inline-block" />
                          Cumple ({targetSide} {propLine.toFixed(1)})
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/70 inline-block" />
                          No cumple
                        </span>
                      </div>
                      <span className="tabular-nums">
                        Mín: <strong className="text-slate-200">{chartStats.minVal}</strong> · Máx:{' '}
                        <strong className="text-slate-200">{chartStats.maxVal}</strong>
                      </span>
                    </div>

                    {selectedBarIdx !== null && chartLogs[selectedBarIdx] && (
                      <div className="mt-2 rounded-lg bg-[#12151c] border border-white/[0.1] px-3 py-1.5 text-[11px] text-slate-200 flex items-center justify-between tabular-nums">
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
                        <span className="font-semibold">
                          {sport === 'football'
                            ? `${chartLogs[selectedBarIdx].sport_stats?.goals ?? 0}G · ${chartLogs[selectedBarIdx].sport_stats?.assists ?? 0}A · ${chartLogs[selectedBarIdx].sport_stats?.shots ?? 0} REM (${chartLogs[selectedBarIdx].sport_stats?.shots_on_target ?? 0} arco)`
                            : `${chartLogs[selectedBarIdx].pts} PTS · ${chartLogs[selectedBarIdx].reb} REB · ${chartLogs[selectedBarIdx].ast} AST · ${chartLogs[selectedBarIdx].tpm} 3P`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Recent Game Log */}
              {logs.length > 0 && (
                <div>
                  <h3 id="player-recent-log-heading" className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                    Últimos Partidos
                  </h3>
                  <div
                    tabIndex={0}
                    role="region"
                    aria-labelledby="player-recent-log-heading"
                    className="overflow-x-auto sb-scroller rounded-xl border border-white/[0.08]"
                  >
                    <table className="w-full text-xs tabular-nums whitespace-nowrap">
                      <thead className="bg-[#0e1117] text-slate-400">
                        {sport === 'football' ? (
                          <tr>
                            <th scope="col" className="text-left py-2 px-3">FECHA</th>
                            <th scope="col" className="text-left py-2 px-2">RIVAL</th>
                            <th scope="col" className="text-center py-2 px-2">ROL</th>
                            <th scope="col" className="text-right py-2 px-2">G</th>
                            <th scope="col" className="text-right py-2 px-2">A</th>
                            <th scope="col" className="text-right py-2 px-2">REM</th>
                            <th scope="col" className="text-right py-2 px-2">ARCO</th>
                            <th scope="col" className="text-right py-2 px-2">TA</th>
                            <th scope="col" className="text-center py-2 px-2">ESTADO</th>
                          </tr>
                        ) : (
                          <tr>
                            <th scope="col" className="text-left py-2 px-3">FECHA</th>
                            <th scope="col" className="text-left py-2 px-2">RIVAL</th>
                            <th scope="col" className="text-right py-2 px-2">MIN</th>
                            <th
                              scope="col"
                              className={`text-right py-2 px-2 ${
                                chartMetric === 'pts' ? 'text-white' : ''
                              }`}
                            >
                              PTS
                            </th>
                            <th
                              scope="col"
                              className={`text-right py-2 px-2 ${
                                chartMetric === 'reb' ? 'text-white' : ''
                              }`}
                            >
                              REB
                            </th>
                            <th
                              scope="col"
                              className={`text-right py-2 px-2 ${
                                chartMetric === 'ast' ? 'text-white' : ''
                              }`}
                            >
                              AST
                            </th>
                            <th scope="col" className="text-right py-2 px-2">TC</th>
                            <th
                              scope="col"
                              className={`text-right py-2 px-2 ${
                                chartMetric === 'tpm' ? 'text-white' : ''
                              }`}
                            >
                              3P
                            </th>
                            <th scope="col" className="text-center py-2 px-2">ESTADO</th>
                          </tr>
                        )}
                      </thead>
                      <tbody className="divide-y divide-white/[0.06]">
                        {logs.map((row) => {
                          const isHome = row.game?.home_team_id === row.team_id;
                          const opp = isHome
                            ? row.game?.away_team?.abbreviation
                            : row.game?.home_team?.abbreviation;
                          const metricVal =
                            sport === 'football'
                              ? getFootballPlayerStatValue(row, fbMetric)
                              : metricCfg.getStatValue(row);
                          const isHit =
                            targetSide === 'OVER' ? metricVal > propLine : metricVal < propLine;
                          if (sport === 'football') {
                            const ss = row.sport_stats;
                            return (
                              <tr key={row.id} className="hover:bg-white/[0.03]">
                                <td className="py-2 px-3 text-slate-400">
                                  {row.game?.game_date?.slice(5) ?? '-'}
                                </td>
                                <td className="py-2 px-2 font-semibold text-slate-200">
                                  {isHome ? 'vs' : '@'} {opp ?? 'EPL'}
                                </td>
                                <td className="text-center py-2 px-2 text-slate-400">
                                  {row.starter ? 'TIT' : 'SUP'}
                                </td>
                                <td className="text-right py-2 px-2 font-bold text-white">
                                  {ss?.goals ?? row.pts ?? 0}
                                </td>
                                <td className="text-right py-2 px-2 text-slate-300">
                                  {ss?.assists ?? row.ast ?? 0}
                                </td>
                                <td className="text-right py-2 px-2 text-slate-200">
                                  {ss?.shots ?? 0}
                                </td>
                                <td className="text-right py-2 px-2 text-slate-300">
                                  {ss?.shots_on_target ?? 0}
                                </td>
                                <td className="text-right py-2 px-2 text-slate-400">
                                  {ss?.yellow_cards ?? 0}
                                </td>
                                <td className="text-center py-2 px-2">
                                  <span
                                    className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                      isHit
                                        ? 'bg-emerald-500/12 text-emerald-300'
                                        : 'bg-rose-500/12 text-rose-300'
                                    }`}
                                  >
                                    {isHit ? 'Cumple' : 'No cumple'}
                                  </span>
                                </td>
                              </tr>
                            );
                          }
                          return (
                            <tr key={row.id} className="hover:bg-white/[0.03]">
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
                                    ? 'font-bold text-white'
                                    : 'font-medium text-slate-200'
                                }`}
                              >
                                {row.pts}
                              </td>
                              <td
                                className={`text-right py-2 px-2 ${
                                  chartMetric === 'reb'
                                    ? 'font-bold text-white'
                                    : 'text-slate-300'
                                }`}
                              >
                                {row.reb}
                              </td>
                              <td
                                className={`text-right py-2 px-2 ${
                                  chartMetric === 'ast'
                                    ? 'font-bold text-white'
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
                                  className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                    isHit
                                      ? 'bg-emerald-500/12 text-emerald-300'
                                      : 'bg-rose-500/12 text-rose-300'
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
      )}
    </ModalDialog>
  );
}
