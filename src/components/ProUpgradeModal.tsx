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
              Acceso por 30 días vinculado a tu cuenta en Web y App Móvil.
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
                    <div className="text-slate-400 text-[11px]">Cuenta</div>
                    <div className="text-slate-100 font-semibold truncate">{subscription.email}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">Código CVPRO</div>
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
                  Beneficios activos en tu cuenta:
                </div>
                <div>• Todos los Props de Equipo y Jugador con confianza {PRO_CONFIDENCE_THRESHOLD}%–94%.</div>
                <div>• Motor avanzado con ajuste por Minutos (MPG), Local/Visita y fatiga B2B.</div>
                <div>• Simulador de cuotas, líneas O/U y calculadora de ganancia en S/ y USD.</div>
              </div>
            </div>
          ) : (
            <>
              {/* Plan Summary */}
              <div className="rounded-xl bg-gradient-to-r from-emerald-500/15 via-cyan-500/10 to-amber-500/15 border border-emerald-500/30 p-4 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-extrabold text-white">Pase Mensual · 30 Días</div>
                  <div className="text-[11px] text-slate-300">
                    Sube tu cuenta gratuita a PRO con tarjeta o Yape / Plin.
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
                  <div className="font-bold text-slate-300">Cuenta Gratis</div>
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
                    ✓ Activo en Web y App Android
                  </div>
                </div>
              </div>

              {/* Account Required Gate */}
              {!user ? (
                <div className="rounded-2xl bg-slate-950/90 border border-cyan-500/35 p-5 text-center space-y-3">
                  <div className="w-11 h-11 rounded-2xl bg-cyan-500/15 border border-cyan-500/35 mx-auto flex items-center justify-center">
                    <LogIn className="w-5 h-5 text-cyan-300" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-black text-white">
                      Paso 1: Inicia sesión o crea tu cuenta gratis
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Tu suscripción PRO queda guardada de forma segura en tu cuenta (Google o correo) para usarla en cualquier dispositivo.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onRequireAuth}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black text-sm inline-flex items-center justify-center gap-2 transition-all shadow-[0_6px_20px_rgba(16,185,129,0.28)]"
                  >
                    <LogIn className="w-4 h-4" />
                    Continuar con Google o Correo (Gratis)
                  </button>
                </div>
              ) : (
                <>
                  {/* Signed-in user pill */}
                  <div className="rounded-xl bg-emerald-500/[0.07] border border-emerald-500/30 px-3 py-2 flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-2 text-emerald-200 min-w-0">
                      <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="truncate">
                        Cuenta: <strong className="text-white">{user.email}</strong>
                      </span>
                    </span>
                    <span className="text-[10px] font-bold text-emerald-300 uppercase shrink-0">
                      Listo para PRO
                    </span>
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
                      Pagar ($5 / S/ 19)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('code');
                        setFeedback(null);
                      }}
                      className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                        mode === 'code'
                          ? 'bg-emerald-500 text-slate-950 shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Canjear Código CVPRO
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
                            <div>1. Yapea o Plinea <strong>S/ {PRO_MONTHLY_PRICE_PEN.toFixed(2)}</strong> al <strong>{YAPE_PLIN_CONFIG.number}</strong>.</div>
                            <div>2. Ingresa tu <strong>N° de operación</strong>; al aprobarlo, tu cuenta <strong>{user.email}</strong> subirá a PRO.</div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={yapeOpCode}
                              onChange={(e) => setYapeOpCode(e.target.value)}
                              placeholder="N° Operación (ej. 048291)"
                              className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl px-3 py-2 text-xs text-white font-mono placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                            />
                            <input
                              type="text"
                              value={yapeSenderName}
                              onChange={(e) => setYapeSenderName(e.target.value)}
                              placeholder="Nombre del titular (opcional)"
                              className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                            />
                          </div>

                          <div className="flex flex-col sm:flex-row gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={handleSubmitYapePlin}
                              className="flex-1 py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              {busy ? 'Registrando...' : 'Registrar Pago en mi Cuenta'}
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
                      )}

                      {awaitingConfirm && (
                        <div className="rounded-xl bg-white/[0.04] border border-emerald-500/30 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-200">
                            <span className="inline-flex items-center gap-2 font-semibold">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                              Esperando confirmación automática...
                            </span>
                            <button
                              type="button"
                              onClick={() => setAwaitingConfirm(false)}
                              className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                            >
                              Ocultar
                            </button>
                          </div>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={handleManualCheckAfterPay}
                            className="w-full py-1.5 px-3 rounded-lg bg-slate-950 border border-white/[0.12] hover:border-emerald-400/50 text-[11px] font-semibold text-slate-200 transition-colors"
                          >
                            {busy ? 'Consultando...' : 'Verificar estado en mi cuenta ahora'}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                          Código CVPRO-XXXX-XXXX
                        </label>
                        <input
                          type="text"
                          value={codeInput}
                          onChange={(e) => setCodeInput(e.target.value)}
                          placeholder="CVPRO-XXXX-XXXX"
                          className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl px-3 py-2 text-sm text-white font-mono placeholder:font-sans placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleClaimCode}
                        className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60 transition-all shadow-[0_6px_20px_rgba(16,185,129,0.28)]"
                      >
                        <KeyRound className="w-4 h-4" />
                        {busy ? 'Validando código...' : 'Vincular Código a mi Cuenta'}
                      </button>
                    </div>
                  )}
                </>
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
