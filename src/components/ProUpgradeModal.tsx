import { useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  activateProSubscription,
  CHECKOUT_URLS,
  clearProSubscription,
  getRemainingProDays,
  PRO_MONTHLY_PRICE_USD,
  verifyProSubscriptionByEmailOrCode,
  type PaymentProvider,
  type ProSubscriptionState,
} from '../services/subscriptionService';
import { PRO_CONFIDENCE_THRESHOLD } from '../utils/betting';

interface ProUpgradeModalProps {
  subscription: ProSubscriptionState | null;
  onClose: () => void;
  onActivated: (sub: ProSubscriptionState) => void;
  onDeactivated: () => void;
}

const PROVIDERS: Array<{
  key: PaymentProvider;
  label: string;
  subtitle: string;
}> = [
  {
    key: 'lemonsqueezy',
    label: 'Lemon Squeezy ($5 USD)',
    subtitle: 'Tarjeta / Apple Pay / Google Pay · $0 costo fijo mensual · Sin LLC',
  },
  {
    key: 'stripe',
    label: 'Stripe ($5 USD)',
    subtitle: 'Tarjeta internacional · Checkout directo · $0 costo fijo mensual',
  },
  {
    key: 'mercadopago',
    label: 'Mercado Pago / Yape',
    subtitle: 'Pago único por 30 días en moneda local · Ideal LATAM / Perú',
  },
];

export function ProUpgradeModal({
  subscription,
  onClose,
  onActivated,
  onDeactivated,
}: ProUpgradeModalProps) {
  const [provider, setProvider] = useState<PaymentProvider>('lemonsqueezy');
  const [email, setEmail] = useState(subscription?.email ?? '');
  const [recoverInput, setRecoverInput] = useState('');
  const [mode, setMode] = useState<'buy' | 'recover'>('buy');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const remainingDays = getRemainingProDays(subscription);
  const checkoutUrl = CHECKOUT_URLS[provider];

  const handleCheckoutOrActivate = async () => {
    setFeedback(null);
    if (!email.trim() || !email.includes('@')) {
      setFeedback('Ingresa un correo válido para asociar tu pase mensual de 30 días.');
      return;
    }

    if (checkoutUrl) {
      const sep = checkoutUrl.includes('?') ? '&' : '?';
      window.open(
        `${checkoutUrl}${sep}checkout[email]=${encodeURIComponent(email.trim())}`,
        '_blank',
        'noopener,noreferrer',
      );
      setFeedback(
        'Se abrió la pasarela de pago en una nueva pestaña. Al completar tu pago, ingresa tu correo o código en "Ya pagué" o activa tu pase.',
      );
      return;
    }

    setBusy(true);
    try {
      const sub = await activateProSubscription(email, provider);
      onActivated(sub);
    } finally {
      setBusy(false);
    }
  };

  const handleDemoActivate = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const sub = await activateProSubscription(email || 'demo@courtvision.app', 'demo');
      onActivated(sub);
    } finally {
      setBusy(false);
    }
  };

  const handleRecover = async () => {
    setFeedback(null);
    if (!recoverInput.trim()) {
      setFeedback('Ingresa tu correo o código CVPRO-XXXX-XXXX.');
      return;
    }
    setBusy(true);
    try {
      const found = await verifyProSubscriptionByEmailOrCode(recoverInput);
      if (found) {
        onActivated(found);
      } else {
        setFeedback('No encontramos un pase mensual activo con ese correo o código.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchToFree = () => {
    clearProSubscription();
    onDeactivated();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[92vh] flex flex-col bg-[#0c121e] border border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-950/70 flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              CourtVision PRO · Acceso Mensual
            </div>
            <h2 className="text-xl font-bold text-white mt-1">
              {subscription ? 'Suscripción PRO Activa' : `Desbloquea Props ${PRO_CONFIDENCE_THRESHOLD}%+ por $${PRO_MONTHLY_PRICE_USD.toFixed(0)}/mes`}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Pago único por 30 días. Los props menores a {PRO_CONFIDENCE_THRESHOLD}% siempre son gratis.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {subscription ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-900/90 border border-slate-700/80 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    Pase Mensual Activo
                  </span>
                  <span className="text-xs font-bold text-slate-200 tabular-nums">
                    {remainingDays} días restantes
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-800">
                  <div>
                    <div className="text-slate-500 text-[11px]">Correo</div>
                    <div className="text-slate-100 font-semibold truncate">{subscription.email}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 text-[11px]">Código de Acceso</div>
                    <div className="text-slate-100 font-mono font-bold">
                      {subscription.accessCode}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">
                  Vence el{' '}
                  <strong className="text-slate-200">
                    {new Date(subscription.expiresAt).toLocaleDateString('es-PE')}
                  </strong>{' '}
                  · Estado en nube: {subscription.syncedToCloud ? 'Sincronizado en Supabase' : 'Local'}
                </div>
              </div>

              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3.5 text-xs text-slate-300 space-y-1.5">
                <div className="font-bold text-slate-100">Beneficios activos:</div>
                <div>• Todos los Props de Equipo y Jugador con confianza {PRO_CONFIDENCE_THRESHOLD}%–94%.</div>
                <div>• Simulador de líneas interactivo y diagnóstico completo de accesibilidad.</div>
                <div>• Historial de últimos partidos con cumplimiento en verde/rojo en tiempo real.</div>
              </div>

              <button
                type="button"
                onClick={handleSwitchToFree}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors"
              >
                <EyeOff className="w-4 h-4 text-slate-400" />
                Cambiar a Vista Gratis (Probar bloqueo de Props {PRO_CONFIDENCE_THRESHOLD}%+)
              </button>
            </div>
          ) : (
            <>
              {/* Plan Summary */}
              <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-4 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-200">Pase Mensual Único · 30 Días</div>
                  <div className="text-[11px] text-slate-400">
                    Desbloquea al instante todos los props de alta probabilidad en NBA.
                  </div>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <div className="text-2xl font-black text-white">${PRO_MONTHLY_PRICE_USD.toFixed(0)}</div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold">USD / mes</div>
                </div>
              </div>

              {/* Comparison */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 space-y-1">
                  <div className="font-bold text-slate-300">Plan Gratis</div>
                  <div className="text-[11px] text-slate-400">
                    ✓ Marcadores y box scores en vivo
                  </div>
                  <div className="text-[11px] text-slate-400">
                    ✓ Props con confianza &lt; {PRO_CONFIDENCE_THRESHOLD}%
                  </div>
                </div>
                <div className="rounded-xl bg-slate-900 border border-slate-700 p-3 space-y-1">
                  <div className="font-bold text-white inline-flex items-center gap-1">
                    <Lock className="w-3 h-3 text-emerald-400" />
                    Plan PRO ($5/mes)
                  </div>
                  <div className="text-[11px] text-slate-200">
                    ✓ Todos los Props {PRO_CONFIDENCE_THRESHOLD}%–94% (Alta y Muy Alta)
                  </div>
                  <div className="text-[11px] text-slate-200">
                    ✓ Análisis completo, gráfica y rango accesible
                  </div>
                </div>
              </div>

              {/* Mode Switch: Checkout vs Recover */}
              <div className="flex rounded-xl bg-slate-950 border border-slate-800 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setMode('buy');
                    setFeedback(null);
                  }}
                  className={`flex-1 py-1.5 rounded-lg font-semibold transition-colors ${
                    mode === 'buy' ? 'bg-slate-200 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Suscribirme ($5 USD)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('recover');
                    setFeedback(null);
                  }}
                  className={`flex-1 py-1.5 rounded-lg font-semibold transition-colors ${
                    mode === 'recover'
                      ? 'bg-slate-200 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Ya tengo pase / Recuperar
                </button>
              </div>

              {mode === 'buy' ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Método de pago
                    </label>
                    <div className="space-y-1.5">
                      {PROVIDERS.map((pv) => {
                        const selected = provider === pv.key;
                        return (
                          <button
                            key={pv.key}
                            type="button"
                            onClick={() => setProvider(pv.key)}
                            className={`w-full text-left rounded-xl border p-2.5 transition-colors ${
                              selected
                                ? 'bg-slate-800/90 border-slate-500 text-white'
                                : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold">{pv.label}</span>
                              <span
                                className={`w-3 h-3 rounded-full border ${
                                  selected
                                    ? 'bg-emerald-400 border-emerald-400'
                                    : 'border-slate-600'
                                }`}
                              />
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">{pv.subtitle}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Tu correo (para guardar tu pase de 30 días)
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="correo@ejemplo.com"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-slate-500"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleCheckoutOrActivate}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-white text-slate-950 font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                  >
                    <CreditCard className="w-4 h-4" />
                    {checkoutUrl
                      ? `Ir a Pagar $5.00 USD (${PROVIDERS.find((p) => p.key === provider)?.label.split(' ')[0]})`
                      : busy
                        ? 'Activando pase...'
                        : 'Activar Pase Mensual ($5.00 USD · 30 días)'}
                    {checkoutUrl && <ExternalLink className="w-3.5 h-3.5" />}
                  </button>

                  {checkoutUrl && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleDemoActivate}
                      className="w-full py-2 px-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-600 text-xs font-semibold text-slate-300 transition-colors"
                    >
                      Probar acceso PRO (Modo Demo 30 días)
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Correo o Código de Acceso (ej. CVPRO-XXXX-XXXX)
                    </label>
                    <input
                      type="text"
                      value={recoverInput}
                      onChange={(e) => setRecoverInput(e.target.value)}
                      placeholder="correo@ejemplo.com o CVPRO-..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-slate-500"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRecover}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-white text-slate-950 font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                  >
                    <KeyRound className="w-4 h-4" />
                    {busy ? 'Verificando...' : 'Validar Acceso PRO'}
                  </button>
                </div>
              )}

              {feedback && (
                <div className="rounded-xl bg-slate-900 border border-slate-700 p-3 text-xs text-slate-200">
                  {feedback}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
