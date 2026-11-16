import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Calendar,
  Download,
  Flame,
  Lock,
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
import {
  getStoredSubscription,
  syncCurrentSubscriptionFromCloud,
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

  // Drill-down Modals & Active Main Prop View
  const [activePropView, setActivePropView] = useState<SelectedPropPayload | null>(null);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<{
    team: Team;
    standing?: TeamStanding;
  } | null>(null);

  // Subscription PRO ($5/month)
  const [proSub, setProSub] = useState<ProSubscriptionState | null>(() => getStoredSubscription());
  const [showProModal, setShowProModal] = useState(false);

  // Sync subscription state in real time without page reload
  useEffect(() => {
    let active = true;
    const syncPro = () => {
      syncCurrentSubscriptionFromCloud()
        .then((sub) => {
          if (active) setProSub(sub);
        })
        .catch(() => {});
    };

    void syncPro();
    window.addEventListener('focus', syncPro);
    const channel = supabase
      .channel('pro_sub_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pro_subscriptions' },
        syncPro,
      )
      .subscribe();

    return () => {
      active = false;
      window.removeEventListener('focus', syncPro);
      supabase.removeChannel(channel);
    };
  }, []);

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
    <div className="min-h-screen bg-[#090d16] text-slate-100 pb-24 md:pb-10">
      {/* Top Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#090d16]/85 border-b border-slate-800/80">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="CourtVision" className="w-8 h-8 rounded-lg" />
            <div>
              <div className="font-black text-base tracking-tight leading-none">
                Court<span className="text-orange-400">Vision</span>
              </div>
              <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                {season ? `${activeLeague?.short_name ?? 'NBA'} ${season.name}` : 'Stats Híbrido'}
              </div>
            </div>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
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
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                    active
                      ? 'bg-orange-500 text-slate-950'
                      : 'text-slate-300 hover:bg-slate-800/70'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {leagues.length > 1 && (
              <select
                value={activeLeague?.id ?? ''}
                onChange={(e) => {
                  const found = leagues.find((l) => l.id === Number(e.target.value));
                  if (found) handleSelectLeague(found);
                }}
                className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-200"
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
                className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-300 border border-orange-500/30 hover:bg-orange-500/25"
              >
                <Download className="w-3.5 h-3.5" />
                Instalar App
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowProModal(true)}
              className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition-colors ${
                proSub
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25'
                  : 'bg-slate-900 text-slate-200 border-slate-700 hover:border-slate-500'
              }`}
              title={proSub ? `PRO activo (${proSub.accessCode})` : 'Desbloquear Props 68%+ por $5 USD/mes'}
            >
              {proSub ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>PRO</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5 text-slate-400" />
                  <span>PRO $5/mes</span>
                </>
              )}
            </button>

            <button
              onClick={handleManualSync}
              disabled={syncing}
              title={
                lastSync
                  ? `Última sincronización: ${new Date(lastSync.ran_at).toLocaleString('es-PE')}. Clic para actualizar marcadores.`
                  : 'Sincronizar marcadores ahora'
              }
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-900/90 text-slate-300 border border-slate-800 hover:border-slate-700 hover:text-white disabled:opacity-60 transition-colors"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-emerald-400 ${syncing ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">
                {syncing
                  ? 'Sincronizando...'
                  : lastSync
                    ? `Sync ${new Date(lastSync.ran_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`
                    : 'Sincronizar'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Left Slide-Out Props Sidebar */}
      {activeLeague && (
        <PropsSidebar
          leagueId={activeLeague.id}
          syncVersion={syncVersion}
          isPro={Boolean(proSub)}
          activePropId={activePropView?.prop.id ?? null}
          onSelectProp={(selection) => setActivePropView(selection)}
          onOpenProModal={() => setShowProModal(true)}
        />
      )}

      {/* Main Content */}
      <div className={activeLeague ? 'md:pl-[66px]' : ''}>
      <main className="max-w-5xl mx-auto px-4 pt-4">
        {fromCache && (
          <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            Mostrando datos guardados en caché local (modo sin conexión).
          </div>
        )}

        {loadingInit ? (
          <div className="space-y-3 pt-4">
            <div className="h-12 rounded-xl bg-slate-900/60 animate-pulse" />
            <div className="h-44 rounded-2xl bg-slate-900/60 animate-pulse" />
            <div className="h-44 rounded-2xl bg-slate-900/60 animate-pulse" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-5 text-sm text-rose-200">
            <div className="font-bold mb-1">No se pudo cargar Supabase</div>
            <div className="text-xs text-rose-300/90">{errorMsg}</div>
          </div>
        ) : !activeLeague || !season ? (
          <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-8 text-center text-sm text-slate-400">
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
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[#0c1220]/95 backdrop-blur-md border-t border-slate-800/90 pb-safe">
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
                  active ? 'text-orange-400' : 'text-slate-400 hover:text-slate-200'
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
          subscription={proSub}
          onClose={() => setShowProModal(false)}
          onActivated={(sub) => {
            setProSub(sub);
            setShowProModal(false);
          }}
          onDeactivated={() => {
            setProSub(null);
            setShowProModal(false);
          }}
        />
      )}
    </div>
  );
}

export default App;
