import { useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  ShieldCheck,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import {
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  translateAuthError,
} from '../services/authService';

interface AuthModalProps {
  initialTab?: 'login' | 'signup';
  promptReason?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function AuthModal({
  initialTab = 'login',
  promptReason,
  onClose,
  onSuccess,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>(initialTab);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' | 'info' } | null>(
    null,
  );

  const handleGoogle = async () => {
    setFeedback(null);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setGoogleBusy(false);
      setFeedback({ text: translateAuthError(err), tone: 'err' });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFeedback({ text: 'Ingresa un correo electrónico válido.', tone: 'err' });
      return;
    }

    if (mode !== 'reset' && password.length < 6) {
      setFeedback({ text: 'La contraseña debe tener al menos 6 caracteres.', tone: 'err' });
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(cleanEmail, password);
        onSuccess();
      } else if (mode === 'signup') {
        const res = await signUpWithEmail(cleanEmail, password, fullName);
        if (res.needsEmailConfirmation) {
          setFeedback({
            text: 'Cuenta creada. Revisa tu bandeja de entrada (o spam) para confirmar tu correo e iniciar sesión.',
            tone: 'ok',
          });
          setMode('login');
        } else {
          onSuccess();
        }
      } else {
        await sendPasswordReset(cleanEmail);
        setFeedback({
          text: 'Te enviamos un enlace a tu correo para restablecer tu contraseña.',
          tone: 'ok',
        });
      }
    } catch (err) {
      setFeedback({ text: translateAuthError(err), tone: 'err' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#03050a]/85 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[92vh] flex flex-col bg-[#080d1a] border border-emerald-500/25 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.85)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/[0.08] bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.16),transparent_65%)] flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Cuenta Gratuita · CourtVision
            </div>
            <h2 className="text-xl font-black text-white mt-1 tracking-tight">
              {mode === 'login'
                ? 'Inicia sesión'
                : mode === 'signup'
                  ? 'Crea tu cuenta gratis'
                  : 'Recupera tu contraseña'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Gratis con Google o correo electrónico. Desde tu cuenta puedes subir a PRO cuando quieras.
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
          {promptReason && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/35 px-3.5 py-2.5 text-xs text-amber-200">
              {promptReason}
            </div>
          )}

          {/* Google OAuth Button */}
          <button
            type="button"
            disabled={googleBusy || busy}
            onClick={handleGoogle}
            className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm inline-flex items-center justify-center gap-2.5 shadow-md transition-colors disabled:opacity-60"
          >
            {googleBusy ? (
              <Loader2 className="w-4 h-4 animate-spin text-slate-700" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.09.73-2.48 1.16-4.22 1.16-3.24 0-5.99-2.19-6.97-5.13H1.04v3.14C3.05 21.14 7.21 24 12 24Z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.03 14.02c-.25-.73-.39-1.52-.39-2.32 0-.8.14-1.59.39-2.32V6.24H1.04C.38 7.56 0 9.04 0 10.7c0 1.66.38 3.14 1.04 4.46l3.99-3.14Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.8 0 3.41.62 4.68 1.83l3.51-3.51C18.07 1.19 15.3 0 12 0 7.21 0 3.05 2.86 1.04 7.04l3.99 3.14C6.01 7.24 8.76 4.75 12 4.75Z"
                />
              </svg>
            )}
            <span>Continuar con Google</span>
          </button>

          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <div className="flex-1 h-px bg-white/[0.08]" />
            <span>o con tu correo</span>
            <div className="flex-1 h-px bg-white/[0.08]" />
          </div>

          {/* Mode Tabs */}
          <div className="flex rounded-xl bg-black/40 border border-white/[0.08] p-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setFeedback(null);
              }}
              className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                mode === 'login'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setFeedback(null);
              }}
              className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                mode === 'signup'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Crear cuenta
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'signup' && (
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                  Tu nombre
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej. Carlos Pérez"
                    className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                />
              </div>
            </div>

            {mode !== 'reset' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                    Contraseña
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset');
                        setFeedback(null);
                      }}
                      className="text-[11px] text-cyan-300 hover:text-cyan-200 underline"
                    >
                      ¿Olvidaste tu clave?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-slate-950/90 border border-white/[0.12] rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={busy || googleBusy}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60 transition-all shadow-[0_6px_20px_rgba(16,185,129,0.28)]"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'login' ? (
                <LogIn className="w-4 h-4" />
              ) : mode === 'signup' ? (
                <UserPlus className="w-4 h-4" />
              ) : (
                <Mail className="w-4 h-4" />
              )}
              <span>
                {mode === 'login'
                  ? 'Entrar a mi cuenta'
                  : mode === 'signup'
                    ? 'Crear cuenta gratis'
                    : 'Enviar enlace de recuperación'}
              </span>
            </button>

            {mode === 'reset' && (
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setFeedback(null);
                }}
                className="w-full text-center text-xs text-slate-400 hover:text-white py-1"
              >
                Volver a Iniciar sesión
              </button>
            )}
          </form>

          {feedback && (
            <div
              className={`rounded-xl border p-3 text-xs flex items-start gap-2 ${
                feedback.tone === 'ok'
                  ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-200'
                  : feedback.tone === 'err'
                    ? 'bg-rose-500/10 border-rose-500/35 text-rose-200'
                    : 'bg-cyan-500/10 border-cyan-500/35 text-cyan-200'
              }`}
            >
              {feedback.tone === 'ok' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
              <span>{feedback.text}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
