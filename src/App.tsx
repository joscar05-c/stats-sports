import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Calendar,
  Download,
  Flame,
  Search,
  Trophy,
  WifiOff,
} from 'lucide-react';
import {
  fetchCurrentSeason,
  fetchLastSync,
  fetchLeagues,
} from './services/basketballApi';
import { GamesView } from './components/GamesView';
import { LeadersView } from './components/LeadersView';
import { CompareView } from './components/CompareView';
import { StandingsView } from './components/StandingsView';
import { ExploreView } from './components/ExploreView';
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
  const [fromCache, setFromCache] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Drill-down Modals
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<{
    team: Team;
    standing?: TeamStanding;
  } | null>(null);

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

  const handleSelectLeague = async (lg: League) => {
    setActiveLeague(lg);
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
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setTab(item.key)}
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

            {lastSync && !installPrompt && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-400">
                <Activity className="w-3 h-3 text-emerald-400" />
                Sync {new Date(lastSync.ran_at).toLocaleDateString('es-PE')}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
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
        ) : (
          <>
            {tab === 'games' && (
              <GamesView
                leagueId={activeLeague.id}
                onSelectGame={(game) => setSelectedGame(game)}
              />
            )}
            {tab === 'leaders' && (
              <LeadersView
                leagueId={activeLeague.id}
                seasonId={season.id}
                onSelectPlayer={(pid) => setSelectedPlayerId(pid)}
              />
            )}
            {tab === 'compare' && (
              <CompareView leagueId={activeLeague.id} seasonId={season.id} />
            )}
            {tab === 'standings' && (
              <StandingsView
                seasonId={season.id}
                onSelectTeam={(team, standing) => setSelectedTeam({ team, standing })}
              />
            )}
            {tab === 'explore' && (
              <ExploreView
                league={activeLeague}
                onSelectPlayer={(pid) => setSelectedPlayerId(pid)}
                onSelectTeam={(team) => setSelectedTeam({ team })}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[#0c1220]/95 backdrop-blur-md border-t border-slate-800/90 pb-safe">
        <div className="grid grid-cols-5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
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
          onClose={() => setSelectedGame(null)}
          onSelectPlayer={(pid) => setSelectedPlayerId(pid)}
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
          onClose={() => setSelectedPlayerId(null)}
        />
      )}
    </div>
  );
}

export default App;
