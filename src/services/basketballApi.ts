import { clearOfflineCache, supabase, supabaseUrlResolved, withOfflineCache } from '../lib/supabase';
import type {
  Game,
  League,
  Player,
  PlayerGameStat,
  PlayerSeasonAverage,
  Season,
  SyncRun,
  Team,
  TeamStanding,
} from '../types/database';

export async function fetchLeagues(): Promise<{ data: League[]; fromCache: boolean }> {
  return withOfflineCache('leagues', async () => {
    const { data, error } = await supabase
      .from('leagues')
      .select('id, slug, name, short_name, country, source_type, logo_url, is_public')
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
): Promise<{ ok: boolean; games_synced?: number; stats_synced?: number }> {
  const resp = await fetch(`${supabaseUrlResolved.replace(/\/$/, '')}/functions/v1/sync-nba`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days_back: daysBack, days_ahead: daysAhead }),
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
        home_linescores, away_linescores, venue, odds,
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
      home_linescores, away_linescores, venue, odds,
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

export async function fetchPlayerProfileAndLogs(playerId: number): Promise<{
  player: Player | null;
  average: PlayerSeasonAverage | null;
  logs: PlayerGameStat[];
}> {
  const { data } = await withOfflineCache(`player_detail_${playerId}`, async () => {
    const [playerRes, avgRes, logsRes] = await Promise.all([
      supabase
        .from('players')
        .select(`
          id, league_id, team_id, full_name, jersey_number, position,
          height_display, weight_display, age, country, headshot_url, status,
          team:teams(*)
        `)
        .eq('id', playerId)
        .maybeSingle(),
      supabase
        .from('player_season_averages')
        .select('*')
        .eq('player_id', playerId)
        .limit(1)
        .maybeSingle(),
      supabase
        .from('player_game_stats')
        .select(`
          *,
          game:games(
            id, game_date, home_team_id, away_team_id, home_score, away_score,
            home_team:teams!games_home_team_id_fkey(id, abbreviation, logo_url),
            away_team:teams!games_away_team_id_fkey(id, abbreviation, logo_url)
          )
        `)
        .eq('player_id', playerId)
        .eq('did_not_play', false)
        .order('id', { ascending: false })
        .limit(15),
    ]);

    if (playerRes.error) throw playerRes.error;
    const logs = ((logsRes.data ?? []) as unknown as PlayerGameStat[]).sort((a, b) =>
      (b.game?.game_date ?? '').localeCompare(a.game?.game_date ?? ''),
    );

    return {
      player: (playerRes.data ?? null) as unknown as Player | null,
      average: (avgRes.data ?? null) as PlayerSeasonAverage | null,
      logs,
    };
  });
  return data;
}

export async function fetchTeamRosterAndGames(teamId: number): Promise<{
  players: Player[];
  games: Game[];
}> {
  const { data } = await withOfflineCache(`team_detail_${teamId}`, async () => {
    const [rosterRes, gamesRes] = await Promise.all([
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
          home_linescores, away_linescores, venue, odds,
          home_team:teams!games_home_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url),
          away_team:teams!games_away_team_id_fkey(id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url)
        `)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .order('game_date', { ascending: false })
        .limit(12),
    ]);
    if (rosterRes.error) throw rosterRes.error;
    if (gamesRes.error) throw gamesRes.error;
    return {
      players: (rosterRes.data ?? []) as Player[],
      games: (gamesRes.data ?? []) as unknown as Game[],
    };
  });
  return data;
}

export interface GameBettingContext {
  homeStanding: TeamStanding | null;
  awayStanding: TeamStanding | null;
  homeRecentGames: Game[];
  awayRecentGames: Game[];
  keyPlayers: PlayerSeasonAverage[];
}

export async function fetchGameBettingContext(game: Game): Promise<GameBettingContext> {
  const { data } = await withOfflineCache(`bet_ctx_${game.id}`, async () => {
    const teamSelect =
      'id, league_id, external_id, name, short_name, abbreviation, city, conference, division, primary_color, alternate_color, logo_url';
    const [standingsRes, homeGamesRes, awayGamesRes, playersRes] = await Promise.all([
      supabase
        .from('team_standings')
        .select('*, team:teams(*)')
        .eq('season_id', game.season_id)
        .in('team_id', [game.home_team_id, game.away_team_id]),
      supabase
        .from('games')
        .select(
          `id, league_id, season_id, game_date, tipoff_at, status, status_detail, period, clock,
           home_team_id, away_team_id, home_score, away_score, home_linescores, away_linescores, venue, odds,
           home_team:teams!games_home_team_id_fkey(${teamSelect}),
           away_team:teams!games_away_team_id_fkey(${teamSelect})`,
        )
        .eq('season_id', game.season_id)
        .eq('status', 'final')
        .neq('id', game.id)
        .lte('game_date', game.game_date)
        .or(`home_team_id.eq.${game.home_team_id},away_team_id.eq.${game.home_team_id}`)
        .order('game_date', { ascending: false })
        .limit(6),
      supabase
        .from('games')
        .select(
          `id, league_id, season_id, game_date, tipoff_at, status, status_detail, period, clock,
           home_team_id, away_team_id, home_score, away_score, home_linescores, away_linescores, venue, odds,
           home_team:teams!games_home_team_id_fkey(${teamSelect}),
           away_team:teams!games_away_team_id_fkey(${teamSelect})`,
        )
        .eq('season_id', game.season_id)
        .eq('status', 'final')
        .neq('id', game.id)
        .lte('game_date', game.game_date)
        .or(`home_team_id.eq.${game.away_team_id},away_team_id.eq.${game.away_team_id}`)
        .order('game_date', { ascending: false })
        .limit(6),
      supabase
        .from('player_season_averages')
        .select('*')
        .eq('season_id', game.season_id)
        .in('team_id', [game.home_team_id, game.away_team_id])
        .gt('gp', 0)
        .order('ppg', { ascending: false, nullsFirst: false })
        .limit(8),
    ]);

    const standings = (standingsRes.data ?? []) as unknown as TeamStanding[];
    return {
      homeStanding: standings.find((s) => s.team_id === game.home_team_id) ?? null,
      awayStanding: standings.find((s) => s.team_id === game.away_team_id) ?? null,
      homeRecentGames: (homeGamesRes.data ?? []) as unknown as Game[],
      awayRecentGames: (awayGamesRes.data ?? []) as unknown as Game[],
      keyPlayers: (playersRes.data ?? []) as PlayerSeasonAverage[],
    };
  });
  return data;
}
