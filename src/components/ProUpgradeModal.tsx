import { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import {
  buildYapePlinWhatsappUrl,
  CHECKOUT_URLS,
  claimProAccessCode,
  getRemainingProDays,
  PRO_MONTHLY_PRICE_PEN,
  PRO_MONTHLY_PRICE_USD,
  submitYapePlinActivationRequest,
  syncSubscriptionForUser,
  YAPE_PLIN_CONFIG,
  type PaymentProvider,
  type ProSubscriptionState,
} from '../services/subscriptionService';
import type { UserProfile } from '../services/authService';
import { supabase } from '../lib/supabase';
import { PRO_CONFIDENCE_THRESHOLD } from '../utils/betting';
import { ModalDialog } from './ModalDialog';

interface ProUpgradeModalProps {
  user: UserProfile | null;
  subscription: ProSubscriptionState | null;
  onClose: () => void;
  onRequireAuth: () => void;
  onActivated: (sub: ProSubscriptionState) => void;
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
    subtitle: 'Tarjeta, Apple Pay o Google Pay · Vincula el pago directo a tu cuenta',
  },
  {
    key: 'yape_plin',
    label: `Yape / Plin Perú (S/ ${PRO_MONTHLY_PRICE_PEN.toFixed(0)} / 30 días)`,
    badge: 'Perú · Sin tarjeta',
    subtitle: 'Transferencia rápida en soles · Activa tu cuenta con tu N° de operación',
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
  user,
  subscription,
  onClose,
  onRequireAuth,
  onActivated,
}: ProUpgradeModalProps) {
  const [provider, setProvider] = useState<PaymentProvider>('lemonsqueezy');
  const [yapeOpCode, setYapeOpCode] = useState('');
  const [yapeSenderName, setYapeSenderName] = useState(user?.fullName ?? '');
  const [yapeWhatsappUrl, setYapeWhatsappUrl] = useState<string | null>(null);
  const [copiedPhone, setCopiedPhone] = useState(false);

  const [codeInput, setCodeInput] = useState('');
  const [mode, setMode] = useState<'buy' | 'code'>('buy');
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'info' | 'ok' | 'err' } | null>(
    null,
  );

  const remainingDays = getRemainingProDays(subscription);
  const checkoutUrl = CHECKOUT_URLS[provider];

  const availableProviders = PROVIDERS.filter(
    (pv) => pv.key === 'lemonsqueezy' || pv.key === 'yape_plin' || Boolean(CHECKOUT_URLS[pv.key]),
  );

  useEffect(() => {
    if (user?.fullName && !yapeSenderName) {
      setYapeSenderName(user.fullName);
    }
  }, [user?.fullName, yapeSenderName]);

  // Live auto-unlock listener while waiting for webhook or Yape admin approval
  useEffect(() => {
    if (!user || subscription || !awaitingConfirm) return;

    let active = true;
    const pollVerify = async () => {
      const found = await syncSubscriptionForUser({ id: user.id, email: user.email });
      if (active && found) {
        setAwaitingConfirm(false);
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
  }, [user, subscription, awaitingConfirm, onActivated]);

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
    if (!user) {
      onRequireAuth();
      return;
    }
    setFeedback(null);

    if (!checkoutUrl) {
      setFeedback({
        text: 'Falta configurar el enlace de pago de esta pasarela en el entorno.',
        tone: 'err',
      });
      return;
    }

    setAwaitingConfirm(true);
    const sep = checkoutUrl.includes('?') ? '&' : '?';
    const url = `${checkoutUrl}${sep}checkout[email]=${encodeURIComponent(
      user.email,
    )}&checkout[custom][email]=${encodeURIComponent(
      user.email,
    )}&checkout[custom][user_id]=${encodeURIComponent(user.id)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setFeedback({
      text: `Pasarela abierta para ${user.email}. Apenas completes el pago, tu cuenta se actualizará a PRO automáticamente.`,
      tone: 'ok',
    });
  };

  const handleSubmitYapePlin = async () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    setFeedback(null);
    const cleanOp = yapeOpCode.trim();
    if (cleanOp.length < 4) {
      setFeedback({
        text: 'Ingresa el N° de operación de Yape/Plin (mínimo 4 caracteres) o un código CVPRO.',
        tone: 'err',
      });
      return;
    }

    setBusy(true);
    try {
      const res = await submitYapePlinActivationRequest(
        { id: user.id, email: user.email },
        cleanOp,
        yapeSenderName,
      );
      setYapeWhatsappUrl(res.whatsappUrl);
      if (res.subscription) {
        onActivated(res.subscription);
        return;
      }
      setAwaitingConfirm(true);
      setFeedback({
        text: res.message,
        tone: res.status === 'approved' ? 'ok' : 'info',
      });
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : 'No se pudo registrar el pago.',
        tone: 'err',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleManualCheckAfterPay = async () => {
    if (!user) return;
    setBusy(true);
    setFeedback(null);
    try {
      const found = await syncSubscriptionForUser({ id: user.id, email: user.email });
      if (found) {
        setAwaitingConfirm(false);
        onActivated(found);
      } else {
        setFeedback({
          text: 'Aún no se confirma el pago en tu cuenta. Si pagaste por Yape/Plin, espera la aprobación; si usaste Lemon Squeezy, aguarda unos segundos.',
          tone: 'info',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClaimCode = async () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    setFeedback(null);
    if (!codeInput.trim()) {
      setFeedback({
        text: 'Ingresa tu código CVPRO-XXXX-XXXX para vincularlo a tu cuenta.',
        tone: 'err',
      });
      return;
    }
    setBusy(true);
    try {
      const found = await claimProAccessCode(codeInput, { id: user.id, email: user.email });
      if (found) {
        onActivated(found);
      } else {
        setFeedback({
          text: 'Código no válido, expirado o ya vinculado a otra cuenta.',
          tone: 'err',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const liveWhatsappUrl =
    yapeWhatsappUrl ??
    buildYapePlinWhatsappUrl(
      user?.email || 'cuenta@ejemplo.com',
      yapeOpCode || 'YAPE-PENDIENTE',
      yapeSenderName,
    );

  return (
    <ModalDialog
      onClose={onClose}
      ariaLabelledBy="pro-modal-title"
      maxWidthCss="32rem"
      borderClass="border border-white/[0.12]"
    >
      {(requestClose) => (
        <div className="flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="relative p-5 border-b border-white/[0.08] bg-[#12151c] flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <ShieldCheck className="w-4 h-4 text-slate-300" aria-hidden="true" />
              CourtVision Pro · Suscripción Mensual
            </div>
            <h2 id="pro-modal-title" className="text-xl font-bold text-white mt-1 tracking-tight">
              {subscription
                ? 'Plan Pro activo'
                : `Plan Pro ($${PRO_MONTHLY_PRICE_USD.toFixed(0)} USD / S/ ${PRO_MONTHLY_PRICE_PEN.toFixed(0)})`}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Acceso por 30 días vinculado a tu cuenta en Web y App Móvil.
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="p-1.5 rounded-full bg-white/[0.05] text-slate-400 hover:text-white border border-white/[0.08]"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-auto sb-scroller p-5 space-y-4">
          {subscription ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-500/30 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    Suscripción verificada
                  </span>
                  <span className="text-xs font-semibold text-slate-200 tabular-nums">
                    {remainingDays} días restantes
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-white/[0.08]">
                  <div>
                    <div className="text-slate-400 text-[11px]">Cuenta</div>
                    <div className="text-slate-100 font-semibold truncate">{subscription.email}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Código CVPRO</div>
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
                  · Método: <span className="uppercase">{subscription.provider}</span>
                </div>
              </div>

              <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-3.5 text-xs text-slate-300 space-y-1.5">
                <div className="font-semibold text-white inline-flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  Funciones activas en tu cuenta:
                </div>
                <div>• Todos los análisis de equipo y jugador con índice {PRO_CONFIDENCE_THRESHOLD}%–94%.</div>
                <div>• Ajuste por minutos (MPG), rendimiento local/visita y descanso B2B.</div>
                <div>• Simulador de líneas y calculadora comparativa en S/ y USD.</div>
              </div>
            </div>
          ) : (
            <>
              {/* Plan Summary */}
              <div className="rounded-xl bg-[#0e1117] border border-white/[0.1] p-4 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-white">Pase mensual · 30 días</div>
                  <div className="text-xs text-slate-400">
                    Activa el acceso completo con tarjeta o Yape / Plin.
                  </div>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <div className="text-xl font-bold text-white leading-none">
                    ${PRO_MONTHLY_PRICE_USD.toFixed(0)}
                    <span className="text-xs font-medium text-slate-300 ml-1.5">
                      / S/ {PRO_MONTHLY_PRICE_PEN.toFixed(0)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 uppercase font-medium mt-1">
                    USD o PEN · 30 días
                  </div>
                </div>
              </div>

              {/* Comparison */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-xl bg-white/[0.02] border border-white/[0.08] p-3 space-y-1">
                  <div className="font-semibold text-slate-300">Cuenta gratuita</div>
                  <div className="text-[11px] text-slate-400">
                    ✓ Marcadores, líneas y box scores
                  </div>
                  <div className="text-[11px] text-slate-400">
                    ✓ Análisis estándar (&lt; {PRO_CONFIDENCE_THRESHOLD}%)
                  </div>
                </div>
                <div className="rounded-xl bg-white/[0.04] border border-white/[0.16] p-3 space-y-1">
                  <div className="font-semibold text-white inline-flex items-center gap-1">
                    <Lock className="w-3 h-3 text-slate-300" aria-hidden="true" />
                    Plan Pro
                  </div>
                  <div className="text-[11px] text-slate-200">
                    ✓ Análisis avanzados ({PRO_CONFIDENCE_THRESHOLD}%–94%)
                  </div>
                  <div className="text-[11px] text-slate-200">
                    ✓ Sincronizado en Web y Android
                  </div>
                </div>
              </div>

              {/* Account Required Gate */}
              {!user ? (
                <div className="rounded-xl bg-[#0e1117] border border-white/[0.1] p-5 text-center space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.12] mx-auto flex items-center justify-center">
                    <LogIn className="w-5 h-5 text-slate-200" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-white">
                      Paso 1: Inicia sesión o crea tu cuenta
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Tu suscripción queda vinculada de forma segura a tu cuenta (Google o correo) para usarla en cualquier dispositivo.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onRequireAuth}
                    className="w-full py-2.5 px-4 rounded-lg cv-btn-primary text-sm inline-flex items-center justify-center gap-2"
                  >
                    <LogIn className="w-4 h-4" aria-hidden="true" />
                    Continuar con Google o correo
                  </button>
                </div>
              ) : (
                <>
                  {/* Signed-in user pill */}
                  <div className="rounded-lg bg-white/[0.04] border border-white/[0.1] px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-2 text-slate-200 min-w-0">
                      <UserCheck className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        Cuenta: <strong className="text-white">{user.email}</strong>
                      </span>
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase shrink-0">
                      Vinculada
                    </span>
                  </div>

                  {/* Mode Switch */}
                  <div className="flex rounded-lg bg-[#0b0d11] border border-white/[0.08] p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('buy');
                        setFeedback(null);
                      }}
                      className={`flex-1 py-1.5 rounded-md font-semibold transition-colors ${
                        mode === 'buy'
                          ? 'cv-tab-active'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Pagar (${PRO_MONTHLY_PRICE_USD.toFixed(0)} / S/ {PRO_MONTHLY_PRICE_PEN.toFixed(0)})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('code');
                        setFeedback(null);
                      }}
                      className={`flex-1 py-1.5 rounded-md font-semibold transition-colors ${
                        mode === 'code'
                          ? 'cv-tab-active'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Canjear código CVPRO
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
                                className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                                  selected
                                    ? 'bg-[#181c25] border-white/[0.28] text-white'
                                    : 'bg-white/[0.02] border-white/[0.08] text-slate-300 hover:border-white/[0.18]'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold">{pv.label}</span>
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300 border border-white/[0.1]">
                                      {pv.badge}
                                    </span>
                                  </div>
                                  <span
                                    className={`w-3.5 h-3.5 rounded-full border ${
                                      selected
                                        ? 'bg-white border-white'
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
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleSubmitYapePlin();
                          }}
                          className="space-y-3 rounded-xl bg-[#0e1117] border border-white/[0.1] p-3.5"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
                            <div>
                              <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-100">
                                <Smartphone className="w-4 h-4 text-slate-300" aria-hidden="true" />
                                Pago con Yape o Plin · S/ {PRO_MONTHLY_PRICE_PEN.toFixed(2)}
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5">
                                Titular: <strong className="text-slate-200">{YAPE_PLIN_CONFIG.holder}</strong>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={handleCopyNumber}
                              aria-label={`Copiar número ${YAPE_PLIN_CONFIG.number}`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#12151c] border border-white/[0.12] text-xs font-mono font-bold text-slate-100 hover:border-white/[0.25]"
                            >
                              <span>{YAPE_PLIN_CONFIG.number}</span>
                              {copiedPhone ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                              ) : (
                                <Copy className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                              )}
                            </button>
                          </div>

                          <div className="text-[11px] text-slate-300 space-y-1">
                            <div>1. Transfiere <strong>S/ {PRO_MONTHLY_PRICE_PEN.toFixed(2)}</strong> al <strong>{YAPE_PLIN_CONFIG.number}</strong>.</div>
                            <div>2. Ingresa tu <strong>N° de operación</strong>; al validarse, tu cuenta <strong>{user.email}</strong> quedará activa.</div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label htmlFor="yape-op-code" className="visually-hidden">
                                Número de operación Yape o Plin
                              </label>
                              <input
                                id="yape-op-code"
                                name="operation-code"
                                type="text"
                                required
                                minLength={4}
                                spellCheck={false}
                                autoCapitalize="none"
                                autoCorrect="off"
                                enterKeyHint="next"
                                value={yapeOpCode}
                                onChange={(e) => setYapeOpCode(e.target.value)}
                                placeholder="N° Operación (ej. 048291)"
                                className="w-full bg-[#12151c] border border-white/[0.12] rounded-lg px-3 py-2 text-base sm:text-xs text-white font-mono placeholder:text-slate-500"
                              />
                            </div>
                            <div className="space-y-1">
                              <label htmlFor="yape-sender-name" className="visually-hidden">
                                Nombre del titular
                              </label>
                              <input
                                id="yape-sender-name"
                                name="sender-name"
                                type="text"
                                autoComplete="name"
                                enterKeyHint="done"
                                value={yapeSenderName}
                                onChange={(e) => setYapeSenderName(e.target.value)}
                                placeholder="Nombre del titular (opcional)"
                                className="w-full bg-[#12151c] border border-white/[0.12] rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-500"
                              />
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-2">
                            <button
                              type="submit"
                              disabled={busy}
                              className="flex-1 py-2.5 px-3 rounded-lg cv-btn-primary text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                              {busy ? 'Registrando...' : 'Registrar pago en mi cuenta'}
                            </button>
                            <a
                              href={liveWhatsappUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="py-2.5 px-3 rounded-lg bg-[#12151c] hover:bg-[#181c25] border border-white/[0.12] text-slate-200 font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors"
                            >
                              <MessageCircle className="w-4 h-4" aria-hidden="true" />
                              WhatsApp
                            </a>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          disabled={busy || !checkoutUrl}
                          onClick={handleOpenCheckout}
                          className="w-full py-2.5 px-4 rounded-lg cv-btn-primary text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          <CreditCard className="w-4 h-4" aria-hidden="true" />
                          {checkoutUrl
                            ? `Pagar $${PRO_MONTHLY_PRICE_USD.toFixed(2)} USD (${
                                PROVIDERS.find((p) => p.key === provider)?.label.split(' (')[0]
                              })`
                            : 'Configura enlace de esta pasarela'}
                          {checkoutUrl && <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />}
                        </button>
                      )}

                      {awaitingConfirm && (
                        <div className="rounded-lg bg-white/[0.04] border border-white/[0.12] p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-200">
                            <span className="inline-flex items-center gap-2 font-semibold">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-300" aria-hidden="true" />
                              Esperando confirmación...
                            </span>
                            <button
                              type="button"
                              onClick={() => setAwaitingConfirm(false)}
                              className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                            >
                              Ocultar
                            </button>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={handleManualCheckAfterPay}
                            className="w-full py-1.5 px-3 rounded-lg bg-[#0b0d11] border border-white/[0.12] hover:border-white/[0.25] text-[11px] font-semibold text-slate-200 transition-colors"
                          >
                            {busy ? 'Consultando...' : 'Verificar estado en mi cuenta ahora'}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleClaimCode();
                      }}
                      className="space-y-3"
                    >
                      <div className="space-y-1.5">
                        <label
                          htmlFor="pro-access-code"
                          className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide"
                        >
                          Código CVPRO-XXXX-XXXX
                        </label>
                        <input
                          id="pro-access-code"
                          name="access-code"
                          type="text"
                          required
                          spellCheck={false}
                          autoCapitalize="characters"
                          autoCorrect="off"
                          enterKeyHint="done"
                          value={codeInput}
                          onChange={(e) => setCodeInput(e.target.value)}
                          placeholder="CVPRO-XXXX-XXXX"
                          className="w-full bg-[#0b0d11] border border-white/[0.12] rounded-lg px-3 py-2 text-base sm:text-sm text-white font-mono placeholder:font-sans placeholder:text-slate-500"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={busy}
                        className="w-full py-2.5 px-4 rounded-lg cv-btn-primary text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
                      >
                        <KeyRound className="w-4 h-4" aria-hidden="true" />
                        {busy ? 'Validando código...' : 'Vincular código a mi cuenta'}
                      </button>
                    </form>
                  )}
                </>
              )}

              {feedback && (
                <div
                  role={feedback.tone === 'err' ? 'alert' : 'status'}
                  aria-live="polite"
                  className={`rounded-lg border p-3 text-xs ${
                    feedback.tone === 'ok'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                      : feedback.tone === 'err'
                        ? 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                        : 'bg-white/[0.04] border-white/[0.12] text-slate-200'
                  }`}
                >
                  {feedback.text}
                </div>
              )}
            </>
          )}
        </div>
        </div>
      )}
    </ModalDialog>
  );
}
