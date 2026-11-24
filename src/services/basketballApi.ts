import { clearOfflineCache, supabase, supabaseUrlResolved, withOfflineCache } from '../lib/supabase';
import type {
  FootballPlayerSeasonAverage,
  FootballTeamSeasonAverage,
  Game,
  League,
  Player,
  PlayerGameStat,
  PlayerSeasonAverage,
  Season,
  SyncRun,
  Team,
  TeamSeasonAverage,
  TeamStanding,
} from '../types/database';

export async function fetchLeagues(): Promise<{ data: League[]; fromCache: boolean }> {
  return withOfflineCache('leagues', async () => {
    const { data, error } = await supabase
      .from('leagues')
      .select('id, slug, name, short_name, country, sport, source_type, external_id, logo_url, is_public')
      .order('id', { ascending: true });
    if (error) throw error;
    return (data ?? []) as League[];
  });
}

export async function fetchCurrentSeason(leagueId: number): Promise<Season | null> {
  const { data } = await withOfflineCache(`season_${leagueId}`, async () => {
    const { data: rows, error } = await supabase
      .from('seasons')
      .select('id, league_id, name, season_year, is_current')
      .eq('league_id', leagueId)
      .order('is_current', { ascending: false })
      .order('season_year', { ascending: false })
      .limit(1);
    if (error) throw error;
    return (rows?.[0] ?? null) as Season | null;
  });
  return data;
}

export async function fetchLastSync(): Promise<SyncRun | null> {
  try {
    const { data, error } = await supabase
      .from('sync_runs')
      .select('*')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data as SyncRun | null;
  } catch {
    return null;
  }
}

export async function triggerCloudSync(
  daysBack = 2,
  daysAhead = 3,
  sport: 'basketball' | 'football' = 'basketball',
  leagueCode = 'eng.1',
): Promise<{ ok: boolean; games_synced?: number; stats_synced?: number }> {
  const endpoint = sport === 'football' ? 'sync-football' : 'sync-nba';
  const payload =
    sport === 'football'
      ? { league: leagueCode, days_back: Math.max(daysBack, 5), days_ahead: Math.max(daysAhead, 14) }
      : { days_back: daysBack, days_ahead: daysAhead };

  const resp = await fetch(`${supabaseUrlResolved.replace(/\/$/, '')}/functions/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    throw new Error(`Sync HTTP ${resp.status}`);
  }
  const json = (await resp.json()) as {
    ok: boolean;
    games_synced?: number;
    stats_synced?: number;
  };
  if (json.ok) {
    clearOfflineCache();
  }
  return json;
}

export interface GameDateSummary {
  game_date: string;
  finalCount: number;
  liveCount: number;
  scheduledCount: number;
  totalCount: number;
}

export async function fetchAvailableGameDateSummaries(leagueId: number): Promise<GameDateSummary[]> {
  const { data } = await withOfflineCache(`game_date_summaries_v1_${leagueId}`, async () => {
    const { data: rows, error } = await supabase
      .from('games')
      .select('game_date, status')
      .eq('league_id', leagueId)
      .order('game_date', { ascending: false })
      .limit(2000);
    if (error) throw error;

    const order: string[] = [];
    const byDate = new Map<string, GameDateSummary>();
    for (const row of (rows ?? []) as Array<{ game_date: string; status: string }>) {
      let bucket = byDate.get(row.game_date);
      if (!bucket) {
        bucket = {
          game_date: row.game_date,
          finalCount: 0,
          liveCount: 0,
          scheduledCount: 0,
          totalCount: 0,
        };
        byDate.set(row.game_date, bucket);
        order.push(row.game_date);
      }
      bucket.totalCount += 1;
      if (row.status === 'final') bucket.finalCount += 1;
      else if (row.status === 'live') bucket.liveCount += 1;
      else if (row.status === 'scheduled') bucket.scheduledCount += 1;
    }
    return order.map((d) => byDate.get(d)!);
  });
  return data;
}

export async function fetchAvailableGameDates(leagueId: number): Promise<string[]> {
  const { data } = await withOfflineCache(`game_dates_${leagueId}`, async () => {
    const { data: rows, error } = await supabase
      .from('games')
      .select('game_date')
      .eq('league_id', leagueId)
      .order('game_date', { ascending: false });
    if (error) throw error;
    const unique = Array.from(new Set((rows ?? []).map((r) => r.game_date as string)));
    return unique;
  });
  return data;
}

export async function fetchGamesByDate(
  leagueId: number,
  gameDate: string,
): Promise<{ data: Game[]; fromCache: boolean }> {
  return withOfflineCache(`games_${leagueId}_${gameDate}`, async () => {
    const { data, error } = await supabase
      .from('games')
      .select(`
        id, league_id, season_id, game_date, tipoff_at, status, status_detail,
        period, clock, home_team_id, away_team_id, home_score, away_score,
        home_linescores, away_linescores, venue, odds, sport_stats,
        home_team:teams!games_home_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url),
        away_team:teams!games_away_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url)
      `)
      .eq('league_id', leagueId)
      .eq('game_date', gameDate)
      .order('tipoff_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as Game[];
  });
}

export async function fetchGameById(gameId: number): Promise<Game | null> {
  const { data, error } = await supabase
    .from('games')
    .select(`
      id, league_id, season_id, game_date, tipoff_at, status, status_detail,
      period, clock, home_team_id, away_team_id, home_score, away_score,
      home_linescores, away_linescores, venue, odds, sport_stats,
      home_team:teams!games_home_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url),
      away_team:teams!games_away_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url)
    `)
    .eq('id', gameId)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as unknown as Game | null;
}

export async function fetchGameBoxScore(gameId: number): Promise<PlayerGameStat[]> {
  const { data } = await withOfflineCache(`boxscore_${gameId}`, async () => {
    const { data: rows, error } = await supabase
      .from('player_game_stats')
      .select(`
        *,
        player:players(id, full_name, jersey_number, position, headshot_url)
      `)
      .eq('game_id', gameId)
      .order('did_not_play', { ascending: true })
      .order('starter', { ascending: false })
      .order('pts', { ascending: false });
    if (error) throw error;
    return (rows ?? []) as unknown as PlayerGameStat[];
  });
  return data;
}

export async function fetchStandings(
  seasonId: number,
): Promise<{ data: TeamStanding[]; fromCache: boolean }> {
  return withOfflineCache(`standings_${seasonId}`, async () => {
    const { data, error } = await supabase
      .from('team_standings')
      .select(`
        *,
        team:teams(*)
      `)
      .eq('season_id', seasonId)
      .order('playoff_seed', { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as TeamStanding[];
  });
}

export async function fetchTeams(leagueId: number): Promise<Team[]> {
  const { data } = await withOfflineCache(`teams_${leagueId}`, async () => {
    const { data: rows, error } = await supabase
      .from('teams')
      .select('*')
      .eq('league_id', leagueId)
      .eq('is_active', true)
      .order('city', { ascending: true });
    if (error) throw error;
    return (rows ?? []) as Team[];
  });
  return data;
}

export async function fetchSeasonAverages(
  leagueId: number,
  seasonId: number,
): Promise<{ data: PlayerSeasonAverage[]; fromCache: boolean }> {
  return withOfflineCache(`averages_${leagueId}_${seasonId}`, async () => {
    const { data, error } = await supabase
      .from('player_season_averages')
      .select('*')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .order('ppg', { ascending: false });
    if (error) throw error;
    return (data ?? []) as PlayerSeasonAverage[];
  });
}

export async function fetchTeamSeasonAverages(
  leagueId: number,
  seasonId: number,
): Promise<{ data: TeamSeasonAverage[]; fromCache: boolean }> {
  return withOfflineCache(`team_averages_${leagueId}_${seasonId}`, async () => {
    const { data, error } = await supabase
      .from('team_season_averages')
      .select('*')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .order('ppg', { ascending: false });
    if (error) throw error;
    return (data ?? []) as TeamSeasonAverage[];
  });
}

export async function fetchFootballSeasonAverages(
  leagueId: number,
  seasonId: number,
): Promise<{ data: FootballPlayerSeasonAverage[]; fromCache: boolean }> {
  return withOfflineCache(`fb_averages_${leagueId}_${seasonId}`, async () => {
    const { data, error } = await supabase
      .from('football_player_season_averages')
      .select('*')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .order('goals', { ascending: false });
    if (error) throw error;
    return (data ?? []) as FootballPlayerSeasonAverage[];
  });
}

export async function fetchFootballTeamSeasonAverages(
  leagueId: number,
  seasonId: number,
): Promise<{ data: FootballTeamSeasonAverage[]; fromCache: boolean }> {
  return withOfflineCache(`fb_team_averages_${leagueId}_${seasonId}`, async () => {
    const { data, error } = await supabase
      .from('football_team_season_averages')
      .select('*')
      .eq('league_id', leagueId)
      .eq('season_id', seasonId)
      .order('points', { ascending: false });
    if (error) throw error;
    return (data ?? []) as FootballTeamSeasonAverage[];
  });
}

export async function fetchPlayers(leagueId: number): Promise<Player[]> {
  const { data } = await withOfflineCache(`players_${leagueId}`, async () => {
    const { data: rows, error } = await supabase
      .from('players')
      .select(`
        id, league_id, team_id, full_name, jersey_number, position,
        height_display, weight_display, age, country, headshot_url, status,
        team:teams(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url)
      `)
      .eq('league_id', leagueId)
      .eq('is_active', true)
      .order('full_name', { ascending: true });
    if (error) throw error;
    return (rows ?? []) as unknown as Player[];
  });
  return data;
}

export async function fetchPlayerProfileAndLogs(
  playerId: number,
  sport: 'basketball' | 'football' = 'basketball',
): Promise<{
  player: Player | null;
  average: PlayerSeasonAverage | null;
  footballAverage: FootballPlayerSeasonAverage | null;
  logs: PlayerGameStat[];
}> {
  const { data } = await withOfflineCache(`player_detail_${sport}_${playerId}`, async () => {
    const [playerRes, avgRes, fbAvgRes, logsRes] = await Promise.all([
      supabase
        .from('players')
        .select(`
          id, league_id, team_id, full_name, jersey_number, position,
          height_display, weight_display, age, country, headshot_url, status,
          team:teams(*)
        `)
        .eq('id', playerId)
        .maybeSingle(),
      sport === 'football'
        ? Promise.resolve({ data: null })
        : supabase
            .from('player_season_averages')
            .select('*')
            .eq('player_id', playerId)
            .limit(1)
            .maybeSingle(),
      sport === 'football'
        ? supabase
            .from('football_player_season_averages')
            .select('*')
            .eq('player_id', playerId)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('player_game_stats')
        .select(`
          *,
          game:games(
            id, game_date, status, home_team_id, away_team_id, home_score, away_score,
            home_team:teams!games_home_team_id_fkey(id, abbreviation, logo_url),
            away_team:teams!games_away_team_id_fkey(id, abbreviation, logo_url)
          )
        `)
        .eq('player_id', playerId)
        .eq('did_not_play', false)
        .order('id', { ascending: false })
        .limit(24),
    ]);

    if (playerRes.error) throw playerRes.error;
    type LogWithGame = PlayerGameStat & { game?: { status?: string; game_date?: string } };
    const seenDates = new Set<string>();
    const logs = ((logsRes.data ?? []) as unknown as LogWithGame[])
      .filter((r) => {
        if (r.game?.status && r.game.status !== 'final') return false;
        if (
          r.game?.home_team_id != null &&
          r.game?.away_team_id != null &&
          r.team_id !== r.game.home_team_id &&
          r.team_id !== r.game.away_team_id
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.game?.game_date ?? '').localeCompare(a.game?.game_date ?? '') || b.id - a.id)
      .filter((r) => {
        const d = r.game?.game_date;
        if (!d) return true;
        if (seenDates.has(d)) return false;
        seenDates.add(d);
        return true;
      })
      .slice(0, 15);

    return {
      player: (playerRes.data ?? null) as unknown as Player | null,
      average: (avgRes.data ?? null) as PlayerSeasonAverage | null,
      footballAverage: (fbAvgRes.data ?? null) as FootballPlayerSeasonAverage | null,
      logs,
    };
  });
  return data;
}

export async function fetchTeamRosterAndGames(
  teamId: number,
  sport: 'basketball' | 'football' = 'basketball',
): Promise<{
  players: Player[];
  games: Game[];
  teamAverage: TeamSeasonAverage | null;
  playerAverages: PlayerSeasonAverage[];
  footballTeamAverage: FootballTeamSeasonAverage | null;
  footballPlayerAverages: FootballPlayerSeasonAverage[];
}> {
  const { data } = await withOfflineCache(`team_detail_v4_${sport}_${teamId}`, async () => {
    const [rosterRes, gamesRes, teamAvgRes, playerAvgsRes, fbTeamAvgRes, fbPlayerAvgsRes] =
      await Promise.all([
        supabase
          .from('players')
          .select('id, league_id, team_id, full_name, jersey_number, position, height_display, weight_display, age, country, headshot_url, status')
          .eq('team_id', teamId)
          .eq('is_active', true)
          .order('full_name', { ascending: true }),
        supabase
          .from('games')
          .select(`
            id, league_id, season_id, game_date, tipoff_at, status, status_detail,
            period, clock, home_team_id, away_team_id, home_score, away_score,
            home_linescores, away_linescores, venue, odds, sport_stats,
            home_team:teams!games_home_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url),
            away_team:teams!games_away_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url)
          `)
          .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
          .order('game_date', { ascending: false })
          .limit(40),
        sport === 'football'
          ? Promise.resolve({ data: null })
          : supabase
              .from('team_season_averages')
              .select('*')
              .eq('team_id', teamId)
              .limit(1)
              .maybeSingle(),
        sport === 'football'
          ? Promise.resolve({ data: [] })
          : supabase
              .from('player_season_averages')
              .select('*')
              .eq('team_id', teamId)
              .gt('gp', 0)
              .order('ppg', { ascending: false }),
        sport === 'football'
          ? supabase
              .from('football_team_season_averages')
              .select('*')
              .eq('team_id', teamId)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        sport === 'football'
          ? supabase
              .from('football_player_season_averages')
              .select('*')
              .eq('team_id', teamId)
              .gt('gp', 0)
              .order('goals', { ascending: false })
              .order('shots_on_target', { ascending: false })
          : Promise.resolve({ data: [] }),
      ]);
    if (rosterRes.error) throw rosterRes.error;
    if (gamesRes.error) throw gamesRes.error;
    return {
      players: (rosterRes.data ?? []) as Player[],
      games: (gamesRes.data ?? []) as unknown as Game[],
      teamAverage: (teamAvgRes.data ?? null) as TeamSeasonAverage | null,
      playerAverages: (playerAvgsRes.data ?? []) as PlayerSeasonAverage[],
      footballTeamAverage: (fbTeamAvgRes.data ?? null) as FootballTeamSeasonAverage | null,
      footballPlayerAverages: (fbPlayerAvgsRes.data ?? []) as FootballPlayerSeasonAverage[],
    };
  });
  return data;
}

export interface GameBettingContext {
  homeStanding: TeamStanding | null;
  awayStanding: TeamStanding | null;
  homeTeamAvg: TeamSeasonAverage | null;
  awayTeamAvg: TeamSeasonAverage | null;
  homeRecentGames: Game[];
  awayRecentGames: Game[];
  h2hGames?: Game[];
  keyPlayers: PlayerSeasonAverage[];
  playerRecentLogs: PlayerGameStat[];
  playerStatuses: Record<number, string>;
}

export interface FootballGameBettingContext {
  homeStanding: TeamStanding | null;
  awayStanding: TeamStanding | null;
  homeTeamAvg: FootballTeamSeasonAverage | null;
  awayTeamAvg: FootballTeamSeasonAverage | null;
  homeRecentGames: Game[];
  awayRecentGames: Game[];
  h2hGames?: Game[];
  keyPlayers: FootballPlayerSeasonAverage[];
  playerRecentLogs: PlayerGameStat[];
  playerStatuses: Record<number, string>;
}

const CONTEXT_TEAM_SELECT =
  'id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url';

function selectGameCols(includeSportStats: boolean): string {
  return includeSportStats
    ? `id, league_id, season_id, game_date, tipoff_at, status, status_detail, period, clock,
       home_team_id, away_team_id, home_score, away_score, home_linescores, away_linescores, venue, odds, sport_stats,
       home_team:teams!games_home_team_id_fkey(${CONTEXT_TEAM_SELECT}),
       away_team:teams!games_away_team_id_fkey(${CONTEXT_TEAM_SELECT})`
    : `id, league_id, season_id, game_date, tipoff_at, status, status_detail, period, clock,
       home_team_id, away_team_id, home_score, away_score, home_linescores, away_linescores, venue, odds,
       home_team:teams!games_home_team_id_fkey(${CONTEXT_TEAM_SELECT}),
       away_team:teams!games_away_team_id_fkey(${CONTEXT_TEAM_SELECT})`;
}

async function fetchTeamRecentFinalGames(
  game: Game,
  teamId: number,
  includeSportStats: boolean,
): Promise<Game[]> {
  const { data } = await supabase
    .from('games')
    .select(selectGameCols(includeSportStats))
    .eq('season_id', game.season_id)
    .eq('status', 'final')
    .neq('id', game.id)
    .lte('game_date', game.game_date)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order('game_date', { ascending: false })
    .limit(15);

  return (data ?? []) as unknown as Game[];
}

export async function fetchHeadToHeadGames(
  leagueId: number,
  teamAId: number,
  teamBId: number,
  excludeGameId: number,
  includeSportStats: boolean,
): Promise<Game[]> {
  const { data } = await supabase
    .from('games')
    .select(selectGameCols(includeSportStats))
    .eq('league_id', leagueId)
    .eq('status', 'final')
    .neq('id', excludeGameId)
    .or(
      `and(home_team_id.eq.${teamAId},away_team_id.eq.${teamBId}),and(home_team_id.eq.${teamBId},away_team_id.eq.${teamAId})`,
    )
    .order('game_date', { ascending: false })
    .limit(10);

  return (data ?? []) as unknown as Game[];
}

async function fetchCleanLogsAndStatuses(
  game: Game,
  playerIds: number[],
): Promise<{ playerRecentLogs: PlayerGameStat[]; playerStatuses: Record<number, string> }> {
  if (playerIds.length === 0) {
    return { playerRecentLogs: [], playerStatuses: {} };
  }

  const [logsRes, statusesRes] = await Promise.all([
    supabase
      .from('player_game_stats')
      .select(`
        *,
        game:games(id, game_date, status, home_team_id, away_team_id, home_score, away_score)
      `)
      .in('player_id', playerIds)
      .eq('did_not_play', false)
      .neq('game_id', game.id)
      .order('id', { ascending: false })
      .limit(450),
    supabase.from('players').select('id, status').in('id', playerIds),
  ]);

  const playerStatuses: Record<number, string> = {};
  for (const row of (statusesRes.data ?? []) as Array<{ id: number; status: string | null }>) {
    if (row.status) playerStatuses[row.id] = row.status.toLowerCase();
  }

  type LogRow = PlayerGameStat & {
    game?: {
      status?: string;
      game_date?: string;
      home_team_id?: number;
      away_team_id?: number;
    };
  };

  const seenPlayerDates = new Set<string>();
  const playerRecentLogs = ((logsRes.data ?? []) as unknown as LogRow[])
    .filter((r) => {
      if (r.game?.status && r.game.status !== 'final') return false;
      if (r.game?.game_date && r.game.game_date > game.game_date) return false;
      if (
        r.game?.home_team_id != null &&
        r.game?.away_team_id != null &&
        r.team_id !== r.game.home_team_id &&
        r.team_id !== r.game.away_team_id
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (b.game?.game_date ?? '').localeCompare(a.game?.game_date ?? '') || b.id - a.id)
    .filter((r) => {
      const key = `${r.player_id}_${r.game?.game_date ?? r.game_id}`;
      if (seenPlayerDates.has(key)) return false;
      seenPlayerDates.add(key);
      return true;
    });

  return { playerRecentLogs, playerStatuses };
}

export async function fetchFootballGameBettingContext(
  game: Game,
): Promise<FootballGameBettingContext> {
  const { data } = await withOfflineCache(`fb_bet_ctx_v4_${game.id}`, async () => {
    const [standingsRes, teamAvgsRes, homeRecentGames, awayRecentGames, h2hGames, homePlayersRes, awayPlayersRes] =
      await Promise.all([
        supabase
          .from('team_standings')
          .select('*, team:teams(*)')
          .eq('season_id', game.season_id)
          .in('team_id', [game.home_team_id, game.away_team_id]),
        supabase
          .from('football_team_season_averages')
          .select('*')
          .eq('season_id', game.season_id)
          .in('team_id', [game.home_team_id, game.away_team_id]),
        fetchTeamRecentFinalGames(game, game.home_team_id, true),
        fetchTeamRecentFinalGames(game, game.away_team_id, true),
        fetchHeadToHeadGames(game.league_id, game.home_team_id, game.away_team_id, game.id, true),
        supabase
          .from('football_player_season_averages')
          .select('*')
          .eq('season_id', game.season_id)
          .eq('team_id', game.home_team_id)
          .gt('gp', 0)
          .order('starts', { ascending: false })
          .order('shots', { ascending: false })
          .order('goals', { ascending: false })
          .limit(13),
        supabase
          .from('football_player_season_averages')
          .select('*')
          .eq('season_id', game.season_id)
          .eq('team_id', game.away_team_id)
          .gt('gp', 0)
          .order('starts', { ascending: false })
          .order('shots', { ascending: false })
          .order('goals', { ascending: false })
          .limit(13),
      ]);

    const keyPlayers = [
      ...((homePlayersRes.data ?? []) as FootballPlayerSeasonAverage[]),
      ...((awayPlayersRes.data ?? []) as FootballPlayerSeasonAverage[]),
    ];
    const playerIds = Array.from(new Set(keyPlayers.map((p) => p.player_id)));
    const { playerRecentLogs, playerStatuses } = await fetchCleanLogsAndStatuses(game, playerIds);

    const standings = (standingsRes.data ?? []) as unknown as TeamStanding[];
    const teamAvgs = (teamAvgsRes.data ?? []) as FootballTeamSeasonAverage[];
    return {
      homeStanding: standings.find((s) => s.team_id === game.home_team_id) ?? null,
      awayStanding: standings.find((s) => s.team_id === game.away_team_id) ?? null,
      homeTeamAvg: teamAvgs.find((t) => t.team_id === game.home_team_id) ?? null,
      awayTeamAvg: teamAvgs.find((t) => t.team_id === game.away_team_id) ?? null,
      homeRecentGames,
      awayRecentGames,
      h2hGames,
      keyPlayers,
      playerRecentLogs,
      playerStatuses,
    };
  });
  return data;
}

export async function fetchGameBettingContext(game: Game): Promise<GameBettingContext> {
  const { data } = await withOfflineCache(`bet_ctx_v5_${game.id}`, async () => {
    const [standingsRes, teamAvgsRes, homeRecentGames, awayRecentGames, h2hGames, homePlayersRes, awayPlayersRes] =
      await Promise.all([
        supabase
          .from('team_standings')
          .select('*, team:teams(*)')
          .eq('season_id', game.season_id)
          .in('team_id', [game.home_team_id, game.away_team_id]),
        supabase
          .from('team_season_averages')
          .select('*')
          .eq('season_id', game.season_id)
          .in('team_id', [game.home_team_id, game.away_team_id]),
        fetchTeamRecentFinalGames(game, game.home_team_id, false),
        fetchTeamRecentFinalGames(game, game.away_team_id, false),
        fetchHeadToHeadGames(game.league_id, game.home_team_id, game.away_team_id, game.id, false),
        supabase
          .from('player_season_averages')
          .select('*')
          .eq('season_id', game.season_id)
          .eq('team_id', game.home_team_id)
          .gt('gp', 0)
          .order('ppg', { ascending: false, nullsFirst: false })
          .limit(8),
        supabase
          .from('player_season_averages')
          .select('*')
          .eq('season_id', game.season_id)
          .eq('team_id', game.away_team_id)
          .gt('gp', 0)
          .order('ppg', { ascending: false, nullsFirst: false })
          .limit(8),
      ]);

    const keyPlayers = [
      ...((homePlayersRes.data ?? []) as PlayerSeasonAverage[]),
      ...((awayPlayersRes.data ?? []) as PlayerSeasonAverage[]),
    ];
    const playerIds = Array.from(new Set(keyPlayers.map((p) => p.player_id)));
    const { playerRecentLogs, playerStatuses } = await fetchCleanLogsAndStatuses(game, playerIds);

    const standings = (standingsRes.data ?? []) as unknown as TeamStanding[];
    const teamAvgs = (teamAvgsRes.data ?? []) as TeamSeasonAverage[];
    return {
      homeStanding: standings.find((s) => s.team_id === game.home_team_id) ?? null,
      awayStanding: standings.find((s) => s.team_id === game.away_team_id) ?? null,
      homeTeamAvg: teamAvgs.find((t) => t.team_id === game.home_team_id) ?? null,
      awayTeamAvg: teamAvgs.find((t) => t.team_id === game.away_team_id) ?? null,
      homeRecentGames,
      awayRecentGames,
      h2hGames,
      keyPlayers,
      playerRecentLogs,
      playerStatuses,
    };
  });
  return data;
}
