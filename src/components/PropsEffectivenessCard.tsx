import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { isHighProbabilityProp, type GamePropsEffectivenessSummary } from '../utils/betting';

export type PropResultFilter = 'all' | 'won' | 'lost';

interface PropsEffectivenessCardProps {
  summary: GamePropsEffectivenessSummary;
  variant?: 'full' | 'compact';
  isPro?: boolean;
  resultFilter: PropResultFilter;
  onChangeResultFilter: (filter: PropResultFilter) => void;
}

export function PropsEffectivenessCard({
  summary,
  variant = 'full',
  isPro = true,
  resultFilter,
  onChangeResultFilter,
}: PropsEffectivenessCardProps) {
  const {
    wonCount,
    lostCount,
    pushCount,
    dnpCount,
    evaluatedCount,
    effectivenessPct,
    teamWon,
    teamEvaluated,
    teamEffectivenessPct,
    playerWon,
    playerEvaluated,
    playerEffectivenessPct,
    wonEntries,
    lostEntries,
  } = summary;

  if (evaluatedCount === 0 && pushCount === 0 && dnpCount === 0) {
    return null;
  }

  const pct = effectivenessPct ?? 0;
  const toneColor =
    effectivenessPct == null
      ? 'text-slate-300'
      : pct >= 60
        ? 'text-emerald-300'
        : pct >= 45
          ? 'text-amber-300'
          : 'text-rose-300';

  const fillCss =
    effectivenessPct == null
      ? '#94a3b8'
      : pct >= 60
        ? '#34d399'
        : pct >= 45
          ? '#fbbf24'
          : '#fb7185';

  const neutralCount = pushCount + dnpCount;
  const visibleWonPreview = wonEntries.filter(
    (e) => isPro || !isHighProbabilityProp(e.prop.confidence),
  );
  const visibleLostPreview = lostEntries.filter(
    (e) => isPro || !isHighProbabilityProp(e.prop.confidence),
  );
  const hiddenWonCount = wonEntries.length - visibleWonPreview.length;
  const hiddenLostCount = lostEntries.length - visibleLostPreview.length;

  return (
    <section
      aria-label="Efectividad de props del partido"
      className={`rounded-xl bg-[#0e1117] border border-white/[0.1] ${
        variant === 'compact' ? 'p-2.5 space-y-2' : 'p-4 space-y-3'
      }`}
    >
      {/* Top KPI header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
            Efectividad post-partido
          </div>
          <div className="text-[11px] text-slate-400 tabular-nums">
            {evaluatedCount > 0
              ? `${wonCount} de ${evaluatedCount} props acertadas`
              : 'Solo empates o jugadores sin participación'}
          </div>
        </div>

        <div className={`text-right shrink-0 tabular-nums ${toneColor}`}>
          <div className={variant === 'compact' ? 'text-lg font-extrabold leading-none' : 'text-2xl font-extrabold leading-none'}>
            {effectivenessPct != null ? `${effectivenessPct}%` : '-'}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Efectividad</div>
        </div>
      </div>

      {/* Semantic native progress bar */}
      {evaluatedCount > 0 && (
        <progress
          className="cv-eff-progress"
          max={evaluatedCount}
          value={wonCount}
          aria-label={`Efectividad del partido: ${pct}% (${wonCount} de ${evaluatedCount})`}
          style={{ '--cv-eff-fill': fillCss } as React.CSSProperties}
        />
      )}

      {/* Counts row */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/12 text-emerald-300 border border-emerald-500/25 font-semibold">
          <CheckCircle2 className="w-3 h-3 shrink-0" aria-hidden="true" />
          Salieron: {wonCount}
        </span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/12 text-rose-300 border border-rose-500/25 font-semibold">
          <XCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
          No salieron: {lostCount}
        </span>
        {neutralCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.05] text-slate-300 border border-white/[0.08] font-medium">
            <MinusCircle className="w-3 h-3 shrink-0" aria-hidden="true" />
            Empate/DNP: {neutralCount}
          </span>
        )}
      </div>

      {/* Scope breakdown + Hit/Miss recap (full view) */}
      {variant === 'full' && (
        <>
          {(teamEvaluated > 0 || playerEvaluated > 0) && (
            <div className="grid grid-cols-2 gap-2 text-[11px] tabular-nums pt-0.5">
              <div className="rounded-lg bg-[#12151c] border border-white/[0.07] px-2.5 py-1.5 flex items-center justify-between gap-2">
                <span className="text-slate-400">Equipos</span>
                <span className="font-semibold text-slate-100">
                  {teamEvaluated > 0
                    ? `${teamWon}/${teamEvaluated} (${teamEffectivenessPct}%)`
                    : '—'}
                </span>
              </div>
              <div className="rounded-lg bg-[#12151c] border border-white/[0.07] px-2.5 py-1.5 flex items-center justify-between gap-2">
                <span className="text-slate-400">Jugadores</span>
                <span className="font-semibold text-slate-100">
                  {playerEvaluated > 0
                    ? `${playerWon}/${playerEvaluated} (${playerEffectivenessPct}%)`
                    : '—'}
                </span>
              </div>
            </div>
          )}

          {(wonEntries.length > 0 || lostEntries.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
              <div className="rounded-lg bg-emerald-500/[0.05] border border-emerald-500/20 p-2.5 space-y-1.5">
                <div className="text-[11px] font-bold text-emerald-300 uppercase tracking-wide">
                  Lo que salió ({wonEntries.length})
                </div>
                {wonEntries.length === 0 ? (
                  <div className="text-[11px] text-slate-400">Sin aciertos registrados.</div>
                ) : (
                  <ul className="space-y-1 text-[11px]">
                    {visibleWonPreview.slice(0, 4).map(({ prop, status }) => (
                      <li
                        key={prop.id}
                        className="flex items-center justify-between gap-2 text-slate-200"
                      >
                        <span className="truncate">
                          {prop.subjectName} · {prop.pickLabel}
                        </span>
                        <span className="text-emerald-300 font-semibold shrink-0 tabular-nums">
                          {status?.label}
                        </span>
                      </li>
                    ))}
                    {visibleWonPreview.length > 4 && (
                      <li className="text-[10px] text-slate-400">
                        +{visibleWonPreview.length - 4} más acertadas
                      </li>
                    )}
                    {hiddenWonCount > 0 && (
                      <li className="text-[10px] text-slate-400">
                        +{hiddenWonCount} prop(s) Pro acertadas
                      </li>
                    )}
                  </ul>
                )}
              </div>

              <div className="rounded-lg bg-rose-500/[0.05] border border-rose-500/20 p-2.5 space-y-1.5">
                <div className="text-[11px] font-bold text-rose-300 uppercase tracking-wide">
                  Lo que no salió ({lostEntries.length})
                </div>
                {lostEntries.length === 0 ? (
                  <div className="text-[11px] text-slate-400">Sin fallos registrados.</div>
                ) : (
                  <ul className="space-y-1 text-[11px]">
                    {visibleLostPreview.slice(0, 4).map(({ prop, status }) => (
                      <li
                        key={prop.id}
                        className="flex items-center justify-between gap-2 text-slate-200"
                      >
                        <span className="truncate">
                          {prop.subjectName} · {prop.pickLabel}
                        </span>
                        <span className="text-rose-300 font-semibold shrink-0 tabular-nums">
                          {status?.label}
                        </span>
                      </li>
                    ))}
                    {visibleLostPreview.length > 4 && (
                      <li className="text-[10px] text-slate-400">
                        +{visibleLostPreview.length - 4} más falladas
                      </li>
                    )}
                    {hiddenLostCount > 0 && (
                      <li className="text-[10px] text-slate-400">
                        +{hiddenLostCount} prop(s) Pro falladas
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Result filter tabs */}
      <div
        role="tablist"
        aria-label="Filtrar props por resultado"
        className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-0.5"
      >
        {(
          [
            { key: 'all', label: `Todas (${summary.totalProps})` },
            { key: 'won', label: `Salieron (${wonCount})` },
            { key: 'lost', label: `No salieron (${lostCount})` },
          ] as const
        ).map((tab) => {
          const active = resultFilter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChangeResultFilter(tab.key)}
              className={`shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold border transition-colors ${
                active
                  ? 'cv-tab-active border-transparent'
                  : 'bg-[#12151c] text-slate-300 border-white/[0.08] hover:text-white hover:border-white/[0.18]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
