import { useEffect, useMemo, useState } from 'react';
import { X, MapPin, Calendar, TrendingUp, Scale, Flame, ChevronRight } from 'lucide-react';
import {
  fetchGameBettingContext,
  fetchGameBoxScore,
  type GameBettingContext,
} from '../services/basketballApi';
import {
  americanToImpliedProb,
  buildMatchupBettingInsight,
  evaluateGameBettingResult,
  formatAmericanOdds,
  formatDecimalOdds,
  formatSpreadCompact,
  summarizeTeamRecent,
} from '../utils/betting';
import type { Game, PlayerGameStat } from '../types/database';

interface GameDetailModalProps {
  game: Game;
  onClose: () => void;
  onSelectPlayer: (playerId: number) => void;
}

type ModalSection = 'betting' | 'boxscore';

export function GameDetailModal({ game, onClose, onSelectPlayer }: GameDetailModalProps) {
  const [section, setSection] = useState<ModalSection>(
    game.status === 'scheduled' ? 'betting' : 'boxscore',
  );
  const [stats, setStats] = useState<PlayerGameStat[]>([]);
  const [loadingBox, setLoadingBox] = useState(game.status !== 'scheduled');
  const [betCtx, setBetCtx] = useState<GameBettingContext | null>(null);
  const [loadingBet, setLoadingBet] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState<number>(game.away_team_id);

  useEffect(() => {
    setSection(game.status === 'scheduled' ? 'betting' : 'boxscore');
    setActiveTeamId(game.away_team_id);
  }, [game.id, game.status, game.away_team_id]);

  useEffect(() => {
    let active = true;
    if (game.status !== 'scheduled') {
      setLoadingBox(true);
      fetchGameBoxScore(game.id)
        .then((rows) => {
          if (active) setStats(rows);
        })
        .finally(() => {
          if (active) setLoadingBox(false);
        });
    } else {
      setStats([]);
      setLoadingBox(false);
    }

    setLoadingBet(true);
    fetchGameBettingContext(game)
      .then((ctx) => {
        if (active) setBetCtx(ctx);
      })
      .finally(() => {
        if (active) setLoadingBet(false);
      });

    return () => {
      active = false;
    };
  }, [game]);

  const teamStats = stats.filter((s) => s.team_id === activeTeamId);
  const periods = Math.max(
    game.home_linescores?.length ?? 0,
    game.away_linescores?.length ?? 0,
    4,
  );

  const outcome = useMemo(() => evaluateGameBettingResult(game), [game]);

  const bettingAnalysis = useMemo(() => {
    if (!betCtx) return null;
    const homeRecent = summarizeTeamRecent(game.home_team_id, betCtx.homeRecentGames);
    const awayRecent = summarizeTeamRecent(game.away_team_id, betCtx.awayRecentGames);
    const insight = buildMatchupBettingInsight(
      game,
      betCtx.homeStanding,
      betCtx.awayStanding,
      homeRecent,
      awayRecent,
    );
    return { homeRecent, awayRecent, insight };
  }, [game, betCtx]);

  const odds = game.odds;
  const hasBookLines = Boolean(
    odds &&
      (odds.home_moneyline != null ||
        odds.away_moneyline != null ||
        odds.home_spread != null ||
        odds.over_under != null),
  );
  const awayImplied = americanToImpliedProb(odds?.away_moneyline);
  const homeImplied = americanToImpliedProb(odds?.home_moneyline);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[92vh] flex flex-col bg-[#0f1623] border border-slate-800 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800/80 bg-gradient-to-b from-slate-900/90 to-[#0f1623]">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Calendar className="w-3.5 h-3.5 text-orange-400" />
              {game.status_detail || game.game_date}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Matchup Scoreboard */}
          <div className="grid grid-cols-3 items-center gap-2 py-1">
            <div className="flex flex-col items-center text-center">
              {game.away_team.logo_url && (
                <img
                  src={game.away_team.logo_url}
                  alt={game.away_team.abbreviation}
                  className="w-12 h-12 object-contain mb-1.5"
                />
              )}
              <span className="font-bold text-sm sm:text-base">{game.away_team.short_name}</span>
              <span className="text-[11px] text-slate-400">
                Visita
                {betCtx?.awayStanding
                  ? ` · ${betCtx.awayStanding.wins}-${betCtx.awayStanding.losses}`
                  : ''}
              </span>
            </div>

            <div className="flex items-center justify-center gap-3 sm:gap-5 tabular-nums">
              <span
                className={`text-3xl sm:text-4xl font-black ${
                  game.away_score >= game.home_score && game.status !== 'scheduled'
                    ? 'text-white'
                    : 'text-slate-400'
                }`}
              >
                {game.status === 'scheduled' ? '-' : game.away_score}
              </span>
              <span className="text-xs font-bold text-slate-500">VS</span>
              <span
                className={`text-3xl sm:text-4xl font-black ${
                  game.home_score >= game.away_score && game.status !== 'scheduled'
                    ? 'text-white'
                    : 'text-slate-400'
                }`}
              >
                {game.status === 'scheduled' ? '-' : game.home_score}
              </span>
            </div>

            <div className="flex flex-col items-center text-center">
              {game.home_team.logo_url && (
                <img
                  src={game.home_team.logo_url}
                  alt={game.home_team.abbreviation}
                  className="w-12 h-12 object-contain mb-1.5"
                />
              )}
              <span className="font-bold text-sm sm:text-base">{game.home_team.short_name}</span>
              <span className="text-[11px] text-slate-400">
                Local
                {betCtx?.homeStanding
                  ? ` · ${betCtx.homeStanding.wins}-${betCtx.homeStanding.losses}`
                  : ''}
              </span>
            </div>
          </div>

          {/* Linescores by Quarter */}
          {game.status !== 'scheduled' &&
            (game.away_linescores?.length || game.home_linescores?.length) && (
              <div className="mt-3 rounded-xl bg-slate-900/70 border border-slate-800/80 p-2.5 overflow-x-auto">
                <table className="w-full text-xs tabular-nums">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="text-left py-1 px-2 font-medium">EQUIPO</th>
                      {Array.from({ length: periods }).map((_, i) => (
                        <th key={i} className="text-center py-1 px-2 font-medium">
                          {i < 4 ? `Q${i + 1}` : `OT${i - 3}`}
                        </th>
                      ))}
                      <th className="text-right py-1 px-2 font-bold text-slate-300">T</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1.5 px-2 font-bold text-slate-200">
                        {game.away_team.abbreviation}
                      </td>
                      {Array.from({ length: periods }).map((_, i) => (
                        <td key={i} className="text-center py-1.5 px-2 text-slate-400">
                          {game.away_linescores?.[i] ?? '-'}
                        </td>
                      ))}
                      <td className="text-right py-1.5 px-2 font-extrabold text-white">
                        {game.away_score}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-2 font-bold text-slate-200">
                        {game.home_team.abbreviation}
                      </td>
                      {Array.from({ length: periods }).map((_, i) => (
                        <td key={i} className="text-center py-1.5 px-2 text-slate-400">
                          {game.home_linescores?.[i] ?? '-'}
                        </td>
                      ))}
                      <td className="text-right py-1.5 px-2 font-extrabold text-white">
                        {game.home_score}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

          {game.venue && (
            <div className="mt-2.5 flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <MapPin className="w-3 h-3" />
              <span>{game.venue}</span>
            </div>
          )}
        </div>

        {/* Primary Section Switcher: Box Score vs Casas de Apuestas & Guía */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-3 pt-2 gap-2">
          <button
            type="button"
            onClick={() => setSection('betting')}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl border-b-2 inline-flex items-center gap-1.5 transition-colors ${
              section === 'betting'
                ? 'border-orange-500 text-orange-400 bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            Casas y Guía de Apuesta
          </button>
          <button
            type="button"
            onClick={() => setSection('boxscore')}
            className={`px-3.5 py-2 text-xs font-bold rounded-t-xl border-b-2 inline-flex items-center gap-1.5 transition-colors ${
              section === 'boxscore'
                ? 'border-orange-500 text-white bg-slate-900/90'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Box Score
            {game.status === 'scheduled' && (
              <span className="text-[10px] text-slate-500 font-normal">(Previa)</span>
            )}
          </button>
        </div>

        {section === 'betting' ? (
          <div className="flex-1 overflow-auto p-4 sm:p-5 space-y-4">
            {/* Sportsbook Market Board */}
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-orange-400">
                    Línea de Casas de Apuestas {odds?.provider ? `· ${odds.provider}` : ''}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Cuotas en formato decimal (ej. 1.91) y americano (-110) con probabilidad implícita.
                  </p>
                </div>
                {game.status === 'final' && odds && (
                  <div className="flex items-center gap-1.5 text-[11px] font-bold">
                    {outcome.totalResult && (
                      <span
                        className={`px-2 py-0.5 rounded-full ${
                          outcome.totalResult === 'OVER'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : outcome.totalResult === 'UNDER'
                              ? 'bg-sky-500/20 text-sky-300'
                              : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        Total {outcome.totalPoints} · {outcome.totalResult}
                      </span>
                    )}
                    {outcome.spreadWinner && outcome.spreadWinner !== 'PUSH' && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                        Cubrió{' '}
                        {outcome.spreadWinner === 'home'
                          ? game.home_team.abbreviation
                          : game.away_team.abbreviation}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {odds ? (
                <>
                  {hasBookLines ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs tabular-nums">
                        <thead>
                          <tr className="text-slate-500 border-b border-slate-800">
                            <th className="text-left py-2 pr-2 font-semibold">EQUIPO</th>
                            <th className="text-center py-2 px-2 font-semibold">GANADOR (ML)</th>
                            <th className="text-center py-2 px-2 font-semibold">HÁNDICAP</th>
                            <th className="text-center py-2 pl-2 font-semibold">TOTAL (O/U)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          <tr>
                            <td className="py-2.5 pr-2 font-bold text-slate-100">
                              {game.away_team.abbreviation}{' '}
                              <span className="text-[10px] font-normal text-slate-500">Visita</span>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="font-extrabold text-white">
                                {formatDecimalOdds(odds.away_moneyline)}{' '}
                                <span className="text-slate-400 font-medium">
                                  ({formatAmericanOdds(odds.away_moneyline)})
                                </span>
                              </div>
                              {awayImplied != null && (
                                <div className="text-[10px] text-slate-400">
                                  Prob. {awayImplied.toFixed(0)}%
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="font-bold text-amber-300">
                                {formatSpreadCompact(odds.away_spread)}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Cuota {formatDecimalOdds(odds.away_spread_odds)}
                              </div>
                            </td>
                            <td className="py-2.5 pl-2 text-center">
                              <div className="font-bold text-emerald-300">
                                Más {odds.over_under ?? '-'}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Cuota {formatDecimalOdds(odds.over_odds)}
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2.5 pr-2 font-bold text-slate-100">
                              {game.home_team.abbreviation}{' '}
                              <span className="text-[10px] font-normal text-slate-500">Local</span>
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="font-extrabold text-white">
                                {formatDecimalOdds(odds.home_moneyline)}{' '}
                                <span className="text-slate-400 font-medium">
                                  ({formatAmericanOdds(odds.home_moneyline)})
                                </span>
                              </div>
                              {homeImplied != null && (
                                <div className="text-[10px] text-slate-400">
                                  Prob. {homeImplied.toFixed(0)}%
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-2 text-center">
                              <div className="font-bold text-amber-300">
                                {formatSpreadCompact(odds.home_spread)}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Cuota {formatDecimalOdds(odds.home_spread_odds)}
                              </div>
                            </td>
                            <td className="py-2.5 pl-2 text-center">
                              <div className="font-bold text-sky-300">
                                Menos {odds.over_under ?? '-'}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Cuota {formatDecimalOdds(odds.under_odds)}
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 text-xs text-slate-300">
                      Cuotas de la casa aún pendientes de publicación para esta fecha. Tienes el
                      modelo predictor y la radiografía estadística real debajo.
                    </div>
                  )}

                  {/* Win Prob Predictor Bar if available */}
                  {(odds.away_win_prob != null || odds.home_win_prob != null) && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                      <div className="flex justify-between text-[11px] font-bold tabular-nums">
                        <span className="text-orange-300">
                          {game.away_team.abbreviation} {Number(odds.away_win_prob ?? 50).toFixed(1)}%
                        </span>
                        <span className="text-slate-400 font-normal">Modelo ESPN Predictor</span>
                        <span className="text-sky-300">
                          {Number(odds.home_win_prob ?? 50).toFixed(1)}% {game.home_team.abbreviation}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden flex">
                        <div
                          className="bg-orange-500"
                          style={{ width: `${odds.away_win_prob ?? 50}%` }}
                        />
                        <div
                          className="bg-sky-500"
                          style={{ width: `${odds.home_win_prob ?? 50}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Opening vs Current Line Movement */}
                  {bettingAnalysis && bettingAnalysis.insight.movements.length > 0 && (
                    <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-2.5 space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Movimiento del mercado (Apertura → Actual)
                      </div>
                      {bettingAnalysis.insight.movements.map((mv) => (
                        <div key={mv} className="text-xs text-amber-300 font-medium">
                          • {mv}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-4 text-xs text-slate-400">
                  La casa de apuestas aún no publica la línea oficial para este partido, pero abajo
                  tienes la guía estadística real para evaluar ritmos y rendimientos.
                </div>
              )}
            </div>

            {/* "¿A qué estás apostando?" — Real Data Context */}
            {loadingBet ? (
              <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-5 text-center text-xs text-slate-400">
                Calculando tendencias y promedios reales de ambos equipos...
              </div>
            ) : (
              bettingAnalysis && (
                <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-200">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    ¿A qué estás apostando? · Radiografía Real
                  </div>

                  {/* Matchup Signals */}
                  {bettingAnalysis.insight.signals.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {bettingAnalysis.insight.signals.map((sig) => (
                        <div
                          key={sig.title}
                          className={`rounded-xl border p-3 ${
                            sig.tone === 'over'
                              ? 'bg-emerald-500/10 border-emerald-500/30'
                              : sig.tone === 'under'
                                ? 'bg-sky-500/10 border-sky-500/30'
                                : sig.tone === 'home' || sig.tone === 'away'
                                  ? 'bg-orange-500/10 border-orange-500/30'
                                  : 'bg-slate-950/60 border-slate-800'
                          }`}
                        >
                          <div className="text-xs font-extrabold text-white">{sig.title}</div>
                          <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                            {sig.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Team Recent 6 Games & Season Metrics Comparison */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 tabular-nums">
                    {[
                      {
                        team: game.away_team,
                        role: 'Visita',
                        st: betCtx?.awayStanding ?? null,
                        rec: bettingAnalysis.awayRecent,
                        locRec: betCtx?.awayStanding?.away_record,
                      },
                      {
                        team: game.home_team,
                        role: 'Local',
                        st: betCtx?.homeStanding ?? null,
                        rec: bettingAnalysis.homeRecent,
                        locRec: betCtx?.homeStanding?.home_record,
                      },
                    ].map((side) => (
                      <div
                        key={side.team.id}
                        className="rounded-xl bg-slate-950/70 border border-slate-800/80 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold text-white">
                            {side.team.short_name}{' '}
                            <span className="text-slate-400 font-normal">({side.role})</span>
                          </span>
                          <span className="text-[11px] font-bold text-orange-400">
                            {side.st ? `${side.st.wins}-${side.st.losses}` : '-'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-y-1.5 text-[11px] text-slate-300">
                          <div>
                            Récord {side.role}: <strong className="text-white">{side.locRec || '-'}</strong>
                          </div>
                          <div>
                            Últ. 10: <strong className="text-white">{side.st?.last_ten || '-'}</strong>
                          </div>
                          <div>
                            Anota / Recibe:{' '}
                            <strong className="text-white">
                              {side.st?.ppg != null ? Number(side.st.ppg).toFixed(1) : side.rec.avgFor.toFixed(1)}
                              {' / '}
                              {side.st?.oppg != null ? Number(side.st.oppg).toFixed(1) : side.rec.avgAgainst.toFixed(1)}
                            </strong>
                          </div>
                          <div>
                            Margen neto:{' '}
                            <strong
                              className={
                                Number(side.st?.diff ?? side.rec.avgMargin) >= 0
                                  ? 'text-emerald-300'
                                  : 'text-rose-300'
                              }
                            >
                              {Number(side.st?.diff ?? side.rec.avgMargin) >= 0 ? '+' : ''}
                              {Number(side.st?.diff ?? side.rec.avgMargin).toFixed(1)}
                            </strong>
                          </div>
                          {side.rec.gamesCount > 0 && (
                            <>
                              <div>
                                Últ. {side.rec.gamesCount} PJ:{' '}
                                <strong className="text-white">
                                  {side.rec.wins}-{side.rec.losses}
                                </strong>
                              </div>
                              <div>
                                Prom. total PJ:{' '}
                                <strong className="text-white">
                                  {side.rec.avgCombined.toFixed(1)} pts
                                </strong>
                              </div>
                            </>
                          )}
                          {side.rec.overTracked > 0 && (
                            <div>
                              Over rec.:{' '}
                              <strong className="text-emerald-300">
                                {side.rec.overHits}/{side.rec.overTracked}
                              </strong>
                            </div>
                          )}
                          {side.rec.atsTracked > 0 && (
                            <div>
                              Cubrió ATS:{' '}
                              <strong className="text-amber-300">
                                {side.rec.atsWins}/{side.rec.atsTracked}
                              </strong>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Quick Guide Tip */}
                  <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/50 rounded-lg px-3 py-2 border border-slate-800/60">
                    <strong className="text-slate-300">Tip rápido:</strong> en Hándicap,{' '}
                    <span className="text-amber-300 font-semibold">-8.5</span> exige ganar por 9+
                    puntos y <span className="text-amber-300 font-semibold">+8.5</span> gana aunque
                    pierda hasta por 8 puntos. Para apuestas de jugador (Props), toca cualquiera de las
                    figuras abajo para ver su gráfica de 15 partidos con línea O/U.
                  </p>
                </div>
              )
            )}

            {/* Key Players for Props Drill-Down */}
            {betCtx && betCtx.keyPlayers.length > 0 && (
              <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-4 space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-200">
                  <Flame className="w-3.5 h-3.5 text-orange-400" />
                  Figuras del Partido · Ver Gráfica y Props (PTS / REB / AST)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {betCtx.keyPlayers.slice(0, 6).map((p) => (
                    <button
                      key={p.player_id}
                      type="button"
                      onClick={() => onSelectPlayer(p.player_id)}
                      className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/70 hover:bg-slate-800/70 border border-slate-800 px-3 py-2 text-left transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          {p.full_name}{' '}
                          <span className="text-[10px] text-slate-400 font-normal">
                            ({p.team_abbreviation})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                          <strong className="text-orange-300">{Number(p.ppg).toFixed(1)}</strong> PTS ·{' '}
                          {Number(p.rpg).toFixed(1)} REB · {Number(p.apg).toFixed(1)} AST
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Team Switcher for Box Score */}
            <div className="flex border-b border-slate-800 bg-slate-900/50">
              {[game.away_team, game.home_team].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTeamId(t.id)}
                  className={`flex-1 py-2.5 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 border-b-2 transition-colors ${
                    activeTeamId === t.id
                      ? 'border-orange-500 text-white bg-slate-800/40'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.logo_url && <img src={t.logo_url} alt={t.abbreviation} className="w-4 h-4" />}
                  <span>{t.short_name}</span>
                </button>
              ))}
            </div>

            {/* Box Score Body */}
            <div className="flex-1 overflow-auto p-2 sm:p-4">
              {game.status === 'scheduled' ? (
                <div className="py-10 text-center space-y-3">
                  <p className="text-slate-400 text-sm">
                    El partido aún no ha iniciado. El box score aparecerá automáticamente al comenzar.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSection('betting')}
                    className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl bg-orange-500 text-slate-950 hover:bg-orange-400"
                  >
                    <Scale className="w-3.5 h-3.5" />
                    Ver Líneas de Apuesta y Previa
                  </button>
                </div>
              ) : loadingBox ? (
                <div className="py-12 text-center text-slate-400 text-sm">Cargando box score...</div>
              ) : teamStats.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  Sin estadísticas de jugadores disponibles para este partido.
                </div>
              ) : (
                <table className="w-full text-xs tabular-nums whitespace-nowrap">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-800">
                      <th className="text-left py-2 px-2 sticky left-0 bg-[#0f1623]">JUGADOR</th>
                      <th className="text-right py-2 px-2">MIN</th>
                      <th className="text-right py-2 px-2 text-orange-400">PTS</th>
                      <th className="text-right py-2 px-2">REB</th>
                      <th className="text-right py-2 px-2">AST</th>
                      <th className="text-right py-2 px-2">TC</th>
                      <th className="text-right py-2 px-2">3P</th>
                      <th className="text-right py-2 px-2">TL</th>
                      <th className="text-right py-2 px-2">ROB</th>
                      <th className="text-right py-2 px-2">TAP</th>
                      <th className="text-right py-2 px-2">+/-</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {teamStats.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => onSelectPlayer(row.player_id)}
                        className={`cursor-pointer hover:bg-slate-800/40 ${
                          row.did_not_play ? 'opacity-45' : ''
                        }`}
                      >
                        <td className="py-2 px-2 sticky left-0 bg-[#0f1623]">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-100 hover:text-orange-400">
                              {row.player?.full_name ?? `#${row.player_id}`}
                            </span>
                            {row.starter && !row.did_not_play && (
                              <span className="text-[10px] px-1 rounded bg-orange-500/15 text-orange-300 font-semibold">
                                TIT
                              </span>
                            )}
                          </div>
                        </td>
                        {row.did_not_play ? (
                          <td colSpan={10} className="py-2 px-2 text-right text-slate-500 italic">
                            {row.dnp_reason || 'No jugó (DNP)'}
                          </td>
                        ) : (
                          <>
                            <td className="text-right py-2 px-2 text-slate-300">{row.minutes}</td>
                            <td className="text-right py-2 px-2 font-bold text-white">{row.pts}</td>
                            <td className="text-right py-2 px-2 text-slate-200">{row.reb}</td>
                            <td className="text-right py-2 px-2 text-slate-200">{row.ast}</td>
                            <td className="text-right py-2 px-2 text-slate-400">
                              {row.fgm}-{row.fga}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-400">
                              {row.tpm}-{row.tpa}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-400">
                              {row.ftm}-{row.fta}
                            </td>
                            <td className="text-right py-2 px-2 text-slate-300">{row.stl}</td>
                            <td className="text-right py-2 px-2 text-slate-300">{row.blk}</td>
                            <td
                              className={`text-right py-2 px-2 font-medium ${
                                row.plus_minus > 0
                                  ? 'text-emerald-400'
                                  : row.plus_minus < 0
                                    ? 'text-rose-400'
                                    : 'text-slate-400'
                              }`}
                            >
                              {row.plus_minus > 0 ? `+${row.plus_minus}` : row.plus_minus}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
