import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';
import {
  buildYapePlinWhatsappUrl,
  CHECKOUT_URLS,
  clearPendingCheckoutEmail,
  clearProSubscription,
  getPendingCheckoutEmail,
  getRemainingProDays,
  PRO_MONTHLY_PRICE_PEN,
  PRO_MONTHLY_PRICE_USD,
  setPendingCheckoutEmail,
  submitYapePlinActivationRequest,
  verifyProSubscriptionByEmailOrCode,
  YAPE_PLIN_CONFIG,
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
  badge: string;
  subtitle: string;
}> = [
  {
    key: 'lemonsqueezy',
    label: `Lemon Squeezy ($${PRO_MONTHLY_PRICE_USD.toFixed(0)} USD / mes)`,
    badge: 'Automático',
    subtitle: 'Tarjeta, Apple Pay o Google Pay · Activación instantánea por webhook',
  },
  {
    key: 'yape_plin',
    label: `Yape / Plin Perú (S/ ${PRO_MONTHLY_PRICE_PEN.toFixed(0)} / 30 días)`,
    badge: 'Perú · Sin tarjeta',
    subtitle: 'Transferencia rápida en soles · Registro de operación y código CVPRO',
  },
  {
    key: 'stripe',
    label: `Stripe ($${PRO_MONTHLY_PRICE_USD.toFixed(0)} USD / mes)`,
    badge: 'Tarjeta',
    subtitle: 'Checkout internacional con tarjeta',
  },
  {
    key: 'mercadopago',
    label: 'Mercado Pago',
    badge: 'LATAM',
    subtitle: 'Pago único por 30 días en moneda local',
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
  const [yapeOpCode, setYapeOpCode] = useState('');
  const [yapeSenderName, setYapeSenderName] = useState('');
  const [yapeWhatsappUrl, setYapeWhatsappUrl] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState(false);

  const [recoverInput, setRecoverInput] = useState('');
  const [mode, setMode] = useState<'buy' | 'recover'>('buy');
  const [awaitingWebhook, setAwaitingWebhook] = useState(() =>
    Boolean(!subscription && getPendingCheckoutEmail()),
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'info' | 'ok' | 'err' } | null>(
    null,
  );

  const remainingDays = getRemainingProDays(subscription);
  const checkoutUrl = CHECKOUT_URLS[provider];

  const availableProviders = PROVIDERS.filter(
    (pv) => pv.key === 'lemonsqueezy' || pv.key === 'yape_plin' || Boolean(CHECKOUT_URLS[pv.key]),
  );

  // Live auto-unlock listener while waiting for Lemon Squeezy webhook confirmation
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

  const handleCopyNumber = async () => {
    try {
      await navigator.clipboard.writeText(YAPE_PLIN_CONFIG.number.replace(/\s+/g, ''));
      setCopiedPhone(true);
      window.setTimeout(() => setCopiedPhone(false), 1800);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const handleOpenCheckout = () => {
    setFeedback(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFeedback({
        text: 'Ingresa el correo con el que pagarás para vincular tu pase mensual.',
        tone: 'err',
      });
      return;
    }

    if (!checkoutUrl) {
      setFeedback({
        text: 'Falta configurar el enlace de pago de esta pasarela en el entorno.',
        tone: 'err',
      });
      return;
    }

    setPendingCheckoutEmail(cleanEmail);
    setAwaitingWebhook(true);

    const sep = checkoutUrl.includes('?') ? '&' : '?';
    const url = `${checkoutUrl}${sep}checkout[email]=${encodeURIComponent(
      cleanEmail,
    )}&checkout[custom][email]=${encodeURIComponent(cleanEmail)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setFeedback({
      text: 'Se abrió la pasarela en una nueva pestaña. Apenas completes el pago, el sistema desbloqueará PRO automáticamente aquí.',
      tone: 'ok',
    });
  };

  const handleSubmitYapePlin = async () => {
    setFeedback(null);
    const cleanEmail = email.trim().toLowerCase();
    const cleanOp = yapeOpCode.trim();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFeedback({
        text: 'Ingresa un correo electrónico válido para asignarte tu acceso PRO.',
        tone: 'err',
      });
      return;
    }
    if (cleanOp.length < 4) {
      setFeedback({
        text: 'Ingresa el N° de operación de Yape/Plin (mínimo 4 caracteres) o tu código CVPRO.',
        tone: 'err',
      });
      return;
    }

    setBusy(true);
    try {
      const res = await submitYapePlinActivationRequest(cleanEmail, cleanOp, yapeSenderName);
      setYapeWhatsappUrl(res.whatsappUrl);
      if (res.subscription) {
        onActivated(res.subscription);
        return;
      }
      setFeedback({
        text: res.message,
        tone: res.status === 'approved' ? 'ok' : 'info',
      });
    } finally {
      setBusy(false);
    }
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
        setFeedback({
          text: 'Aún no llega la confirmación del pago para ese correo. Revisa si usaste otro correo al pagar o espera unos segundos.',
          tone: 'info',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRecover = async () => {
    setFeedback(null);
    if (!recoverInput.trim()) {
      setFeedback({
        text: 'Ingresa tu código CVPRO-XXXX-XXXX o el correo con el que pagaste.',
        tone: 'err',
      });
      return;
    }
    setBusy(true);
    try {
      const found = await verifyProSubscriptionByEmailOrCode(recoverInput);
      if (found) {
        onActivated(found);
      } else {
        setFeedback({
          text: 'No encontramos una suscripción activa con ese código o correo. Si pagaste por Yape/Plin, espera la emisión de tu código CVPRO.',
          tone: 'err',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchToFree = () => {
    clearProSubscription();
    onDeactivated();
  };

  const liveWhatsappUrl =
    yapeWhatsappUrl ??
    buildYapePlinWhatsappUrl(
      email || 'usuario@ejemplo.com',
      yapeOpCode || 'YAPE-PENDIENTE',
      yapeSenderName,
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#03050a]/85 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[92vh] flex flex-col bg-[#080d1a] border border-emerald-500/25 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative p-5 border-b border-white/[0.08] bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.16),transparent_65%)] flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              CourtVision PRO · Suscripción Mensual
            </div>
            <h2 className="text-xl font-black text-white mt-1 tracking-tight">
              {subscription
                ? 'Acceso PRO Activo'
                : `Desbloquea Picks ${PRO_CONFIDENCE_THRESHOLD}%+ (${PRO_MONTHLY_PRICE_USD.toFixed(0)} USD / S/ ${PRO_MONTHLY_PRICE_PEN.toFixed(0)})`}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Acceso por 30 días a los props con mayor ventaja (MPG, splits y fatiga B2B).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full bg-white/[0.05] text-slate-400 hover:text-white border border-white/[0.08]"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {subscription ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-emerald-500/[0.07] border border-emerald-500/35 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                    <CheckCircle2 className="w-4 h-4" />
                    Suscripción Verificada
                  </span>
                  <span className="text-xs font-bold text-amber-300 tabular-nums">
                    {remainingDays} días restantes
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-white/[0.08]">
                  <div>
                    <div className="text-slate-400 text-[11px]">Correo</div>
                    <div className="text-slate-100 font-semibold truncate">{subscription.email}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Código CVPRO</div>
                    <div className="text-emerald-300 font-mono font-bold">
                      {subscription.accessCode}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">
                  Vigente hasta el{' '}
                  <strong className="text-slate-200">
                    {new Date(subscription.expiresAt).toLocaleDateString('es-PE')}
                  </strong>{' '}
                  · Método: <span className="uppercase">{subscription.provider}</span>
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3.5 text-xs text-slate-300 space-y-1.5">
                <div className="font-bold text-white inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Beneficios activos:
                </div>
                <div>• Todos los Props de Equipo y Jugador con confianza {PRO_CONFIDENCE_THRESHOLD}%–94%.</div>
                <div>• Motor avanzado con ajuste por Minutos (MPG), Local/Visita y fatiga B2B.</div>
                <div>• Simulador de cuotas, líneas O/U y calculadora de ganancia en S/ y USD.</div>
              </div>

              <button
                type="button"
                onClick={handleSwitchToFree}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-xs font-semibold text-slate-200 transition-colors"
              >
                <EyeOff className="w-4 h-4 text-slate-400" />
                Cerrar sesión PRO en este navegador (Vista Gratis)
              </button>
            </div>
          ) : (
            <>
              {/* Plan Summary */}
              <div className="rounded-xl bg-gradient-to-r from-emerald-500/15 via-cyan-500/10 to-amber-500/15 border border-emerald-500/30 p-4 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-extrabold text-white">Pase Mensual · 30 Días</div>
                  <div className="text-[11px] text-slate-300">
                    Tarjeta internacional automática o Yape / Plin en soles sin tarjeta.
                  </div>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <div className="text-2xl font-black text-emerald-300 leading-none">
                    ${PRO_MONTHLY_PRICE_USD.toFixed(0)}
                    <span className="text-xs font-bold text-amber-300 ml-1.5">
                      / S/ {PRO_MONTHLY_PRICE_PEN.toFixed(0)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase font-semibold mt-1">
                    USD o PEN · 30 días
                  </div>
                </div>
              </div>

              {/* Comparison */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3 space-y-1">
                  <div className="font-bold text-slate-300">Plan Gratis</div>
                  <div className="text-[11px] text-slate-400">
                    ✓ Marcadores, cuotas y box scores
                  </div>
                  <div className="text-[11px] text-slate-400">
                    ✓ Props con confianza &lt; {PRO_CONFIDENCE_THRESHOLD}%
                  </div>
                </div>
                <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-500/35 p-3 space-y-1">
                  <div className="font-bold text-emerald-300 inline-flex items-center gap-1">
                    <Lock className="w-3 h-3 text-amber-400" />
                    Plan PRO
                  </div>
                  <div className="text-[11px] text-slate-100">
                    ✓ Picks élite {PRO_CONFIDENCE_THRESHOLD}%–94% de acierto
                  </div>
                  <div className="text-[11px] text-slate-100">
                    ✓ Simulador de pagos en S/ y USD
                  </div>
                </div>
              </div>

              {/* Mode Switch */}
              <div className="flex rounded-xl bg-black/40 border border-white/[0.08] p-1 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setMode('buy');
                    setFeedback(null);
                  }}
                  className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                    mode === 'buy'
                      ? 'bg-emerald-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Suscribirme ($5 / S/ 19)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('recover');
                    setFeedback(null);
                  }}
                  className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                    mode === 'recover'
                      ? 'bg-emerald-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Ya pagué / Código CVPRO
                </button>
              </div>

              {mode === 'buy' ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Método de pago
                    </label>
                    <div className="space-y-1.5">
                      {availableProviders.map((pv) => {
                        const selected = provider === pv.key;
                        return (
                          <button
                            key={pv.key}
                            type="button"
                            onClick={() => {
                              setProvider(pv.key);
                              setFeedback(null);
                            }}
                            className={`w-full text-left rounded-xl border p-2.5 transition-all ${
                              selected
                                ? 'bg-emerald-500/10 border-emerald-500/50 text-white'
                                : 'bg-white/[0.02] border-white/[0.08] text-slate-300 hover:border-white/20'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold">{pv.label}</span>
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                    pv.key === 'yape_plin'
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                      : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                                  }`}
                                >
                                  {pv.badge}
                                </span>
                              </div>
                              <span
                                className={`w-3.5 h-3.5 rounded-full border ${
                                  selected
                                    ? 'bg-emerald-400 border-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
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

                  {provider === 'yape_plin' ? (
                    <div className="space-y-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/30 p-3.5">
                      <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
                        <div>
                          <div className="inline-flex items-center gap-1.5 text-xs font-extrabold text-amber-300">
                            <Smartphone className="w-4 h-4" />
                            Pago con Yape o Plin · S/ {PRO_MONTHLY_PRICE_PEN.toFixed(2)}
                          </div>
                          <div className="text-[11px] text-slate-300 mt-0.5">
                            Titular: <strong className="text-white">{YAPE_PLIN_CONFIG.holder}</strong>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyNumber}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950/90 border border-amber-500/40 text-xs font-mono font-bold text-amber-200 hover:bg-slate-900"
                        >
                          <span>{YAPE_PLIN_CONFIG.number}</span>
                          {copiedPhone ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-amber-300" />
                          )}
                        </button>
                      </div>

                      <div className="text-[11px] text-slate-300 space-y-1">
                        <div>1. Yapea o Plinea <strong>S/ {PRO_MONTHLY_PRICE_PEN.toFixed(2)}</strong> al número arriba.</div>
                        <div>2. Registra tu correo y <strong>N° de operación</strong> (o pega tu código <code>CVPRO</code> si ya lo recibiste).</div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Tu correo (obligatorio)"
                          className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                        />
                        <input
                          type="text"
                          value={yapeOpCode}
                          onChange={(e) => setYapeOpCode(e.target.value)}
                          placeholder="N° Operación o CVPRO-..."
                          className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl px-3 py-2 text-xs text-white font-mono placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                        />
                      </div>

                      <input
                        type="text"
                        value={yapeSenderName}
                        onChange={(e) => setYapeSenderName(e.target.value)}
                        placeholder="Nombre del titular que yapeó (opcional)"
                        className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                      />

                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleSubmitYapePlin}
                          className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {busy ? 'Registrando...' : 'Registrar Pago / Activar CVPRO'}
                        </button>
                        <a
                          href={liveWhatsappUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2.5 px-3 rounded-xl bg-slate-950/90 hover:bg-slate-900 border border-emerald-500/40 text-emerald-300 font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          <MessageCircle className="w-4 h-4" />
                          WhatsApp
                        </a>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                          Tu correo (debe coincidir con el del checkout)
                        </label>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="correo@ejemplo.com"
                          className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                        />
                      </div>

                      <button
                        type="button"
                        disabled={busy || !checkoutUrl}
                        onClick={handleOpenCheckout}
                        className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-all shadow-[0_6px_20px_rgba(16,185,129,0.28)]"
                      >
                        <CreditCard className="w-4 h-4" />
                        {checkoutUrl
                          ? `Pagar $${PRO_MONTHLY_PRICE_USD.toFixed(2)} USD (${
                              PROVIDERS.find((p) => p.key === provider)?.label.split(' (')[0]
                            })`
                          : 'Configura enlace de esta pasarela'}
                        {checkoutUrl && <ExternalLink className="w-3.5 h-3.5" />}
                      </button>

                      {awaitingWebhook && (
                        <div className="rounded-xl bg-white/[0.04] border border-emerald-500/30 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-200">
                            <span className="inline-flex items-center gap-2 font-semibold">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                              Esperando confirmación del webhook...
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
                            className="w-full py-1.5 px-3 rounded-lg bg-slate-950 border border-white/[0.12] hover:border-emerald-400/50 text-[11px] font-semibold text-slate-200 transition-colors"
                          >
                            {busy ? 'Consultando...' : 'Ya completé el pago · Verificar ahora'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                      Código CVPRO-XXXX-XXXX o Correo verificado
                    </label>
                    <input
                      type="text"
                      value={recoverInput}
                      onChange={(e) => setRecoverInput(e.target.value)}
                      placeholder="CVPRO-XXXX-XXXX o correo@ejemplo.com"
                      className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl px-3 py-2 text-sm text-white font-mono placeholder:font-sans placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRecover}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60 transition-all shadow-[0_6px_20px_rgba(16,185,129,0.28)]"
                  >
                    <KeyRound className="w-4 h-4" />
                    {busy ? 'Verificando acceso...' : 'Validar Acceso PRO'}
                  </button>
                </div>
              )}

              {feedback && (
                <div
                  className={`rounded-xl border p-3 text-xs ${
                    feedback.tone === 'ok'
                      ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-200'
                      : feedback.tone === 'err'
                        ? 'bg-rose-500/10 border-rose-500/35 text-rose-200'
                        : 'bg-amber-500/10 border-amber-500/35 text-amber-200'
                  }`}
                >
                  {feedback.text}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
