import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  PanelLeftOpen,
  Shield,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import {
  fetchAvailableGameDates,
  fetchGameBettingContext,
  fetchGamesByDate,
  type GameBettingContext,
} from '../services/basketballApi';
import { supabase } from '../lib/supabase';
import {
  buildGamePropsRecommendations,
  summarizeTeamRecent,
  type PropRecommendation,
} from '../utils/betting';
import type { Game } from '../types/database';

export interface SelectedPropPayload {
  game: Game;
  prop: PropRecommendation;
  context: GameBettingContext;
}

interface PropsSidebarProps {
  leagueId: number;
  syncVersion: number;
  activePropId: string | null;
  onSelectProp: (selection: SelectedPropPayload) => void;
}

function formatDateOption(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const dayMonth = dt.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }).replace('.', '');
  if (diffDays === 0) return `Hoy · ${dayMonth}`;
  if (diffDays === -1) return `Ayer · ${dayMonth}`;
  if (diffDays === 1) return `Mañana · ${dayMonth}`;
  return `${dt.toLocaleDateString('es-PE', { weekday: 'short' }).replace('.', '').toUpperCase()} · ${dayMonth}`;
}

export function PropsSidebar({
  leagueId,
  syncVersion,
  activePropId,
  onSelectProp,
}: PropsSidebarProps) {
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [games, setGames] = useState<Game[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);

  const [focusedGameId, setFocusedGameId] = useState<number | null>(null);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [desktopPinned, setDesktopPinned] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [contextsByGame, setContextsByGame] = useState<Record<number, GameBettingContext>>({});
  const [loadingCtxId, setLoadingCtxId] = useState<number | null>(null);

  const [scopeFilter, setScopeFilter] = useState<'all' | 'team' | 'player'>('all');
  const [reliableOnly, setReliableOnly] = useState(true);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const inFlightRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    let active = true;
    fetchAvailableGameDates(leagueId)
      .then((avail) => {
        if (!active) return;
        setDates(avail);
        if (avail.length > 0) {
          const now = new Date();
          const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          const best = avail.includes(todayIso) ? todayIso : avail[0];
          setSelectedDate(best);
        } else {
          setLoadingGames(false);
        }
      })
      .catch(() => {
        if (active) setLoadingGames(false);
      });
    return () => {
      active = false;
    };
  }, [leagueId, syncVersion]);

  useEffect(() => {
    if (!selectedDate) return;
    let active = true;
    setLoadingGames(true);

    const loadGamesSilently = async () => {
      try {
        const res = await fetchGamesByDate(leagueId, selectedDate);
        if (!active) return;
        setGames(res.data);
        if (res.data.length > 0) {
          setFocusedGameId((prev) =>
            prev && res.data.some((g) => g.id === prev) ? prev : res.data[0].id,
          );
        }
      } catch {
        // Ignore transient network errors
      }
    };

    fetchGamesByDate(leagueId, selectedDate)
      .then((res) => {
        if (!active) return;
        setGames(res.data);
        if (res.data.length > 0) {
          setFocusedGameId((prev) =>
            prev && res.data.some((g) => g.id === prev) ? prev : res.data[0].id,
          );
        } else {
          setFocusedGameId(null);
        }
      })
      .finally(() => {
        if (active) setLoadingGames(false);
      });

    const interval = window.setInterval(loadGamesSilently, 15000);
    const channel = supabase
      .channel(`sidebar_games_${leagueId}_${selectedDate}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
        void loadGamesSilently();
      })
      .subscribe();

    return () => {
      active = false;
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [leagueId, selectedDate, syncVersion]);

  const focusedGame = useMemo(
    () => games.find((g) => g.id === focusedGameId) ?? games[0] ?? null,
    [games, focusedGameId],
  );

  // Lazy load betting context for the focused game when the sidebar opens or hovered game changes
  useEffect(() => {
    const isAnyDrawerVisible = desktopOpen || desktopPinned || mobileOpen;
    if (!focusedGame || !isAnyDrawerVisible) return;
    if (contextsByGame[focusedGame.id] || inFlightRef.current.has(focusedGame.id)) return;

    let active = true;
    inFlightRef.current.add(focusedGame.id);
    setLoadingCtxId(focusedGame.id);

    fetchGameBettingContext(focusedGame)
      .then((ctx) => {
        if (!active) return;
        setContextsByGame((prev) => ({ ...prev, [focusedGame.id]: ctx }));
      })
      .catch(() => {})
      .finally(() => {
        inFlightRef.current.delete(focusedGame.id);
        if (active) setLoadingCtxId((curr) => (curr === focusedGame.id ? null : curr));
      });

    return () => {
      active = false;
    };
  }, [focusedGame, desktopOpen, desktopPinned, mobileOpen, contextsByGame]);

  const focusedContext = focusedGame ? contextsByGame[focusedGame.id] ?? null : null;

  const gameProps = useMemo(() => {
    if (!focusedGame || !focusedContext) return [];
    const homeRecent = summarizeTeamRecent(focusedGame.home_team_id, focusedContext.homeRecentGames);
    const awayRecent = summarizeTeamRecent(focusedGame.away_team_id, focusedContext.awayRecentGames);
    return buildGamePropsRecommendations({
      game: focusedGame,
      homeStanding: focusedContext.homeStanding,
      awayStanding: focusedContext.awayStanding,
      homeTeamAvg: focusedContext.homeTeamAvg,
      awayTeamAvg: focusedContext.awayTeamAvg,
      homeRecent,
      awayRecent,
      keyPlayers: focusedContext.keyPlayers,
      playerRecentLogs: focusedContext.playerRecentLogs ?? [],
    });
  }, [focusedGame, focusedContext]);

  const visibleProps = useMemo(() => {
    let list = gameProps.filter((p) => scopeFilter === 'all' || p.scope === scopeFilter);
    const reliable = list.filter((p) => p.confidence >= 58);
    if (reliableOnly && reliable.length > 0) {
      list = reliable;
    }
    return [...list].sort((a, b) =>
      sortOrder === 'asc' ? a.confidence - b.confidence : b.confidence - a.confidence,
    );
  }, [gameProps, scopeFilter, reliableOnly, sortOrder]);

  const handleGameLogoEnter = (gameId: number) => {
    setFocusedGameId(gameId);
    setDesktopOpen(true);
  };

  const handleGameLogoClick = (gameId: number) => {
    setFocusedGameId(gameId);
    setDesktopOpen(true);
    setDesktopPinned(true);
  };

  const renderLogoRail = (isMobileOverlay: boolean) => (
    <div className="w-[66px] shrink-0 h-full bg-[#090d16] border-r border-slate-800/90 flex flex-col items-center py-2.5">
      {/* Rail Header Toggle */}
      <button
        type="button"
        onClick={() => {
          if (isMobileOverlay) {
            setMobileOpen(false);
          } else {
            const next = !(desktopOpen || desktopPinned);
            setDesktopOpen(next);
            setDesktopPinned(next);
          }
        }}
        title={desktopOpen || desktopPinned ? 'Ocultar panel de props' : 'Deslizar props'}
        className="w-10 h-9 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-600 text-slate-300 flex items-center justify-center transition-colors mb-2 shrink-0"
      >
        {isMobileOverlay || desktopOpen || desktopPinned ? (
          <ChevronLeft className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>

      <div className="text-[9px] font-semibold uppercase tracking-widest text-slate-500 mb-2">
        Juegos
      </div>

      {/* Scrollable Game Logos */}
      <div className="flex-1 w-full overflow-y-auto no-scrollbar px-1.5 space-y-2 pb-6">
        {loadingGames ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 rounded-xl bg-slate-900/70 animate-pulse" />
          ))
        ) : games.length === 0 ? (
          <div className="text-[10px] text-slate-500 text-center px-1 py-4">Sin juegos</div>
        ) : (
          games.map((g) => {
            const isSelected = focusedGame?.id === g.id;
            const isLive = g.status === 'live';
            return (
              <button
                key={g.id}
                type="button"
                onMouseEnter={() => !isMobileOverlay && handleGameLogoEnter(g.id)}
                onClick={() =>
                  isMobileOverlay ? setFocusedGameId(g.id) : handleGameLogoClick(g.id)
                }
                title={`${g.away_team.abbreviation} @ ${g.home_team.abbreviation}`}
                className={`relative w-full py-2 px-1 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                  isSelected
                    ? 'bg-slate-800/90 border-slate-500 text-white'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-400 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                {isLive && (
                  <span
                    className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400"
                    title="En vivo"
                  />
                )}
                <div className="flex items-center justify-center -space-x-1.5">
                  {g.away_team.logo_url ? (
                    <img
                      src={g.away_team.logo_url}
                      alt={g.away_team.abbreviation}
                      className="w-6 h-6 object-contain drop-shadow"
                    />
                  ) : (
                    <span className="text-[9px] font-bold">{g.away_team.abbreviation}</span>
                  )}
                  {g.home_team.logo_url ? (
                    <img
                      src={g.home_team.logo_url}
                      alt={g.home_team.abbreviation}
                      className="w-6 h-6 object-contain drop-shadow"
                    />
                  ) : (
                    <span className="text-[9px] font-bold">{g.home_team.abbreviation}</span>
                  )}
                </div>
                <span className="text-[9px] font-semibold tracking-tight text-slate-300 tabular-nums leading-none">
                  {g.away_team.abbreviation}/{g.home_team.abbreviation}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const renderDrawerContent = (isMobileOverlay: boolean) => (
    <div className="flex-1 h-full flex flex-col bg-[#0c111d] min-w-0">
      {/* Drawer Header */}
      <div className="p-3.5 border-b border-slate-800/90 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-xs font-bold text-slate-200 tracking-wide uppercase truncate">
              Props del Partido
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {dates.length > 0 && (
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-200 focus:outline-none focus:border-slate-500"
              >
                {dates.slice(0, 14).map((d) => (
                  <option key={d} value={d}>
                    {formatDateOption(d)}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => {
                if (isMobileOverlay) {
                  setMobileOpen(false);
                } else {
                  setDesktopOpen(false);
                  setDesktopPinned(false);
                }
              }}
              className="p-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100"
              aria-label="Cerrar panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Focused Game Summary */}
        {focusedGame && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/90 border border-slate-800 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              {focusedGame.away_team.logo_url && (
                <img
                  src={focusedGame.away_team.logo_url}
                  alt={focusedGame.away_team.abbreviation}
                  className="w-5 h-5 object-contain"
                />
              )}
              <span className="text-xs font-bold text-slate-100 truncate">
                {focusedGame.away_team.short_name} @ {focusedGame.home_team.short_name}
              </span>
              {focusedGame.home_team.logo_url && (
                <img
                  src={focusedGame.home_team.logo_url}
                  alt={focusedGame.home_team.abbreviation}
                  className="w-5 h-5 object-contain"
                />
              )}
            </div>
            <span className="text-[11px] font-semibold text-slate-400 tabular-nums shrink-0">
              {focusedGame.status === 'scheduled'
                ? focusedGame.status_detail?.split('-').pop()?.trim() || 'Prog.'
                : `${focusedGame.away_score}-${focusedGame.home_score}`}
            </span>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center justify-between gap-1.5 flex-wrap">
          <div className="inline-flex rounded-lg bg-slate-900 border border-slate-800 p-0.5">
            {(
              [
                { key: 'all', label: 'Todos', icon: null },
                { key: 'team', label: 'Equipo', icon: Shield },
                { key: 'player', label: 'Jugador', icon: User },
              ] as const
            ).map((f) => {
              const Icon = f.icon;
              const active = scopeFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setScopeFilter(f.key)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                    active
                      ? 'bg-slate-200 text-slate-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {Icon && <Icon className="w-3 h-3" />}
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setReliableOnly((r) => !r)}
              className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${
                reliableOnly
                  ? 'bg-slate-800 border-slate-600 text-slate-100'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400'
              }`}
              title="Mostrar props con confianza >= 58% o todos"
            >
              {reliableOnly ? 'Confiables' : 'Todos %'}
            </button>
            <button
              type="button"
              onClick={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-slate-900 border border-slate-800 text-slate-300 hover:border-slate-600"
              title="Invertir orden por confianza"
            >
              <ArrowUpDown className="w-3 h-3" />
              {sortOrder === 'asc' ? 'Menor→Mayor' : 'Mayor→Menor'}
            </button>
          </div>
        </div>
      </div>

      {/* Props List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 pb-16">
        {!focusedGame ? (
          <div className="py-10 text-center text-xs text-slate-500">
            Selecciona un partido en el riel izquierdo.
          </div>
        ) : loadingCtxId === focusedGame.id && !focusedContext ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-slate-900/70 animate-pulse" />
            ))}
          </div>
        ) : visibleProps.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">
            No hay props disponibles para este filtro en el partido seleccionado.
          </div>
        ) : (
          visibleProps.map((prop) => {
            const isActive = activePropId === prop.id;
            return (
              <button
                key={prop.id}
                type="button"
                onClick={() => {
                  if (!focusedGame || !focusedContext) return;
                  onSelectProp({
                    game: focusedGame,
                    prop,
                    context: focusedContext,
                  });
                  if (isMobileOverlay) setMobileOpen(false);
                }}
                className={`w-full text-left rounded-xl border p-2.5 space-y-1.5 transition-all ${
                  isActive
                    ? 'bg-slate-800/90 border-slate-400'
                    : 'bg-slate-900/75 border-slate-800/90 hover:bg-slate-800/60 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/70 shrink-0">
                      {prop.scope === 'team' ? 'Equipo' : 'Jugador'}
                    </span>
                    <span className="text-xs font-bold text-slate-100 truncate">
                      {prop.subjectName}
                    </span>
                  </div>
                  <span className="text-[11px] font-bold text-slate-200 tabular-nums shrink-0">
                    {prop.confidence}%
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400 truncate">{prop.marketLabel}</span>
                  <span className="text-[11px] font-bold text-slate-100 bg-slate-950/90 border border-slate-700/80 px-2 py-0.5 rounded-md tabular-nums shrink-0">
                    {prop.pickLabel}
                  </span>
                </div>

                <div className="text-[10px] text-slate-400 truncate tabular-nums">
                  {prop.marketLineText}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const isDesktopExpanded = desktopOpen || desktopPinned;

  return (
    <>
      {/* Desktop Persistent Left Rail + Slide-out Drawer */}
      <aside
        onMouseLeave={() => {
          if (!desktopPinned) setDesktopOpen(false);
        }}
        className="hidden md:flex fixed left-0 top-14 bottom-0 z-40 shadow-2xl shadow-black/60"
      >
        {renderLogoRail(false)}
        <div
          className={`h-full border-r border-slate-800/90 overflow-hidden transition-all duration-200 ${
            isDesktopExpanded ? 'w-[340px] lg:w-[370px] opacity-100' : 'w-0 opacity-0 border-r-0'
          }`}
        >
          <div className="w-[340px] lg:w-[370px] h-full">{renderDrawerContent(false)}</div>
        </div>
      </aside>

      {/* Mobile Floating Left Handle + Overlay Drawer */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed left-0 top-16 z-40 flex items-center gap-1.5 pl-2 pr-2.5 py-2 rounded-r-xl bg-slate-900/95 border border-l-0 border-slate-700/90 text-slate-200 shadow-lg backdrop-blur-md"
        aria-label="Abrir barra lateral de Props"
      >
        <PanelLeftOpen className="w-3.5 h-3.5 text-slate-300" />
        <span className="text-[11px] font-bold tracking-wide">Props</span>
      </button>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="h-full w-[92vw] max-w-[400px] flex border-r border-slate-800 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {renderLogoRail(true)}
            {renderDrawerContent(true)}
          </div>
        </div>
      )}
    </>
  );
}
