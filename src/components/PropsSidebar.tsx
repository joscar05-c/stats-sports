import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Lock,
  PanelLeftOpen,
  Shield,
  SlidersHorizontal,
  User,
  X,
} from 'lucide-react';
import {
  fetchAvailableGameDates,
  fetchGameBettingContext,
  fetchGameBoxScore,
  fetchGamesByDate,
  type GameBettingContext,
} from '../services/basketballApi';
import { supabase } from '../lib/supabase';
import {
  buildGamePropsRecommendations,
  evaluatePropStatus,
  isHighProbabilityProp,
  PRO_CONFIDENCE_THRESHOLD,
  summarizeTeamRecent,
  type PropContextBadge,
  type PropRecommendation,
} from '../utils/betting';
import type { Game, PlayerGameStat } from '../types/database';
import { closeTopLayerDialog } from './ModalDialog';

export interface SelectedPropPayload {
  game: Game;
  prop: PropRecommendation;
  context: GameBettingContext;
}

interface PropsSidebarProps {
  leagueId: number;
  syncVersion: number;
  toggleSignal?: number;
  isPro: boolean;
  activePropId: string | null;
  onSelectProp: (selection: SelectedPropPayload) => void;
  onOpenProModal: () => void;
  onDesktopExpandedChange?: (expanded: boolean) => void;
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

function contextBadgeClass(tone: PropContextBadge['tone']): string {
  switch (tone) {
    case 'emerald':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35';
    case 'amber':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/35';
    case 'rose':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/35';
    case 'cyan':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/35';
    default:
      return 'bg-white/[0.05] text-slate-300 border-white/[0.1]';
  }
}

export function PropsSidebar({
  leagueId,
  syncVersion,
  toggleSignal = 0,
  isPro,
  activePropId,
  onSelectProp,
  onOpenProModal,
  onDesktopExpandedChange,
}: PropsSidebarProps) {
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [games, setGames] = useState<Game[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);

  const [focusedGameId, setFocusedGameId] = useState<number | null>(null);
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [desktopPinned, setDesktopPinned] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDesktopExpanded = desktopOpen || desktopPinned;

  useEffect(() => {
    onDesktopExpandedChange?.(isDesktopExpanded);
  }, [isDesktopExpanded, onDesktopExpandedChange]);

  const [contextsByGame, setContextsByGame] = useState<Record<number, GameBettingContext>>({});
  const [boxScoresByGame, setBoxScoresByGame] = useState<Record<number, PlayerGameStat[]>>({});
  const [loadingCtxId, setLoadingCtxId] = useState<number | null>(null);

  const [scopeFilter, setScopeFilter] = useState<'all' | 'team' | 'player'>('all');
  const [reliableOnly, setReliableOnly] = useState(true);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const inFlightRef = useRef<Set<number>>(new Set());
  const boxInFlightRef = useRef<Set<number>>(new Set());
  const mobileDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = mobileDialogRef.current;
    if (!mobileOpen || !dialog) return;

    if (!dialog.open) {
      dialog.showModal();
    }

    const handleClose = () => {
      dialog.returnValue = '';
      setMobileOpen(false);
    };

    const handleCancel = (e: Event) => {
      e.preventDefault();
      void closeTopLayerDialog(dialog);
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);

    let cleanupLightDismiss: (() => void) | undefined;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          void closeTopLayerDialog(dialog);
        }
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
      cleanupLightDismiss = () => {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
      cleanupLightDismiss?.();
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [mobileOpen]);

  const requestMobileClose = () => {
    const dialog = mobileDialogRef.current;
    if (dialog && dialog.open) {
      void closeTopLayerDialog(dialog);
    } else {
      setMobileOpen(false);
    }
  };

  // Respond cleanly to the Header "Props" button on both mobile and desktop
  useEffect(() => {
    if (toggleSignal <= 0) return;
    if (window.innerWidth < 768) {
      setMobileOpen((prev) => !prev);
    } else {
      const next = !(desktopOpen || desktopPinned);
      setDesktopOpen(next);
      setDesktopPinned(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleSignal]);

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

  // Lazy load betting context (and boxscore when live/final) for the focused game
  useEffect(() => {
    const isAnyDrawerVisible = desktopOpen || desktopPinned || mobileOpen;
    if (!focusedGame || !isAnyDrawerVisible) return;

    let active = true;
    if (!contextsByGame[focusedGame.id] && !inFlightRef.current.has(focusedGame.id)) {
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
    }

    if (
      focusedGame.status !== 'scheduled' &&
      !boxScoresByGame[focusedGame.id] &&
      !boxInFlightRef.current.has(focusedGame.id)
    ) {
      boxInFlightRef.current.add(focusedGame.id);
      fetchGameBoxScore(focusedGame.id)
        .then((rows) => {
          if (!active) return;
          setBoxScoresByGame((prev) => ({ ...prev, [focusedGame.id]: rows }));
        })
        .catch(() => {})
        .finally(() => {
          boxInFlightRef.current.delete(focusedGame.id);
        });
    }

    return () => {
      active = false;
    };
  }, [focusedGame, desktopOpen, desktopPinned, mobileOpen, contextsByGame, boxScoresByGame]);

  const focusedContext = focusedGame ? contextsByGame[focusedGame.id] ?? null : null;
  const focusedBoxStats = focusedGame ? boxScoresByGame[focusedGame.id] ?? [] : [];

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
      homeRecentGames: focusedContext.homeRecentGames,
      awayRecentGames: focusedContext.awayRecentGames,
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
    return list.toSorted((a, b) =>
      sortOrder === 'asc' ? a.confidence - b.confidence : b.confidence - a.confidence,
    );
  }, [gameProps, scopeFilter, reliableOnly, sortOrder]);

  const handleGameLogoSelect = (gameId: number) => {
    setFocusedGameId(gameId);
    setDesktopOpen(true);
    setDesktopPinned(true);
  };

  const renderLogoRail = (isMobileOverlay: boolean) => (
    <div className="w-[68px] shrink-0 h-full bg-[#060913] border-r border-white/[0.08] flex flex-col items-center py-2.5">
      <button
        type="button"
        onClick={() => {
          if (isMobileOverlay) {
            requestMobileClose();
          } else {
            const next = !(desktopOpen || desktopPinned);
            setDesktopOpen(next);
            setDesktopPinned(next);
          }
        }}
        title={desktopOpen || desktopPinned ? 'Ocultar panel de props' : 'Abrir panel de props'}
        className="w-10 h-9 rounded-xl bg-white/[0.05] border border-white/[0.1] hover:border-emerald-400/50 text-emerald-300 flex items-center justify-center transition-colors mb-2 shrink-0"
      >
        {isMobileOverlay || desktopOpen || desktopPinned ? (
          <ChevronLeft className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>

      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-2">
        Juegos
      </div>

      <div className="flex-1 w-full overflow-y-auto no-scrollbar px-1.5 space-y-2 pb-6">
        {loadingGames ? (
          [1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 rounded-xl bg-white/[0.04] animate-pulse" />
          ))
        ) : games.length === 0 ? (
          <div className="text-[10px] text-slate-500 text-center px-1 py-4">Sin juegos</div>
        ) : (
          games.map((g) => {
            const isSelected = focusedGame?.id === g.id;
            const isLive = g.status === 'live';
            const teamAccent = g.home_team.primary_color || '#10b981';
            return (
              <button
                key={g.id}
                type="button"
                onClick={() =>
                  isMobileOverlay ? setFocusedGameId(g.id) : handleGameLogoSelect(g.id)
                }
                title={`${g.away_team.abbreviation} @ ${g.home_team.abbreviation}`}
                style={
                  isSelected
                    ? {
                        borderColor: `${teamAccent}aa`,
                        boxShadow: `0 0 14px ${teamAccent}33`,
                      }
                    : undefined
                }
                className={`relative w-full py-2 px-1 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                  isSelected
                    ? 'bg-slate-800/80 text-white'
                    : 'bg-white/[0.03] border-white/[0.07] text-slate-400 hover:border-white/20 hover:bg-white/[0.06]'
                }`}
              >
                {isLive && (
                  <span
                    className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]"
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
                <span className="text-[9px] font-bold tracking-tight text-slate-200 tabular-nums leading-none">
                  {g.away_team.abbreviation}/{g.home_team.abbreviation}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  const renderDrawerContent = (isMobileOverlay: boolean) => {
    const awayColor = focusedGame?.away_team.primary_color || '#06b6d4';
    const homeColor = focusedGame?.home_team.primary_color || '#10b981';

    return (
      <div className="flex-1 h-full flex flex-col bg-[#070c17] min-w-0">
        {/* Drawer Header */}
        <div
          className="p-3.5 border-b border-white/[0.08] space-y-2.5 shrink-0"
          style={
            focusedGame
              ? {
                  background: `linear-gradient(125deg, ${awayColor}1f 0%, #070c17 50%, ${homeColor}22 100%)`,
                }
              : undefined
          }
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-xs font-black text-white tracking-wide uppercase truncate">
                Props &amp; Multiplicadores
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {dates.length > 0 && (
                <select
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-slate-950/90 border border-white/[0.12] rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-200 focus:outline-none focus:border-emerald-400"
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
                    requestMobileClose();
                  } else {
                    setDesktopOpen(false);
                    setDesktopPinned(false);
                  }
                }}
                className="p-1 rounded-lg bg-white/[0.05] border border-white/[0.1] text-slate-400 hover:text-white"
                aria-label="Cerrar panel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Focused Game Summary */}
          {focusedGame && (
            <div className="flex items-center justify-between gap-2 rounded-xl bg-black/40 border border-white/[0.09] px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                {focusedGame.away_team.logo_url && (
                  <img
                    src={focusedGame.away_team.logo_url}
                    alt={focusedGame.away_team.abbreviation}
                    className="w-5 h-5 object-contain"
                  />
                )}
                <span className="text-xs font-bold text-white truncate">
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
              <span className="text-[11px] font-bold text-emerald-300 tabular-nums shrink-0">
                {focusedGame.status === 'scheduled'
                  ? focusedGame.status_detail?.split('-').pop()?.trim() || 'Prog.'
                  : `${focusedGame.away_score}-${focusedGame.home_score}`}
              </span>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center justify-between gap-1.5 flex-wrap">
            <div className="inline-flex rounded-lg bg-black/40 border border-white/[0.08] p-0.5">
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
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${
                      active
                        ? 'bg-emerald-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
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
                className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                  reliableOnly
                    ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200'
                    : 'bg-white/[0.03] border-white/[0.08] text-slate-400'
                }`}
                title="Mostrar props con confianza >= 58% o todos"
              >
                {reliableOnly ? 'Confiables' : 'Todos %'}
              </button>
              <button
                type="button"
                onClick={() => setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-white/[0.04] border border-white/[0.1] text-slate-200 hover:border-emerald-400/50"
                title="Invertir orden por confianza"
              >
                <ArrowUpDown className="w-3 h-3 text-emerald-400" />
                {sortOrder === 'desc' ? 'Mayor→Menor' : 'Menor→Mayor'}
              </button>
            </div>
          </div>
        </div>

        {/* Props List */}
        <div className="flex-1 overflow-y-auto sb-scroller p-3 space-y-2.5 pb-16">
          {!isPro && (
            <button
              type="button"
              onClick={onOpenProModal}
              className="w-full rounded-xl sb-pro-pill hover:brightness-110 px-3 py-2 flex items-center justify-between gap-2 text-left transition-all"
            >
              <div className="min-w-0">
                <div className="text-[11px] font-black text-amber-200">
                  Picks {PRO_CONFIDENCE_THRESHOLD}%+ bloqueados
                </div>
                <div className="text-[10px] text-slate-200/80">
                  Desbloquea todos · $5 USD o S/ 19 Yape/Plin
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-lg bg-amber-400 text-slate-950 shrink-0">
                <Lock className="w-3 h-3" />
                PRO
              </span>
            </button>
          )}

          {!focusedGame ? (
            <div className="py-10 text-center text-xs text-slate-500">
              Selecciona un partido en el riel izquierdo.
            </div>
          ) : loadingCtxId === focusedGame.id && !focusedContext ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-white/[0.04] animate-pulse" />
              ))}
            </div>
          ) : visibleProps.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500">
              No hay props disponibles para este filtro en el partido seleccionado.
            </div>
          ) : (
            visibleProps.map((prop) => {
              const isActive = activePropId === prop.id;
              const locked = !isPro && isHighProbabilityProp(prop.confidence);
              const liveStatus = evaluatePropStatus(prop, focusedGame, focusedBoxStats);

              const stripeColor =
                prop.confidence >= 75
                  ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]'
                  : prop.confidence >= PRO_CONFIDENCE_THRESHOLD
                    ? 'bg-amber-400'
                    : 'bg-cyan-400';

              const confBarColor =
                prop.confidence >= 75
                  ? 'bg-emerald-400'
                  : prop.confidence >= PRO_CONFIDENCE_THRESHOLD
                    ? 'bg-amber-400'
                    : 'bg-cyan-400';

              const statusPillClass =
                liveStatus?.state === 'won'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : liveStatus?.state === 'lost'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : liveStatus?.state === 'live'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-white/[0.06] text-slate-300 border-white/[0.1]';

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
                    if (isMobileOverlay) requestMobileClose();
                  }}
                  className={`relative w-full text-left rounded-xl border p-2.5 pl-3.5 space-y-1.5 overflow-hidden transition-all ${
                    isActive
                      ? 'bg-emerald-500/10 border-emerald-400/60 shadow-[0_0_16px_rgba(16,185,129,0.18)]'
                      : 'sb-card hover:border-emerald-400/35'
                  }`}
                >
                  {/* Left Confidence Stripe */}
                  <span className={`absolute left-0 top-0 bottom-0 w-1 ${stripeColor}`} />

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                          prop.scope === 'team'
                            ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {prop.scope === 'team' ? 'Equipo' : 'Jugador'}
                      </span>
                      <span className="text-xs font-extrabold text-white truncate">
                        {prop.subjectName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-white/[0.06] text-amber-300 border border-white/[0.1]">
                        {prop.estimatedMultiplier.toFixed(2)}x
                      </span>
                      <span
                        className={`text-[11px] font-black ${
                          prop.confidence >= 75
                            ? 'text-emerald-300'
                            : prop.confidence >= PRO_CONFIDENCE_THRESHOLD
                              ? 'text-amber-300'
                              : 'text-cyan-300'
                        }`}
                      >
                        {prop.confidence}%
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400 truncate">{prop.marketLabel}</span>
                    {locked ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-200 bg-amber-500/15 border border-amber-500/35 px-2 py-0.5 rounded-md shrink-0">
                        <Lock className="w-3 h-3" />
                        PRO · Desbloquear
                      </span>
                    ) : (
                      <span
                        className={`text-[11px] font-black px-2 py-0.5 rounded-md tabular-nums shrink-0 ${
                          prop.pick === 'OVER'
                            ? 'sb-neon-over'
                            : prop.pick === 'UNDER'
                              ? 'sb-neon-under'
                              : 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                        }`}
                      >
                        {prop.pickLabel}
                      </span>
                    )}
                  </div>

                  {/* Confidence Bar */}
                  <div className="w-full h-1 rounded-full bg-white/[0.07] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${confBarColor}`}
                      style={{ width: `${prop.confidence}%` }}
                    />
                  </div>

                  {/* Engine Context Badges + Live Status */}
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    {!locked && liveStatus && (
                      <span
                        className={`text-[9px] font-black px-1.5 py-0.5 rounded border tabular-nums ${statusPillClass}`}
                      >
                        {liveStatus.label}
                      </span>
                    )}
                    {!locked ? (
                      prop.contextBadges.slice(0, 3).map((b, i) => (
                        <span
                          key={`${b.label}_${i}`}
                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border tabular-nums ${contextBadgeClass(b.tone)}`}
                        >
                          {b.label}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-amber-200/80">
                        Incluye cuotas, MPG, splits y B2B · Plan PRO
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Desktop Persistent Left Rail + Slide-out Drawer */}
      <aside className="hidden md:flex fixed left-0 top-[110px] bottom-0 z-30 shadow-2xl shadow-black/70">
        {renderLogoRail(false)}
        <div
          className={`h-full border-r border-white/[0.08] overflow-hidden transition-all duration-200 ${
            isDesktopExpanded ? 'w-[328px] lg:w-[368px] opacity-100' : 'w-0 opacity-0 border-r-0'
          }`}
        >
          <div className="w-[328px] lg:w-[368px] h-full">{renderDrawerContent(false)}</div>
        </div>
      </aside>

      {/* Mobile Floating Left Handle + Overlay Drawer */}
      <button
        type="button"
        aria-expanded={mobileOpen}
        aria-controls="mobile-props-drawer"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed left-0 top-[76px] z-30 flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded-r-xl bg-[#070d1b]/95 border border-l-0 border-emerald-500/40 text-emerald-300 shadow-lg backdrop-blur-md"
        aria-label="Abrir barra lateral de Props"
      >
        <PanelLeftOpen className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="text-[11px] font-black tracking-wide">Props</span>
      </button>

      {mobileOpen && (
        <dialog
          id="mobile-props-drawer"
          ref={mobileDialogRef}
          aria-label="Panel lateral de Props"
          className="md:hidden sb-drawer-dialog border-r border-white/[0.1] shadow-2xl"
          {...({ closedby: 'any' } as Record<string, string>)}
        >
          <div className="h-full w-full flex">
            {renderLogoRail(true)}
            {renderDrawerContent(true)}
          </div>
        </dialog>
      )}
    </>
  );
}
