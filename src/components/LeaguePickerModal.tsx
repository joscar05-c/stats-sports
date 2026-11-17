import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Globe2, Search, Star, Trophy, X } from 'lucide-react';
import type { League } from '../types/database';
import { ModalDialog } from './ModalDialog';

export type LeagueCategoryKey = 'cups' | 'southamerica' | 'europe' | 'other';

const CUP_LEAGUE_SLUGS = new Set([
  'champions-league',
  'libertadores',
  'sudamericana',
]);

const EURO_LEAGUE_SLUGS = new Set([
  'premier-league',
  'laliga',
  'serie-a',
  'bundesliga',
  'ligue-1',
]);

const SOUTH_AMERICA_SLUGS = new Set([
  'argentina',
  'brasileirao',
  'colombia',
  'chile',
  'uruguay',
  'paraguay',
  'peru',
  'ecuador',
  'bolivia',
  'venezuela',
]);

export function classifyLeagueCategory(league: League): LeagueCategoryKey {
  if (CUP_LEAGUE_SLUGS.has(league.slug) || league.external_id?.startsWith('conmebol.') || league.external_id?.startsWith('uefa.')) {
    return 'cups';
  }
  if (EURO_LEAGUE_SLUGS.has(league.slug)) return 'europe';
  if (SOUTH_AMERICA_SLUGS.has(league.slug)) return 'southamerica';
  return 'other';
}

function normalizeSearchText(val: string): string {
  return val
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

interface LeagueSection {
  key: 'favorites' | LeagueCategoryKey;
  label: string;
  items: League[];
}

interface LeaguePickerModalProps {
  leagues: League[];
  activeLeague: League;
  favoriteIds: number[];
  onToggleFavorite: (leagueId: number) => void;
  onSelectLeague: (league: League) => void;
  onClose: () => void;
}

export function LeaguePickerModal({
  leagues,
  activeLeague,
  favoriteIds,
  onToggleFavorite,
  onSelectLeague,
  onClose,
}: LeaguePickerModalProps) {
  const [query, setQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'favorites' | LeagueCategoryKey>('all');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const sortedLeagues = useMemo(() => {
    return [...leagues].sort((a, b) => {
      const ca = (a.country || a.short_name).localeCompare(b.country || b.short_name, 'es');
      if (ca !== 0) return ca;
      return a.name.localeCompare(b.name, 'es');
    });
  }, [leagues]);

  const counts = useMemo(() => {
    let fav = 0;
    let cups = 0;
    let sa = 0;
    let eu = 0;
    let other = 0;
    for (const lg of leagues) {
      if (favoriteSet.has(lg.id)) fav++;
      const cat = classifyLeagueCategory(lg);
      if (cat === 'cups') cups++;
      else if (cat === 'southamerica') sa++;
      else if (cat === 'europe') eu++;
      else other++;
    }
    return { all: leagues.length, fav, cups, sa, eu, other };
  }, [leagues, favoriteSet]);

  const normalizedQuery = useMemo(() => normalizeSearchText(query), [query]);

  const filteredLeagues = useMemo(() => {
    return sortedLeagues.filter((lg) => {
      if (filterTab === 'favorites' && !favoriteSet.has(lg.id)) return false;
      if (filterTab !== 'all' && filterTab !== 'favorites' && classifyLeagueCategory(lg) !== filterTab) {
        return false;
      }
      if (!normalizedQuery) return true;
      const hay = normalizeSearchText(
        `${lg.short_name} ${lg.name} ${lg.country ?? ''} ${lg.slug}`,
      );
      return hay.includes(normalizedQuery);
    });
  }, [sortedLeagues, filterTab, favoriteSet, normalizedQuery]);

  const sections = useMemo<LeagueSection[]>(() => {
    if (filterTab === 'favorites') {
      return filteredLeagues.length > 0
        ? [{ key: 'favorites', label: 'Favoritas fijadas', items: filteredLeagues }]
        : [];
    }

    const out: LeagueSection[] = [];
    if (filterTab === 'all' && !normalizedQuery) {
      const favItems = filteredLeagues.filter((lg) => favoriteSet.has(lg.id));
      if (favItems.length > 0) {
        out.push({ key: 'favorites', label: 'Favoritas', items: favItems });
      }
    }

    const buckets: Record<LeagueCategoryKey, League[]> = {
      cups: [],
      southamerica: [],
      europe: [],
      other: [],
    };
    for (const lg of filteredLeagues) {
      buckets[classifyLeagueCategory(lg)].push(lg);
    }

    if (buckets.cups.length > 0) {
      out.push({ key: 'cups', label: 'Copas Regionales e Internacionales', items: buckets.cups });
    }
    if (buckets.southamerica.length > 0) {
      out.push({ key: 'southamerica', label: 'América del Sur — Ligas por País', items: buckets.southamerica });
    }
    if (buckets.europe.length > 0) {
      out.push({ key: 'europe', label: 'Europa — Ligas por País', items: buckets.europe });
    }
    if (buckets.other.length > 0) {
      out.push({ key: 'other', label: 'Otras Competiciones', items: buckets.other });
    }
    return out;
  }, [filteredLeagues, filterTab, normalizedQuery, favoriteSet]);

  const tabs = useMemo(() => {
    const list: Array<{ key: 'all' | 'favorites' | LeagueCategoryKey; label: string }> = [
      { key: 'all', label: `Todas (${counts.all})` },
    ];
    if (counts.fav > 0) list.push({ key: 'favorites', label: `Favoritas (${counts.fav})` });
    if (counts.cups > 0) list.push({ key: 'cups', label: `Copas (${counts.cups})` });
    if (counts.sa > 0) list.push({ key: 'southamerica', label: `Sudamérica (${counts.sa})` });
    if (counts.eu > 0) list.push({ key: 'europe', label: `Europa (${counts.eu})` });
    if (counts.other > 0) list.push({ key: 'other', label: `Otras (${counts.other})` });
    return list;
  }, [counts]);

  return (
    <ModalDialog
      onClose={onClose}
      ariaLabelledBy="league-picker-title"
      maxWidthCss="44rem"
      className="bg-[#12151c] rounded-2xl overflow-hidden shadow-2xl"
    >
      {(requestClose) => (
        <div className="flex flex-col max-h-[85dvh] sm:max-h-[82vh]">
          {/* Header + Instant Search */}
          <div className="p-4 sm:p-5 border-b border-white/[0.08] bg-[#0e1117] space-y-3 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center shrink-0">
                  <Globe2 className="w-4 h-4 text-slate-200" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="league-picker-title"
                    className="text-sm sm:text-base font-bold text-white truncate"
                  >
                    Catálogo de Ligas y Copas
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    {filteredLeagues.length} de {leagues.length} competiciones · Fija con ★ para acceso rápido
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={requestClose}
                aria-label="Cerrar catálogo de ligas"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="relative">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por país, liga o copa (ej. Perú, Libertadores, Brasil)..."
                aria-label="Buscar liga o país"
                className="w-full pl-9 pr-9 py-2 rounded-lg bg-[#12151c] border border-white/[0.12] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-white/[0.28]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Limpiar búsqueda"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Single-row region filter tabs */}
            <div
              role="tablist"
              aria-label="Filtrar competiciones por región"
              className="flex items-center gap-1.5 overflow-x-auto no-scrollbar sb-scroll-fade-x pt-0.5"
            >
              {tabs.map((t) => {
                const isSelected = filterTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={(e) => {
                      setFilterTab(t.key);
                      e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                    }}
                    className={`shrink-0 px-3 py-1 rounded-md text-xs font-semibold border transition-colors ${
                      isSelected
                        ? 'cv-tab-active border-transparent'
                        : 'bg-[#12151c] text-slate-300 border-white/[0.08] hover:text-white hover:border-white/[0.18]'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scrollable Organized Directory */}
          <div className="flex-1 overflow-y-auto sb-scroller p-4 sm:p-5 space-y-4">
            {sections.length === 0 ? (
              <div className="rounded-xl bg-[#0e1117] border border-white/[0.08] p-8 text-center space-y-2">
                <Trophy className="w-6 h-6 text-slate-500 mx-auto" aria-hidden="true" />
                <div className="text-sm font-semibold text-slate-200">
                  No se encontraron competiciones
                </div>
                <p className="text-xs text-slate-400">
                  No hay resultados para &ldquo;{query}&rdquo; en esta vista.
                </p>
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setFilterTab('all');
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.08] text-white hover:bg-white/[0.14] transition-colors"
                  >
                    Ver todas las ligas
                  </button>
                )}
              </div>
            ) : (
              sections.map((sec) => (
                <details
                  key={`${sec.key}-${normalizedQuery ? 'q' : 'idle'}`}
                  open
                  className="group rounded-xl bg-[#0e1117]/75 border border-white/[0.07] overflow-hidden"
                >
                  <summary className="list-none cursor-pointer select-none px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/[0.03] transition-colors">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <ChevronRight
                        className="w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-150 group-open:rotate-90"
                        aria-hidden="true"
                      />
                      <span className="truncate">{sec.label}</span>
                    </span>
                    <span className="text-[11px] font-medium text-slate-400 tabular-nums shrink-0">
                      {sec.items.length}
                    </span>
                  </summary>

                  <div className="p-2.5 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5 border-t border-white/[0.05]">
                    {sec.items.map((lg) => {
                      const isActive = lg.id === activeLeague.id;
                      const isFav = favoriteSet.has(lg.id);
                      const subtitle =
                        lg.country && lg.country !== lg.short_name
                          ? `${lg.country} · ${lg.name}`
                          : lg.name;

                      return (
                        <div
                          key={`${sec.key}-${lg.id}`}
                          className={`flex items-center gap-2 rounded-lg border transition-colors ${
                            isActive
                              ? 'bg-white/[0.08] border-white/[0.24]'
                              : 'bg-[#12151c] border-white/[0.06] hover:border-white/[0.16] hover:bg-[#171b24]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSelectLeague(lg);
                              requestClose();
                            }}
                            className="flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 text-left"
                          >
                            <div className="w-7 h-7 rounded-md bg-[#0b0d11] border border-white/[0.08] flex items-center justify-center shrink-0 p-1">
                              {lg.logo_url ? (
                                <img
                                  src={lg.logo_url}
                                  alt=""
                                  aria-hidden="true"
                                  className="w-full h-full object-contain"
                                />
                              ) : (
                                <Trophy className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-white truncate">
                                  {lg.short_name}
                                </span>
                                {isActive && (
                                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 truncate">
                                {subtitle}
                              </div>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => onToggleFavorite(lg.id)}
                            aria-pressed={isFav}
                            aria-label={
                              isFav
                                ? `Quitar ${lg.short_name} de favoritas`
                                : `Fijar ${lg.short_name} en acceso rápido`
                            }
                            title={isFav ? 'Quitar de acceso rápido' : 'Fijar en acceso rápido'}
                            className={`mr-1.5 p-1.5 rounded-md transition-colors shrink-0 ${
                              isFav
                                ? 'text-amber-300 hover:bg-amber-400/10'
                                : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.06]'
                            }`}
                          >
                            <Star
                              className="w-3.5 h-3.5"
                              fill={isFav ? 'currentColor' : 'none'}
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ))
            )}
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
