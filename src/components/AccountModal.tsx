import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Crown,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  User,
  X,
  XCircle,
} from 'lucide-react';
import {
  adminListYapeRequests,
  adminReviewYapeRequest,
  signOutAccount,
  type AdminYapeRequestRow,
  type UserProfile,
} from '../services/authService';
import {
  getRemainingProDays,
  PRO_MONTHLY_PRICE_PEN,
  PRO_MONTHLY_PRICE_USD,
  type ProSubscriptionState,
} from '../services/subscriptionService';

interface AccountModalProps {
  profile: UserProfile;
  subscription: ProSubscriptionState | null;
  onClose: () => void;
  onOpenProModal: () => void;
  onSignedOut: () => void;
}

export function AccountModal({
  profile,
  subscription,
  onClose,
  onOpenProModal,
  onSignedOut,
}: AccountModalProps) {
  const [signingOut, setSigningOut] = useState(false);
  const [yapeReqs, setYapeReqs] = useState<AdminYapeRequestRow[]>([]);
  const [loadingAdmin, setLoadingAdmin] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [adminMsg, setAdminMsg] = useState<string | null>(null);

  const remainingDays = getRemainingProDays(subscription);
  const initials = (profile.fullName || profile.email || 'CV')
    .trim()
    .slice(0, 2)
    .toUpperCase();

  const loadAdminRequests = async () => {
    if (!profile.isAdmin) return;
    setLoadingAdmin(true);
    try {
      const rows = await adminListYapeRequests();
      setYapeReqs(rows);
    } catch {
      // Ignore transient RPC error
    } finally {
      setLoadingAdmin(false);
    }
  };

  useEffect(() => {
    if (profile.isAdmin) {
      void loadAdminRequests();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.isAdmin]);

  const handleReview = async (requestId: number, decision: 'approved' | 'rejected') => {
    setReviewingId(requestId);
    setAdminMsg(null);
    try {
      const res = await adminReviewYapeRequest(requestId, decision);
      setAdminMsg(
        decision === 'approved'
          ? `Pago #${requestId} aprobado · Código generado: ${res.access_code}`
          : `Solicitud #${requestId} rechazada.`,
      );
      await loadAdminRequests();
    } catch (err) {
      setAdminMsg(err instanceof Error ? err.message : 'No se pudo actualizar la solicitud.');
    } finally {
      setReviewingId(null);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOutAccount();
      onSignedOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#03050a]/85 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[92vh] flex flex-col bg-[#080d1a] border border-white/[0.12] rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/[0.08] bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.14),transparent_65%)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.fullName || profile.email}
                className="w-12 h-12 rounded-2xl object-cover border border-emerald-400/40 shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 font-black text-base flex items-center justify-center shrink-0">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-black text-white truncate">
                  {profile.fullName || 'Usuario CourtVision'}
                </h2>
                {profile.isAdmin && (
                  <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                    Admin
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 truncate">{profile.email}</div>
            </div>
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
          {/* Plan Status Card */}
          {subscription ? (
            <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-500/40 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-300 uppercase tracking-wide">
                  <ShieldCheck className="w-4 h-4" />
                  Plan PRO Activo
                </span>
                <span className="text-xs font-bold text-amber-300 tabular-nums">
                  {remainingDays} días restantes
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-white/[0.08]">
                <div>
                  <div className="text-[11px] text-slate-400">Código vinculado</div>
                  <div className="font-mono font-bold text-white">{subscription.accessCode}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Vencimiento</div>
                  <div className="font-semibold text-slate-200">
                    {new Date(subscription.expiresAt).toLocaleDateString('es-PE')}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-slate-400">
                Sincronizado con tu cuenta · Método:{' '}
                <span className="uppercase text-slate-200">{subscription.provider}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-300">
                    <User className="w-3.5 h-3.5 text-cyan-400" />
                    Plan Actual: Gratis
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Incluye marcadores, box scores, gráficas y props &lt; 68%. Sube a PRO desde tu cuenta para desbloquear todos los picks 68%–94%.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenProModal();
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black text-xs sm:text-sm inline-flex items-center justify-center gap-2 transition-all shadow-[0_6px_20px_rgba(16,185,129,0.28)]"
              >
                <Crown className="w-4 h-4" />
                Subir a Plan PRO (${PRO_MONTHLY_PRICE_USD.toFixed(0)} USD / S/ {PRO_MONTHLY_PRICE_PEN.toFixed(0)})
              </button>
            </div>
          )}

          {/* Admin Panel for Yape/Plin Requests */}
          {profile.isAdmin && (
            <div className="rounded-xl bg-amber-500/[0.05] border border-amber-500/30 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1.5 text-xs font-black text-amber-300 uppercase tracking-wide">
                  <Sparkles className="w-3.5 h-3.5" />
                  Panel Admin · Pagos Yape / Plin
                </div>
                <button
                  type="button"
                  onClick={loadAdminRequests}
                  disabled={loadingAdmin}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-300 hover:text-white px-2 py-1 rounded-lg bg-black/40 border border-white/[0.1]"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingAdmin ? 'animate-spin' : ''}`} />
                  Actualizar
                </button>
              </div>

              {adminMsg && (
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-[11px] text-emerald-200 font-semibold">
                  {adminMsg}
                </div>
              )}

              {loadingAdmin && yapeReqs.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">Cargando solicitudes...</div>
              ) : yapeReqs.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">
                  No hay solicitudes de Yape/Plin registradas aún.
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-auto pr-1">
                  {yapeReqs.map((req) => (
                    <div
                      key={req.request_id}
                      className="rounded-xl bg-black/45 border border-white/[0.08] p-2.5 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-white truncate">{req.email}</span>
                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${
                            req.status === 'approved'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : req.status === 'rejected'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {req.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
                        <span>
                          Op: <strong className="text-amber-300 font-mono">{req.operation_code}</strong> · S/{' '}
                          {Number(req.amount_pen).toFixed(2)}
                          {req.sender_name ? ` · ${req.sender_name}` : ''}
                        </span>
                        {req.access_code && (
                          <span className="text-emerald-300 font-mono font-bold">{req.access_code}</span>
                        )}
                      </div>

                      {req.status === 'pending' && (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={reviewingId === req.request_id}
                            onClick={() => handleReview(req.request_id, 'approved')}
                            className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-[11px] inline-flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            {reviewingId === req.request_id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            Aprobar y Activar PRO
                          </button>
                          <button
                            type="button"
                            disabled={reviewingId === req.request_id}
                            onClick={() => handleReview(req.request_id, 'rejected')}
                            className="py-1.5 px-2.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300 font-bold text-[11px] inline-flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            <XCircle className="w-3 h-3" />
                            Rechazar
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sign Out */}
          <button
            type="button"
            disabled={signingOut}
            onClick={handleSignOut}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-xs font-bold text-slate-200 transition-colors disabled:opacity-50"
          >
            {signingOut ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <LogOut className="w-4 h-4 text-rose-400" />
            )}
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
