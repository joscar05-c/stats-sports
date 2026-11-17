import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowLeftRight,
  Calendar,
  Download,
  Flame,
  LogIn,
  PanelLeft,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  WifiOff,
} from 'lucide-react';
import {
  fetchCurrentSeason,
  fetchLastSync,
  fetchLeagues,
  triggerCloudSync,
} from './services/basketballApi';
import { fetchUserProfile, type UserProfile } from './services/authService';
import {
  clearProSubscription,
  getStoredSubscription,
  syncSubscriptionForUser,
  type ProSubscriptionState,
} from './services/subscriptionService';
import { supabase } from './lib/supabase';
import { GamesView } from './components/GamesView';
import { LeadersView } from './components/LeadersView';
import { CompareView } from './components/CompareView';
import { StandingsView } from './components/StandingsView';
import { ExploreView } from './components/ExploreView';
import { PropsSidebar, type SelectedPropPayload } from './components/PropsSidebar';
import { PropAnalysisView } from './components/PropAnalysisView';
import { ProUpgradeModal } from './components/ProUpgradeModal';
import { AuthModal } from './components/AuthModal';
import { AccountModal } from './components/AccountModal';
import { GameDetailModal } from './components/GameDetailModal';
import { PlayerDetailModal } from './components/PlayerDetailModal';
import { TeamDetailModal } from './components/TeamDetailModal';
import type { Game, League, Season, SyncRun, Team, TeamStanding } from './types/database';

type TabKey = 'games' | 'leaders' | 'compare' | 'standings' | 'explore';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function App() {
  const [tab, setTab] = useState<TabKey>('games');
  const [leagues, setLeagues] = useState<League[]>([]);
  const [activeLeague, setActiveLeague] = useState<League | null>(null);
  const [season, setSeason] = useState<Season | null>(null);
  const [lastSync, setLastSync] = useState<SyncRun | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);
  const [fromCache, setFromCache] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sidebarToggleTick, setSidebarToggleTick] = useState(0);
  const [propsDrawerOpen, setPropsDrawerOpen] = useState(false);

  // Drill-down Modals & Active Main Prop View
  const [activePropView, setActivePropView] = useState<SelectedPropPayload | null>(null);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<{
    team: Team;
    standing?: TeamStanding;
  } | null>(null);

  // User Auth & Subscription PRO ($5 USD / S/ 19 PEN)
  const [authUser, setAuthUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authPromptReason, setAuthPromptReason] = useState<string | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [returnToProAfterAuth, setReturnToProAfterAuth] = useState(false);
  const [proSub, setProSub] = useState<ProSubscriptionState | null>(null);
  const [showProModal, setShowProModal] = useState(false);

  // Listen for Supabase Auth session changes (Google OAuth redirect + Email login/signup)
  useEffect(() => {
    let active = true;

    const applySessionUser = (sessionUser: Parameters<typeof fetchUserProfile>[0]) => {
      if (!sessionUser) {
        if (active) {
          setAuthUser(null);
          setProSub(null);
          clearProSubscription();
          setAuthLoading(false);
        }
        return;
      }

      void fetchUserProfile(sessionUser)
        .then((profile) => {
          if (!active) return;
          setAuthUser(profile);
          setAuthLoading(false);
          if (profile) {
            const cached = getStoredSubscription(profile.id);
            if (cached) setProSub(cached);
          }
        })
        .catch(() => {
          if (active) setAuthLoading(false);
        });
    };

    void supabase.auth.getSession().then(({ data }) => {
      applySessionUser(data.session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySessionUser(session?.user ?? null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Reopen PRO checkout automatically if the user signed in from the PRO gate
  useEffect(() => {
    if (authUser && returnToProAfterAuth) {
      setShowAuthModal(false);
      setAuthPromptReason(null);
      setReturnToProAfterAuth(false);
      setShowProModal(true);
    }
  }, [authUser, returnToProAfterAuth]);

  // Sync account-bound PRO subscription via authenticated RPC + Realtime broadcast
  useEffect(() => {
    if (!authUser) {
      setProSub(null);
      return;
    }

    let active = true;
    const syncPro = () => {
      syncSubscriptionForUser(authUser)
        .then((sub) => {
          if (active) setProSub(sub);
        })
        .catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncPro();
    };

    syncPro();
    window.addEventListener('focus', syncPro);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = window.setInterval(syncPro, 30_000);
    const channel = supabase
      .channel('pro_unlock')
      .on('broadcast', { event: 'pro_updated' }, syncPro)
      .subscribe();

    return () => {
      active = false;
      window.removeEventListener('focus', syncPro);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [authUser]);

  // PWA Install Prompt
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const activeSport: 'basketball' | 'football' =
    activeLeague?.sport === 'football' ? 'football' : 'basketball';
  const sportLeagues = leagues.filter(
    (l) => (l.sport === 'football' ? 'football' : 'basketball') === activeSport,
  );
  const hasBasketball = leagues.some((l) => (l.sport ?? 'basketball') === 'basketball');
  const hasFootball = leagues.some((l) => l.sport === 'football');

  const getFootballLeagueCode = (lg: League | null): string => {
    if (!lg) return 'eng.1';
    if (lg.external_id) return lg.external_id;
    const map: Record<string, string> = {
      'premier-league': 'eng.1',
      laliga: 'esp.1',
      'serie-a': 'ita.1',
      bundesliga: 'ger.1',
      'ligue-1': 'fra.1',
      'champions-league': 'uefa.champions',
    };
    return map[lg.slug] ?? 'eng.1';
  };

  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await triggerCloudSync(
        2,
        3,
        activeSport,
        getFootballLeagueCode(activeLeague),
      );
      const updatedSync = await fetchLastSync();
      if (updatedSync) setLastSync(updatedSync);
      setSyncVersion((v) => v + 1);
    } catch {
      // Ignore background/manual sync network errors cleanly
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoadingInit(true);
    Promise.all([fetchLeagues(), fetchLastSync()])
      .then(async ([lgRes, syncRes]) => {
        if (!active) return;
        setLeagues(lgRes.data);
        setFromCache(lgRes.fromCache);
        setLastSync(syncRes);
        const first = lgRes.data[0] ?? null;
        setActiveLeague(first);
        if (first) {
          const sn = await fetchCurrentSeason(first.id);
          if (active) setSeason(sn);
        }
        // Auto-sync in background if last sync was > 3 hours ago
        const lastMs = syncRes?.ran_at ? new Date(syncRes.ran_at).getTime() : 0;
        if (!lgRes.fromCache && Date.now() - lastMs > 3 * 3600 * 1000) {
          setSyncing(true);
          triggerCloudSync(2, 3)
            .then(() => fetchLastSync())
            .then((freshSync) => {
              if (!active) return;
              if (freshSync) setLastSync(freshSync);
              setSyncVersion((v) => v + 1);
            })
            .catch(() => {})
            .finally(() => {
              if (active) setSyncing(false);
            });
        }
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : 'Error conectando con Supabase');
      })
      .finally(() => {
        if (active) setLoadingInit(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Keep lastSync badge updated in real time without page reload
  useEffect(() => {
    let active = true;
    const refreshSyncBadge = () => {
      fetchLastSync()
        .then((fresh) => {
          if (active && fresh) setLastSync(fresh);
        })
        .catch(() => {});
    };

    const interval = window.setInterval(refreshSyncBadge, 30000);
    const channel = supabase
      .channel('sync_runs_badge')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sync_runs' },
        refreshSyncBadge,
      )
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSelectLeague = async (lg: League) => {
    setActiveLeague(lg);
    setActivePropView(null);
    setSelectedGame(null);
    setSelectedPlayerId(null);
    setSelectedTeam(null);
    const sn = await fetchCurrentSeason(lg.id);
    setSeason(sn);
  };

  const handleSelectSport = (targetSport: 'basketball' | 'football') => {
    if (targetSport === activeSport) return;
    const match = leagues.find(
      (l) => (l.sport === 'football' ? 'football' : 'basketball') === targetSport,
    );
    if (!match) return;
    navigateWithTransition(() => {
      setTab('games');
      void handleSelectLeague(match);
    }, true);
  };

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const navigateWithTransition = (update: () => void, routeFocus = false) => {
    const doc = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };
    const focusHeading = () => {
      if (routeFocus) {
        document.getElementById('main-view-heading')?.focus({ preventScroll: true });
      }
    };
    if (!doc.startViewTransition) {
      update();
      focusHeading();
      return;
    }
    const transition = doc.startViewTransition(() => {
      flushSync(update);
    });
    void transition.finished.finally(focusHeading);
  };

  const switchMainTab = (nextTab: TabKey) => {
    navigateWithTransition(() => {
      setActivePropView(null);
      setTab(nextTab);
    }, true);
  };

  const navItems: Array<{ key: TabKey; label: string; icon: typeof Calendar }> = [
    { key: 'games', label: 'Partidos', icon: Calendar },
    { key: 'leaders', label: 'Líderes', icon: Flame },
    { key: 'compare', label: 'Comparar', icon: ArrowLeftRight },
    { key: 'standings', label: 'Posiciones', icon: Trophy },
    { key: 'explore', label: 'Explorar', icon: Search },
  ];

  const activeViewLabel = activePropView
    ? `Análisis de Prop: ${activePropView.prop.subjectName}`
    : navItems.find((item) => item.key === tab)?.label ?? 'Partidos';

  useEffect(() => {
    document.title = `${activeViewLabel} | CourtVision`;
  }, [activeViewLabel]);

  return (
    <div className="min-h-screen text-slate-100 pb-24 md:pb-10">
      <a href="#main-view-heading" className="visually-hidden skip-link">
        Saltar al contenido principal
      </a>
      {/* Header */}
      <header className="sticky top-0 z-40 sb-glass-header">
        {/* Row 1: Brand Identity + Utility Controls */}
        <div className="max-w-7xl mx-auto px-3 sm:px-5 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-3">
          {/* Left Brand Block */}
          <button
            type="button"
            onClick={() => switchMainTab('games')}
            className="flex items-center gap-2 sm:gap-3 min-w-0 text-left group"
          >
            <img
              src="/icon.svg"
              alt="CourtVision"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-white/[0.1] block shrink-0"
            />

            <div className="min-w-0">
              <span className="font-bold text-sm sm:text-lg tracking-tight leading-none text-slate-100 block truncate">
                CourtVision
              </span>
              <span className="block mt-0.5 text-[11px] text-slate-400 font-medium truncate">
                {season
                  ? `${activeLeague?.short_name ?? 'NBA'} · ${season.name}`
                  : 'Estadísticas y Análisis'}
              </span>
            </div>
          </button>

          {/* Right Controls Cluster */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {hasBasketball && hasFootball && (
              <div
                role="group"
                aria-label="Seleccionar deporte"
                className="hidden md:inline-flex items-center rounded-lg bg-[#12151c] border border-white/[0.1] p-0.5"
              >
                <button
                  type="button"
                  onClick={() => handleSelectSport('basketball')}
                  aria-pressed={activeSport === 'basketball'}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    activeSport === 'basketball'
                      ? 'cv-tab-active'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  NBA
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectSport('football')}
                  aria-pressed={activeSport === 'football'}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    activeSport === 'football'
                      ? 'cv-tab-active'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Fútbol
                </button>
              </div>
            )}

            {activeLeague && (
              <button
                type="button"
                onClick={() => setSidebarToggleTick((t) => t + 1)}
                className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/[0.04] text-slate-200 border border-white/[0.1] hover:bg-white/[0.08] transition-colors whitespace-nowrap"
                title="Abrir o fijar panel de análisis de Props"
              >
                <PanelLeft className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                <span>Análisis</span>
              </button>
            )}

            {installPrompt && (
              <button
                onClick={handleInstallPwa}
                className="hidden md:inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/[0.04] text-slate-200 border border-white/[0.1] hover:bg-white/[0.08] whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                Instalar
              </button>
            )}

            {authUser ? (
              <button
                type="button"
                onClick={() => setShowAccountModal(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2 sm:px-2.5 py-1.5 rounded-lg bg-[#12151c] hover:bg-[#181c25] border border-white/[0.1] text-slate-200 transition-colors whitespace-nowrap"
                title={`Cuenta: ${authUser.email}`}
              >
                {authUser.avatarUrl ? (
                  <img
                    src={authUser.avatarUrl}
                    alt={authUser.fullName || authUser.email}
                    className="w-4 h-4 rounded-full object-cover border border-white/[0.2] shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-white/[0.1] text-slate-200 text-[10px] font-bold inline-flex items-center justify-center uppercase shrink-0">
                    {(authUser.fullName || authUser.email).slice(0, 1)}
                  </span>
                )}
                <span className="hidden sm:inline max-w-[110px] truncate">
                  {authUser.fullName || authUser.email.split('@')[0]}
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled={authLoading}
                onClick={() => {
                  setAuthPromptReason(null);
                  setReturnToProAfterAuth(false);
                  setShowAuthModal(true);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-[#12151c] hover:bg-[#181c25] border border-white/[0.1] text-slate-200 transition-colors disabled:opacity-60 whitespace-nowrap"
                title="Iniciar sesión o crear cuenta"
              >
                <LogIn className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                <span>Entrar</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowProModal(true)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                proSub
                  ? 'bg-emerald-500/12 text-emerald-300 border-emerald-500/30'
                  : 'bg-white/[0.06] hover:bg-white/[0.1] text-slate-100 border-white/[0.12]'
              }`}
              title={
                proSub
                  ? `Plan Pro activo (${proSub.accessCode})`
                  : 'Información y suscripción al Plan Pro'
              }
            >
              {proSub ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Pro activo</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 text-slate-300 shrink-0" aria-hidden="true" />
                  <span>Plan Pro</span>
                </>
              )}
            </button>

            <button
              onClick={handleManualSync}
              disabled={syncing}
              title={
                lastSync
                  ? `Última sincronización: ${new Date(lastSync.ran_at).toLocaleString('es-PE')}. Clic para actualizar.`
                  : 'Actualizar marcadores'
              }
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2 sm:px-2.5 py-1.5 rounded-lg bg-white/[0.04] text-slate-300 border border-white/[0.08] hover:border-white/[0.16] hover:text-white disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-slate-400 shrink-0 ${syncing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span className="hidden lg:inline tabular-nums">
                {syncing
                  ? 'Actualizando...'
                  : lastSync
                    ? `${new Date(lastSync.ran_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`
                    : 'Actualizar'}
              </span>
            </button>
          </div>
        </div>

        {/* Row 2 (Mobile): Sport Switcher + Props Drawer Trigger */}
        <div className="md:hidden border-t border-white/[0.06] bg-[#0b0d11]/95 px-3 py-1.5 flex items-center justify-between gap-2">
          {hasBasketball && hasFootball ? (
            <div
              role="group"
              aria-label="Cambiar deporte"
              className="inline-flex items-center rounded-lg bg-[#12151c] border border-white/[0.1] p-0.5"
            >
              <button
                type="button"
                onClick={() => handleSelectSport('basketball')}
                aria-pressed={activeSport === 'basketball'}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  activeSport === 'basketball'
                    ? 'cv-tab-active'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                NBA
              </button>
              <button
                type="button"
                onClick={() => handleSelectSport('football')}
                aria-pressed={activeSport === 'football'}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                  activeSport === 'football'
                    ? 'cv-tab-active'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Fútbol
              </button>
            </div>
          ) : (
            <span className="text-xs font-semibold text-slate-300 truncate">
              {activeLeague?.short_name ?? 'CourtVision'}
            </span>
          )}

          {activeLeague && (
            <button
              type="button"
              onClick={() => setSidebarToggleTick((t) => t + 1)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#12151c] text-slate-100 border border-white/[0.12] hover:bg-white/[0.08] transition-colors whitespace-nowrap"
              title="Abrir panel de análisis y cuotas"
            >
              <PanelLeft className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              <span>Análisis</span>
            </button>
          )}
        </div>

        {/* Row 2: Dedicated Desktop Navigation Rail */}
        <div className="hidden md:block border-t border-white/[0.06] bg-[#0b0d11]">
          <div className="max-w-7xl mx-auto px-5 h-11 flex items-center justify-between gap-4">
            <nav
              aria-label="Principal"
              className="flex items-center gap-1 overflow-x-auto no-scrollbar sb-scroll-fade-x"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = !activePropView && tab === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => switchMainTab(item.key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'cv-tab-active'
                        : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.05]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400 shrink-0">
              <span>Estadísticas oficiales · Datos en vivo</span>
            </div>
          </div>
        </div>
      </header>

      {/* Left Slide-Out Props Sidebar */}
      {activeLeague && (
        <PropsSidebar
          leagueId={activeLeague.id}
          sport={activeSport}
          syncVersion={syncVersion}
          toggleSignal={sidebarToggleTick}
          isPro={Boolean(proSub)}
          activePropId={activePropView?.prop.id ?? null}
          onSelectProp={(selection) =>
            navigateWithTransition(() => setActivePropView(selection), true)
          }
          onOpenProModal={() => setShowProModal(true)}
          onDesktopExpandedChange={setPropsDrawerOpen}
        />
      )}

      {/* Main Content (pushes smoothly right when desktop Props sidebar opens) */}
      <div
        className={`transition-[padding] duration-200 ease-out ${
          activeLeague
            ? propsDrawerOpen
              ? 'md:pl-[396px] lg:pl-[436px]'
              : 'md:pl-[68px]'
            : ''
        }`}
      >
        <main id="main-content" className="max-w-6xl mx-auto px-3 sm:px-4 pt-4">
          <h1 id="main-view-heading" tabIndex={-1} className="visually-hidden outline-none">
            CourtVision — {activeViewLabel}
          </h1>
          {fromCache && (
            <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.1] text-xs text-slate-300">
              <WifiOff className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              Mostrando datos guardados en caché local (modo sin conexión).
            </div>
          )}

          {loadingInit ? (
            <div className="space-y-3 pt-4">
              <div className="h-12 rounded-xl bg-white/[0.04] animate-pulse" />
              <div className="h-44 rounded-2xl bg-white/[0.04] animate-pulse" />
              <div className="h-44 rounded-2xl bg-white/[0.04] animate-pulse" />
            </div>
          ) : errorMsg ? (
            <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-5 text-sm text-rose-200">
              <div className="font-bold mb-1">No se pudo cargar Supabase</div>
              <div className="text-xs text-rose-300/90">{errorMsg}</div>
            </div>
          ) : !activeLeague || !season ? (
            <div className="sb-card rounded-2xl p-8 text-center text-sm text-slate-400">
              Aún no hay ligas cargadas en Supabase. Ejecuta el sincronizador para poblar la NBA.
            </div>
          ) : (
            <>
              {sportLeagues.length > 1 && !activePropView && (
                <div
                  role="region"
                  aria-label="Ligas disponibles"
                  className="mb-4 flex items-center gap-1.5 overflow-x-auto no-scrollbar sb-scroll-fade-x pb-1"
                >
                  {sportLeagues.map((lg) => {
                    const isSelected = activeLeague.id === lg.id;
                    return (
                      <button
                        key={lg.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => void handleSelectLeague(lg)}
                        className={`shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          isSelected
                            ? 'cv-tab-active border-transparent'
                            : 'bg-[#12151c] text-slate-300 border-white/[0.08] hover:border-white/[0.18] hover:text-white'
                        }`}
                      >
                        {lg.logo_url && (
                          <img
                            src={lg.logo_url}
                            alt=""
                            aria-hidden="true"
                            className="w-4 h-4 object-contain shrink-0"
                          />
                        )}
                        <span>{lg.short_name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {activePropView ? (
            <PropAnalysisView
              game={activePropView.game}
              prop={activePropView.prop}
              context={activePropView.context}
              sport={activeSport}
              isPro={Boolean(proSub)}
              onBack={() => setActivePropView(null)}
              onSelectProp={(nextProp) =>
                setActivePropView((prev) => (prev ? { ...prev, prop: nextProp } : null))
              }
              onOpenGameModal={(game) => setSelectedGame(game)}
              onOpenPlayerModal={(pid) => setSelectedPlayerId(pid)}
              onOpenProModal={() => setShowProModal(true)}
            />
          ) : (
            <>
              {tab === 'games' && (
                <GamesView
                  key={`games_${activeLeague.id}_${syncVersion}`}
                  leagueId={activeLeague.id}
                  sport={activeSport}
                  leagueCode={activeSport === 'football' ? getFootballLeagueCode(activeLeague) : undefined}
                  onSelectGame={(game) => setSelectedGame(game)}
                  onGamesUpdated={(updatedGames) => {
                    setSelectedGame((prev) => {
                      if (!prev) return null;
                      return updatedGames.find((g) => g.id === prev.id) ?? prev;
                    });
                  }}
                />
              )}
              {tab === 'leaders' && (
                <LeadersView
                  key={`leaders_${activeLeague.id}_${syncVersion}`}
                  leagueId={activeLeague.id}
                  seasonId={season.id}
                  sport={activeSport}
                  onSelectPlayer={(pid) => setSelectedPlayerId(pid)}
                  onSelectTeam={(team) => setSelectedTeam({ team })}
                />
              )}
              {tab === 'compare' && (
                <CompareView
                  key={`compare_${activeLeague.id}_${syncVersion}`}
                  leagueId={activeLeague.id}
                  seasonId={season.id}
                  sport={activeSport}
                />
              )}
              {tab === 'standings' && (
                <StandingsView
                  key={`standings_${season.id}_${syncVersion}`}
                  seasonId={season.id}
                  sport={activeSport}
                  leagueSlug={activeLeague.slug}
                  onSelectTeam={(team, standing) => setSelectedTeam({ team, standing })}
                />
              )}
              {tab === 'explore' && (
                <ExploreView
                  key={`explore_${activeLeague.id}_${syncVersion}`}
                  league={activeLeague}
                  onSelectPlayer={(pid) => setSelectedPlayerId(pid)}
                  onSelectTeam={(team) => setSelectedTeam({ team })}
                />
              )}
            </>
          )}
            </>
          )}
          <footer className="mt-10 pt-5 border-t border-white/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-slate-400 pb-4">
            <span>CourtVision · Estadísticas y análisis deportivo</span>
            <span>Información estadística de carácter informativo y analítico.</span>
          </footer>
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Móvil"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 sb-glass-header border-t border-b-0 pb-safe"
      >
        <div className="grid grid-cols-5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = !activePropView && tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => switchMainTab(item.key)}
                className={`relative flex flex-col items-center justify-center py-2 px-1 gap-0.5 text-[11px] font-semibold transition-colors ${
                  active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-white"
                  />
                )}
                <Icon className="w-5 h-5" aria-hidden="true" />
                <span className="truncate max-w-full">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Drill-down Modals */}
      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
          sport={activeSport}
          isPro={Boolean(proSub)}
          onClose={() => setSelectedGame(null)}
          onSelectPlayer={(pid) => setSelectedPlayerId(pid)}
          onOpenProModal={() => setShowProModal(true)}
        />
      )}

      {selectedTeam && (
        <TeamDetailModal
          team={selectedTeam.team}
          standing={selectedTeam.standing}
          sport={activeSport}
          onClose={() => setSelectedTeam(null)}
          onSelectPlayer={(pid) => setSelectedPlayerId(pid)}
          onSelectGame={(game) => {
            setSelectedTeam(null);
            setSelectedGame(game);
          }}
        />
      )}

      {selectedPlayerId != null && (
        <PlayerDetailModal
          playerId={selectedPlayerId}
          sport={activeSport}
          isPro={Boolean(proSub)}
          onClose={() => setSelectedPlayerId(null)}
          onOpenProModal={() => setShowProModal(true)}
        />
      )}

      {showProModal && (
        <ProUpgradeModal
          user={authUser}
          subscription={proSub}
          onClose={() => setShowProModal(false)}
          onRequireAuth={() => {
            setShowProModal(false);
            setAuthPromptReason(
              'Inicia sesión o crea tu cuenta gratis para vincular tu Plan PRO en Web y App Móvil.'
            );
            setReturnToProAfterAuth(true);
            setShowAuthModal(true);
          }}
          onActivated={(sub) => {
            setProSub(sub);
            setShowProModal(false);
          }}
        />
      )}

      {showAuthModal && (
        <AuthModal
          promptReason={authPromptReason}
          onClose={() => {
            setShowAuthModal(false);
            setAuthPromptReason(null);
            setReturnToProAfterAuth(false);
          }}
          onSuccess={() => {
            setShowAuthModal(false);
            setAuthPromptReason(null);
          }}
        />
      )}

      {showAccountModal && authUser && (
        <AccountModal
          profile={authUser}
          subscription={proSub}
          onClose={() => setShowAccountModal(false)}
          onOpenProModal={() => {
            setShowAccountModal(false);
            setShowProModal(true);
          }}
          onSignedOut={() => {
            setShowAccountModal(false);
            setAuthUser(null);
            setProSub(null);
            clearProSubscription();
          }}
        />
      )}
    </div>
  );
}

export default App;
