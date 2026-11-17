import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Calendar,
  Download,
  Flame,
  Lock,
  LogIn,
  PanelLeft,
  RefreshCw,
  Search,
  ShieldCheck,
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

  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await triggerCloudSync(2, 3);
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
    const sn = await fetchCurrentSeason(lg.id);
    setSeason(sn);
  };

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const navItems: Array<{ key: TabKey; label: string; icon: typeof Calendar }> = [
    { key: 'games', label: 'Partidos', icon: Calendar },
    { key: 'leaders', label: 'Líderes', icon: Flame },
    { key: 'compare', label: 'Comparar', icon: ArrowLeftRight },
    { key: 'standings', label: 'Posiciones', icon: Trophy },
    { key: 'explore', label: 'Explorar', icon: Search },
  ];

  return (
    <div className="min-h-screen text-slate-100 pb-24 md:pb-10">
      {/* Sportsbook Command Header */}
      <header className="sticky top-0 z-40 sb-glass-header">
        <div className="sb-header-accent" />

        {/* Row 1: Brand Identity + User/Account & Utility Controls */}
        <div className="max-w-7xl mx-auto px-3 sm:px-5 h-16 flex items-center justify-between gap-3">
          {/* Left Brand Block (never squeezes or overlaps) */}
          <button
            type="button"
            onClick={() => {
              setActivePropView(null);
              setTab('games');
            }}
            className="flex items-center gap-2.5 sm:gap-3 shrink-0 text-left group"
          >
            <div className="relative shrink-0 p-0.5 rounded-xl bg-gradient-to-br from-emerald-400/35 via-cyan-400/20 to-transparent shadow-[0_0_20px_rgba(16,185,129,0.22)] group-hover:shadow-[0_0_24px_rgba(16,185,129,0.38)] transition-shadow">
              <img
                src="/icon.svg"
                alt="CourtVision"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-[10px] block"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#060a14]" />
            </div>

            <div className="shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-black text-lg sm:text-xl tracking-tight leading-none text-white">
                  Court<span className="text-emerald-400">Vision</span>
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[9px] font-black tracking-widest uppercase px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  <Activity className="w-2.5 h-2.5 animate-pulse" />
                  LIVE ODDS &amp; PROPS
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 font-semibold tracking-wide">
                <span>
                  {season ? `${activeLeague?.short_name ?? 'NBA'} ${season.name}` : 'Analytics Pro'}
                </span>
                <span className="hidden md:inline text-slate-600">•</span>
                <span className="hidden md:inline text-cyan-300/90">
                  Terminal de Cuotas &amp; Estadísticas
                </span>
              </div>
            </div>
          </button>

          {/* Right Controls Cluster */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {activeLeague && (
              <button
                type="button"
                onClick={() => setSidebarToggleTick((t) => t + 1)}
                className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-xl bg-emerald-500/12 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors whitespace-nowrap"
                title="Abrir / fijar barra lateral de Props"
              >
                <PanelLeft className="w-3.5 h-3.5 shrink-0" />
                <span>Props</span>
              </button>
            )}

            {leagues.length > 1 && (
              <select
                value={activeLeague?.id ?? ''}
                onChange={(e) => {
                  const found = leagues.find((l) => l.id === Number(e.target.value));
                  if (found) handleSelectLeague(found);
                }}
                className="bg-slate-900/90 border border-white/[0.12] rounded-xl px-2 py-1.5 text-xs font-bold text-slate-200 whitespace-nowrap"
              >
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.short_name}
                  </option>
                ))}
              </select>
            )}

            {installPrompt && (
              <button
                onClick={handleInstallPwa}
                className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-xl bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                Instalar
              </button>
            )}

            {authUser ? (
              <button
                type="button"
                onClick={() => setShowAccountModal(true)}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 sm:px-2.5 py-1.5 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-700/80 text-slate-100 transition-colors whitespace-nowrap"
                title={`Cuenta: ${authUser.email}`}
              >
                {authUser.avatarUrl ? (
                  <img
                    src={authUser.avatarUrl}
                    alt={authUser.fullName || authUser.email}
                    className="w-4 h-4 rounded-full object-cover border border-emerald-400/40 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[9px] font-black inline-flex items-center justify-center uppercase shrink-0">
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
                className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-xl bg-slate-900/95 hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition-colors disabled:opacity-60 whitespace-nowrap"
                title="Iniciar sesión o crear cuenta gratis"
              >
                <LogIn className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Entrar</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowProModal(true)}
              className={`inline-flex items-center gap-1.5 text-[11px] font-black px-2.5 sm:px-3 py-1.5 rounded-xl border transition-all whitespace-nowrap ${
                proSub
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50 shadow-[0_0_14px_rgba(16,185,129,0.25)]'
                  : 'sb-pro-pill shadow-[0_0_16px_rgba(245,158,11,0.16)] hover:brightness-110'
              }`}
              title={
                proSub
                  ? `PRO activo (${proSub.accessCode})`
                  : 'Desbloquear Props 68%+ por $5 USD o S/ 19 PEN'
              }
            >
              {proSub ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>PRO ACTIVO</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span>
                    PRO <span className="hidden sm:inline">· $5 / S/ 19</span>
                  </span>
                </>
              )}
            </button>

            <button
              onClick={handleManualSync}
              disabled={syncing}
              title={
                lastSync
                  ? `Última sincronización: ${new Date(lastSync.ran_at).toLocaleString('es-PE')}. Clic para actualizar.`
                  : 'Sincronizar marcadores ahora'
              }
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 sm:px-2.5 py-1.5 rounded-xl bg-white/[0.04] text-slate-300 border border-white/[0.09] hover:border-white/20 hover:text-white disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-emerald-400 shrink-0 ${syncing ? 'animate-spin' : ''}`}
              />
              <span className="hidden lg:inline tabular-nums">
                {syncing
                  ? 'Sincronizando...'
                  : lastSync
                    ? `${new Date(lastSync.ran_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`
                    : 'Sync'}
              </span>
            </button>
          </div>
        </div>

        {/* Row 2: Dedicated Desktop Navigation Rail (zero logo/button collisions at all widths) */}
        <div className="hidden md:block border-t border-white/[0.06] bg-[#040812]/80">
          <div className="max-w-7xl mx-auto px-5 h-11 flex items-center justify-between gap-4">
            <nav className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = !activePropView && tab === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      setActivePropView(null);
                      setTab(item.key);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-gradient-to-r from-emerald-400 to-cyan-400 text-slate-950 shadow-[0_4px_14px_rgba(16,185,129,0.28)]'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="hidden lg:flex items-center gap-2 text-[11px] font-semibold text-slate-400 shrink-0">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/[0.07]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Picks ≥ 68%</span>
                <span className={proSub ? 'text-emerald-300 font-bold' : 'text-amber-300 font-bold'}>
                  {proSub ? 'Desbloqueados' : 'PRO'}
                </span>
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Left Slide-Out Props Sidebar */}
      {activeLeague && (
        <PropsSidebar
          leagueId={activeLeague.id}
          syncVersion={syncVersion}
          toggleSignal={sidebarToggleTick}
          isPro={Boolean(proSub)}
          activePropId={activePropView?.prop.id ?? null}
          onSelectProp={(selection) => setActivePropView(selection)}
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
        <main className="max-w-6xl mx-auto px-3 sm:px-4 pt-4">
          {fromCache && (
            <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
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
          ) : activePropView ? (
            <PropAnalysisView
              game={activePropView.game}
              prop={activePropView.prop}
              context={activePropView.context}
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
                  onSelectPlayer={(pid) => setSelectedPlayerId(pid)}
                  onSelectTeam={(team) => setSelectedTeam({ team })}
                />
              )}
              {tab === 'compare' && (
                <CompareView
                  key={`compare_${activeLeague.id}_${syncVersion}`}
                  leagueId={activeLeague.id}
                  seasonId={season.id}
                />
              )}
              {tab === 'standings' && (
                <StandingsView
                  key={`standings_${season.id}_${syncVersion}`}
                  seasonId={season.id}
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
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 sb-glass-header border-t border-b-0 pb-safe">
        <div className="grid grid-cols-5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = !activePropView && tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => {
                  setActivePropView(null);
                  setTab(item.key);
                }}
                className={`flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-bold transition-colors ${
                  active ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Drill-down Modals */}
      {selectedGame && (
        <GameDetailModal
          game={selectedGame}
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
