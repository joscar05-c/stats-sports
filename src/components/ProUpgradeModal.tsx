import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  CreditCard,
  ExternalLink,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  CHECKOUT_URLS,
  clearPendingCheckoutEmail,
  clearProSubscription,
  getPendingCheckoutEmail,
  getRemainingProDays,
  PRO_MONTHLY_PRICE_USD,
  setPendingCheckoutEmail,
  verifyProSubscriptionByEmailOrCode,
  type PaymentProvider,
  type ProSubscriptionState,
} from '../services/subscriptionService';
import { supabase } from '../lib/supabase';
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
    label: 'Lemon Squeezy ($5 USD/mes)',
    subtitle: 'Tarjeta / Apple Pay / Google Pay · Verificación automática por webhook',
  },
  {
    key: 'stripe',
    label: 'Stripe ($5 USD/mes)',
    subtitle: 'Tarjeta internacional · Checkout directo',
  },
  {
    key: 'mercadopago',
    label: 'Mercado Pago / Yape',
    subtitle: 'Pago único por 30 días en moneda local · LATAM / Perú',
  },
];

export function ProUpgradeModal({
  subscription,
  onClose,
  onActivated,
  onDeactivated,
}: ProUpgradeModalProps) {
  const [provider, setProvider] = useState<PaymentProvider>('lemonsqueezy');
  const [email, setEmail] = useState(() => subscription?.email ?? getPendingCheckoutEmail() ?? '');
  const [recoverInput, setRecoverInput] = useState('');
  const [mode, setMode] = useState<'buy' | 'recover'>('buy');
  const [awaitingWebhook, setAwaitingWebhook] = useState(() => Boolean(!subscription && getPendingCheckoutEmail()));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const remainingDays = getRemainingProDays(subscription);
  const checkoutUrl = CHECKOUT_URLS[provider];

  // Live auto-unlock listener while waiting for Lemon Squeezy webhook confirmation (zero F5 needed)
  useEffect(() => {
    if (subscription || !awaitingWebhook) return;
    const lookup = (email || getPendingCheckoutEmail() || '').trim().toLowerCase();
    if (!lookup) return;

    let active = true;
    const pollVerify = async () => {
      const found = await verifyProSubscriptionByEmailOrCode(lookup);
      if (active && found) {
        setAwaitingWebhook(false);
        onActivated(found);
      }
    };

    void pollVerify();
    const timer = window.setInterval(pollVerify, 3000);
    window.addEventListener('focus', pollVerify);

    const channel = supabase
      .channel('pro_unlock_modal')
      .on('broadcast', { event: 'pro_updated' }, () => {
        void pollVerify();
      })
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', pollVerify);
      supabase.removeChannel(channel);
    };
  }, [subscription, awaitingWebhook, email, onActivated]);

  const handleOpenCheckout = () => {
    setFeedback(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFeedback('Ingresa el correo con el que pagarás para vincular tu pase mensual.');
      return;
    }

    if (!checkoutUrl) {
      setFeedback(
        'Falta configurar el enlace de pago de esta pasarela en el entorno (VITE_LEMONSQUEEZY_CHECKOUT_URL).',
      );
      return;
    }

    setPendingCheckoutEmail(cleanEmail);
    setAwaitingWebhook(true);

    const sep = checkoutUrl.includes('?') ? '&' : '?';
    const url = `${checkoutUrl}${sep}checkout[email]=${encodeURIComponent(
      cleanEmail,
    )}&checkout[custom][email]=${encodeURIComponent(cleanEmail)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setFeedback(
      'Se abrió la pasarela en una nueva pestaña. Apenas completes el pago, el sistema desbloqueará PRO automáticamente aquí.',
    );
  };

  const handleManualCheckAfterPay = async () => {
    const cleanEmail = (email || getPendingCheckoutEmail() || '').trim();
    if (!cleanEmail) return;
    setBusy(true);
    setFeedback(null);
    try {
      const found = await verifyProSubscriptionByEmailOrCode(cleanEmail);
      if (found) {
        setAwaitingWebhook(false);
        onActivated(found);
      } else {
        setFeedback(
          'Aún no llega la confirmación del pago para ese correo. Revisa si usaste otro correo al pagar o espera unos segundos.',
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRecover = async () => {
    setFeedback(null);
    if (!recoverInput.trim()) {
      setFeedback('Ingresa el correo con el que pagaste o tu código CVPRO-XXXX-XXXX.');
      return;
    }
    setBusy(true);
    try {
      const found = await verifyProSubscriptionByEmailOrCode(recoverInput);
      if (found) {
        onActivated(found);
      } else {
        setFeedback(
          'No encontramos una suscripción activa con ese correo o código. Si acabas de pagar, espera unos segundos y vuelve a intentar.',
        );
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
              CourtVision PRO · Suscripción Mensual
            </div>
            <h2 className="text-xl font-bold text-white mt-1">
              {subscription
                ? 'Suscripción PRO Activa'
                : `Desbloquea Props ${PRO_CONFIDENCE_THRESHOLD}%+ por $${PRO_MONTHLY_PRICE_USD.toFixed(0)}/mes`}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Acceso por 30 días a los props más probables. Los props menores a {PRO_CONFIDENCE_THRESHOLD}% siguen gratis.
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
                    Suscripción Verificada
                    {subscription.testMode ? ' (Test Mode)' : ''}
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
                  Vigente hasta el{' '}
                  <strong className="text-slate-200">
                    {new Date(subscription.expiresAt).toLocaleDateString('es-PE')}
                  </strong>{' '}
                  · Sincronizado con Supabase Webhook
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
                Cerrar sesión PRO en este navegador (Vista Gratis)
              </button>
            </div>
          ) : (
            <>
              {/* Plan Summary */}
              <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-4 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-slate-200">Suscripción Mensual · 30 Días</div>
                  <div className="text-[11px] text-slate-400">
                    Validación automática mediante webhook seguro de Lemon Squeezy.
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
                  Ya pagué / Recuperar
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
                        const configured = Boolean(CHECKOUT_URLS[pv.key]);
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
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold">{pv.label}</span>
                              <div className="flex items-center gap-2">
                                {!configured && (
                                  <span className="text-[10px] text-slate-500">Sin enlace</span>
                                )}
                                <span
                                  className={`w-3 h-3 rounded-full border ${
                                    selected
                                      ? 'bg-emerald-400 border-emerald-400'
                                      : 'border-slate-600'
                                  }`}
                                />
                              </div>
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">{pv.subtitle}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Tu correo (debe coincidir con el del checkout)
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
                    disabled={busy || !checkoutUrl}
                    onClick={handleOpenCheckout}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-white text-slate-950 font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                  >
                    <CreditCard className="w-4 h-4" />
                    {checkoutUrl
                      ? `Ir a Pagar $5.00 USD (${PROVIDERS.find((p) => p.key === provider)?.label.split(' ')[0]})`
                      : 'Configura enlace de esta pasarela'}
                    {checkoutUrl && <ExternalLink className="w-3.5 h-3.5" />}
                  </button>

                  {awaitingWebhook && (
                    <div className="rounded-xl bg-slate-900 border border-slate-700 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-200">
                        <span className="inline-flex items-center gap-2 font-semibold">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                          Esperando confirmación del pago...
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            clearPendingCheckoutEmail();
                            setAwaitingWebhook(false);
                          }}
                          className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                        >
                          Cancelar
                        </button>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleManualCheckAfterPay}
                        className="w-full py-1.5 px-3 rounded-lg bg-slate-950 border border-slate-700 hover:border-slate-500 text-[11px] font-semibold text-slate-200 transition-colors"
                      >
                        {busy ? 'Consultando...' : 'Ya completé el pago · Verificar ahora'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Correo con el que pagaste o Código CVPRO-XXXX-XXXX
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
                    {busy ? 'Verificando con Supabase...' : 'Validar Acceso PRO'}
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
