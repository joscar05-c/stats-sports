-- Clean corrupted cross-game NBA boxscore rows (2026-10-26..2026-11-02),
-- add integrity trigger on player_game_stats, index for recent logs, and harden views.

-- 1. Delete cross-game mismatched player_game_stats rows
DELETE FROM public.player_game_stats pgs
USING public.games g
WHERE g.id = pgs.game_id
  AND pgs.team_id <> g.home_team_id
  AND pgs.team_id <> g.away_team_id;

-- 2. Remove the two extra wrong-game orphan player rows verified against ESPN boxscores
DELETE FROM public.player_game_stats pgs
USING public.games g, public.players p
WHERE g.id = pgs.game_id
  AND p.id = pgs.player_id
  AND (
    (g.external_id = '401909903' AND p.external_id = '4432165') -- Jalen Suggs did not play in ORL vs BOS 2026-11-01
    OR
    (g.external_id = '401909916' AND p.external_id = '4251') -- Paul George did not play in BOS @ HOU 2026-11-02
  );

-- 3. Enforce game-team membership on player_game_stats going forward
CREATE OR REPLACE FUNCTION public.validate_pgs_team_in_game()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_home integer;
  v_away integer;
BEGIN
  SELECT g.home_team_id, g.away_team_id
    INTO v_home, v_away
  FROM public.games g
  WHERE g.id = NEW.game_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game % does not exist for player_game_stats', NEW.game_id;
  END IF;

  IF NEW.team_id <> v_home AND NEW.team_id <> v_away THEN
    RAISE EXCEPTION 'team_id % does not participate in game % (home=%, away=%)',
      NEW.team_id, NEW.game_id, v_home, v_away;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_pgs_team_in_game ON public.player_game_stats;
CREATE TRIGGER trg_validate_pgs_team_in_game
  BEFORE INSERT OR UPDATE OF game_id, team_id
  ON public.player_game_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_pgs_team_in_game();

-- 4. Index to accelerate chronological per-player recent log lookups
CREATE INDEX IF NOT EXISTS player_game_stats_player_dnp_game_idx
  ON public.player_game_stats (player_id, did_not_play, game_id DESC);

-- 5. Harden season average views with explicit team-in-game filter + security_invoker
CREATE OR REPLACE VIEW public.player_season_averages
WITH (security_invoker = true) AS
SELECT
  p.id AS player_id,
  p.league_id,
  g.season_id,
  p.team_id,
  p.full_name,
  p.jersey_number,
  p."position",
  p.headshot_url,
  t.name AS team_name,
  t.short_name AS team_short_name,
  t.abbreviation AS team_abbreviation,
  t.primary_color AS team_primary_color,
  t.logo_url AS team_logo_url,
  (count(*) FILTER (WHERE NOT pgs.did_not_play))::integer AS gp,
  round(avg(pgs.minutes) FILTER (WHERE NOT pgs.did_not_play), 1) AS mpg,
  round(avg(pgs.pts) FILTER (WHERE NOT pgs.did_not_play), 1) AS ppg,
  round(avg(pgs.reb) FILTER (WHERE NOT pgs.did_not_play), 1) AS rpg,
  round(avg(pgs.ast) FILTER (WHERE NOT pgs.did_not_play), 1) AS apg,
  round(avg(pgs.stl) FILTER (WHERE NOT pgs.did_not_play), 1) AS spg,
  round(avg(pgs.blk) FILTER (WHERE NOT pgs.did_not_play), 1) AS bpg,
  round(avg(pgs.tov) FILTER (WHERE NOT pgs.did_not_play), 1) AS topg,
  round(avg(pgs.plus_minus) FILTER (WHERE NOT pgs.did_not_play), 1) AS plus_minus_avg,
  round(((sum(pgs.fgm) FILTER (WHERE NOT pgs.did_not_play))::numeric * 100.0) / (NULLIF(sum(pgs.fga) FILTER (WHERE NOT pgs.did_not_play), 0))::numeric, 1) AS fg_pct,
  round(((sum(pgs.tpm) FILTER (WHERE NOT pgs.did_not_play))::numeric * 100.0) / (NULLIF(sum(pgs.tpa) FILTER (WHERE NOT pgs.did_not_play), 0))::numeric, 1) AS tp_pct,
  round(((sum(pgs.ftm) FILTER (WHERE NOT pgs.did_not_play))::numeric * 100.0) / (NULLIF(sum(pgs.fta) FILTER (WHERE NOT pgs.did_not_play), 0))::numeric, 1) AS ft_pct,
  round((((sum(pgs.fgm) FILTER (WHERE NOT pgs.did_not_play))::numeric + 0.5 * (sum(pgs.tpm) FILTER (WHERE NOT pgs.did_not_play))::numeric) * 100.0) / (NULLIF(sum(pgs.fga) FILTER (WHERE NOT pgs.did_not_play), 0))::numeric, 1) AS efg_pct,
  round(((sum(pgs.pts) FILTER (WHERE NOT pgs.did_not_play))::numeric * 100.0) / NULLIF(2.0 * ((sum(pgs.fga) FILTER (WHERE NOT pgs.did_not_play))::numeric + 0.44 * (sum(pgs.fta) FILTER (WHERE NOT pgs.did_not_play))::numeric), 0::numeric), 1) AS ts_pct,
  (count(*) FILTER (
    WHERE NOT pgs.did_not_play AND (
      (CASE WHEN pgs.pts >= 10 THEN 1 ELSE 0 END) +
      (CASE WHEN pgs.reb >= 10 THEN 1 ELSE 0 END) +
      (CASE WHEN pgs.ast >= 10 THEN 1 ELSE 0 END) +
      (CASE WHEN pgs.stl >= 10 THEN 1 ELSE 0 END) +
      (CASE WHEN pgs.blk >= 10 THEN 1 ELSE 0 END)
    ) >= 2
  ))::integer AS double_doubles,
  (count(*) FILTER (
    WHERE NOT pgs.did_not_play AND (
      (CASE WHEN pgs.pts >= 10 THEN 1 ELSE 0 END) +
      (CASE WHEN pgs.reb >= 10 THEN 1 ELSE 0 END) +
      (CASE WHEN pgs.ast >= 10 THEN 1 ELSE 0 END) +
      (CASE WHEN pgs.stl >= 10 THEN 1 ELSE 0 END) +
      (CASE WHEN pgs.blk >= 10 THEN 1 ELSE 0 END)
    ) >= 3
  ))::integer AS triple_doubles,
  (COALESCE(sum(pgs.pts) FILTER (WHERE NOT pgs.did_not_play), 0::bigint))::integer AS total_pts,
  (COALESCE(sum(pgs.reb) FILTER (WHERE NOT pgs.did_not_play), 0::bigint))::integer AS total_reb,
  (COALESCE(sum(pgs.ast) FILTER (WHERE NOT pgs.did_not_play), 0::bigint))::integer AS total_ast
FROM public.player_game_stats pgs
JOIN public.games g ON g.id = pgs.game_id
JOIN public.players p ON p.id = pgs.player_id
LEFT JOIN public.teams t ON t.id = p.team_id
WHERE g.status = 'final'
  AND (pgs.team_id = g.home_team_id OR pgs.team_id = g.away_team_id)
GROUP BY
  p.id, p.league_id, g.season_id, p.team_id,
  p.full_name, p.jersey_number, p."position", p.headshot_url,
  t.name, t.short_name, t.abbreviation, t.primary_color, t.logo_url;

CREATE OR REPLACE VIEW public.team_season_averages
WITH (security_invoker = true) AS
WITH team_game_totals AS (
  SELECT
    pgs.game_id,
    pgs.team_id,
    g.league_id,
    g.season_id,
    CASE WHEN g.home_team_id = pgs.team_id THEN g.home_score ELSE g.away_score END AS team_score,
    CASE WHEN g.home_team_id = pgs.team_id THEN g.away_score ELSE g.home_score END AS opp_score,
    sum(pgs.pts) FILTER (WHERE NOT pgs.did_not_play) AS pts,
    sum(pgs.pts) FILTER (WHERE NOT pgs.did_not_play AND NOT pgs.starter) AS bench_pts,
    sum(pgs.reb) FILTER (WHERE NOT pgs.did_not_play) AS reb,
    sum(pgs.oreb) FILTER (WHERE NOT pgs.did_not_play) AS oreb,
    sum(pgs.dreb) FILTER (WHERE NOT pgs.did_not_play) AS dreb,
    sum(pgs.ast) FILTER (WHERE NOT pgs.did_not_play) AS ast,
    sum(pgs.stl) FILTER (WHERE NOT pgs.did_not_play) AS stl,
    sum(pgs.blk) FILTER (WHERE NOT pgs.did_not_play) AS blk,
    sum(pgs.tov) FILTER (WHERE NOT pgs.did_not_play) AS tov,
    sum(pgs.pf) FILTER (WHERE NOT pgs.did_not_play) AS pf,
    sum(pgs.fgm) FILTER (WHERE NOT pgs.did_not_play) AS fgm,
    sum(pgs.fga) FILTER (WHERE NOT pgs.did_not_play) AS fga,
    sum(pgs.tpm) FILTER (WHERE NOT pgs.did_not_play) AS tpm,
    sum(pgs.tpa) FILTER (WHERE NOT pgs.did_not_play) AS tpa,
    sum(pgs.ftm) FILTER (WHERE NOT pgs.did_not_play) AS ftm,
    sum(pgs.fta) FILTER (WHERE NOT pgs.did_not_play) AS fta
  FROM public.player_game_stats pgs
  JOIN public.games g ON g.id = pgs.game_id
  WHERE g.status = 'final'
    AND (pgs.team_id = g.home_team_id OR pgs.team_id = g.away_team_id)
  GROUP BY pgs.game_id, pgs.team_id, g.league_id, g.season_id, g.home_team_id, g.home_score, g.away_score
),
agg AS (
  SELECT
    team_game_totals.team_id,
    team_game_totals.league_id,
    team_game_totals.season_id,
    (count(*))::integer AS gp_tracked,
    round(avg(COALESCE((NULLIF(team_game_totals.team_score, 0))::bigint, team_game_totals.pts)), 1) AS ppg,
    round(avg(team_game_totals.opp_score), 1) AS oppg,
    round(avg(COALESCE(team_game_totals.bench_pts, 0::bigint)), 1) AS bench_ppg,
    round(avg(team_game_totals.reb), 1) AS rpg,
    round(avg(team_game_totals.oreb), 1) AS oreb_pg,
    round(avg(team_game_totals.dreb), 1) AS dreb_pg,
    round(avg(team_game_totals.ast), 1) AS apg,
    round(avg(team_game_totals.stl), 1) AS spg,
    round(avg(team_game_totals.blk), 1) AS bpg,
    round(avg(team_game_totals.tov), 1) AS topg,
    round(avg(team_game_totals.pf), 1) AS pf_pg,
    round(avg(team_game_totals.fgm), 1) AS fgm_pg,
    round(avg(team_game_totals.fga), 1) AS fga_pg,
    round((sum(team_game_totals.fgm) * 100.0) / NULLIF(sum(team_game_totals.fga), 0::numeric), 1) AS fg_pct,
    round(avg(team_game_totals.tpm), 1) AS tpm_pg,
    round(avg(team_game_totals.tpa), 1) AS tpa_pg,
    round((sum(team_game_totals.tpm) * 100.0) / NULLIF(sum(team_game_totals.tpa), 0::numeric), 1) AS tp_pct,
    round(avg(team_game_totals.ftm), 1) AS ftm_pg,
    round(avg(team_game_totals.fta), 1) AS fta_pg,
    round((sum(team_game_totals.ftm) * 100.0) / NULLIF(sum(team_game_totals.fta), 0::numeric), 1) AS ft_pct,
    round(((sum(team_game_totals.fgm) + 0.5 * sum(team_game_totals.tpm)) * 100.0) / NULLIF(sum(team_game_totals.fga), 0::numeric), 1) AS efg_pct,
    round((sum(team_game_totals.pts) * 100.0) / NULLIF(2.0 * (sum(team_game_totals.fga) + 0.44 * sum(team_game_totals.fta)), 0::numeric), 1) AS ts_pct,
    round(sum(team_game_totals.ast) / NULLIF(sum(team_game_totals.tov), 0::numeric), 2) AS ast_to_tov
  FROM team_game_totals
  GROUP BY team_game_totals.team_id, team_game_totals.league_id, team_game_totals.season_id
)
SELECT
  t.id AS team_id,
  t.league_id,
  s.id AS season_id,
  t.name AS team_name,
  t.short_name AS team_short_name,
  t.abbreviation AS team_abbreviation,
  COALESCE(ts.conference, t.conference) AS conference,
  t.division,
  t.primary_color,
  t.alternate_color,
  t.logo_url,
  ts.playoff_seed,
  COALESCE((ts.wins)::integer, 0) AS wins,
  COALESCE((ts.losses)::integer, 0) AS losses,
  COALESCE(ts.win_pct, 0::numeric) AS win_pct,
  ts.home_record,
  ts.away_record,
  ts.last_ten,
  ts.streak,
  GREATEST(COALESCE((ts.wins + ts.losses)::integer, 0), COALESCE(agg.gp_tracked, 0)) AS gp,
  COALESCE(ts.ppg, agg.ppg, 0::numeric) AS ppg,
  COALESCE(ts.oppg, agg.oppg, 0::numeric) AS oppg,
  COALESCE(ts.diff, round(COALESCE(ts.ppg, agg.ppg, 0::numeric) - COALESCE(ts.oppg, agg.oppg, 0::numeric), 1)) AS diff,
  COALESCE(agg.bench_ppg, 0::numeric) AS bench_ppg,
  COALESCE(agg.rpg, 0::numeric) AS rpg,
  COALESCE(agg.oreb_pg, 0::numeric) AS oreb_pg,
  COALESCE(agg.dreb_pg, 0::numeric) AS dreb_pg,
  COALESCE(agg.apg, 0::numeric) AS apg,
  COALESCE(agg.spg, 0::numeric) AS spg,
  COALESCE(agg.bpg, 0::numeric) AS bpg,
  COALESCE(agg.topg, 0::numeric) AS topg,
  COALESCE(agg.pf_pg, 0::numeric) AS pf_pg,
  COALESCE(agg.fgm_pg, 0::numeric) AS fgm_pg,
  COALESCE(agg.fga_pg, 0::numeric) AS fga_pg,
  agg.fg_pct,
  COALESCE(agg.tpm_pg, 0::numeric) AS tpm_pg,
  COALESCE(agg.tpa_pg, 0::numeric) AS tpa_pg,
  agg.tp_pct,
  COALESCE(agg.ftm_pg, 0::numeric) AS ftm_pg,
  COALESCE(agg.fta_pg, 0::numeric) AS fta_pg,
  agg.ft_pct,
  agg.efg_pct,
  agg.ts_pct,
  agg.ast_to_tov
FROM public.teams t
JOIN public.seasons s ON s.league_id = t.league_id AND s.is_current = true
LEFT JOIN public.team_standings ts ON ts.team_id = t.id AND ts.season_id = s.id
LEFT JOIN agg ON agg.team_id = t.id AND agg.season_id = s.id;

GRANT SELECT ON public.player_season_averages TO anon, authenticated;
GRANT SELECT ON public.team_season_averages TO anon, authenticated;
