-- Enriched Football team and player season average views with conceded/drawn metrics,
-- passing/defensive averages, BTTS/Over rates, 1st half scoring, and home/away splits.
-- Preserves exact existing column order & types, appending new columns cleanly at the end.

CREATE OR REPLACE VIEW public.football_player_season_averages
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
  (COUNT(*) FILTER (WHERE NOT pgs.did_not_play))::integer AS gp,
  (COUNT(*) FILTER (WHERE pgs.starter AND NOT pgs.did_not_play))::integer AS starts,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'goals')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS goals,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'assists')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS assists,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'shots')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS shots,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'shots_on_target')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS shots_on_target,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'yellow_cards')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS yellow_cards,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'red_cards')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS red_cards,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'fouls_committed')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS fouls_committed,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'fouls_suffered')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS fouls_suffered,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'saves')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS saves,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'goals_conceded')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS goals_conceded,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'goals')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS goals_pg,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'assists')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS assists_pg,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'shots')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS shots_pg,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'shots_on_target')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS sot_pg,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'fouls_committed')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS fouls_committed_pg,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'fouls_suffered')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS fouls_suffered_pg,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'yellow_cards')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS yellow_cards_pg,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'saves')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS saves_pg,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'goals')::integer, 0) + COALESCE((pgs.sport_stats->>'assists')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS goal_contrib,
  ROUND(AVG(COALESCE((pgs.sport_stats->>'goals')::numeric, 0) + COALESCE((pgs.sport_stats->>'assists')::numeric, 0)) FILTER (WHERE NOT pgs.did_not_play), 2) AS goal_contrib_pg,
  (COALESCE(SUM(COALESCE((pgs.sport_stats->>'offsides')::integer, 0)) FILTER (WHERE NOT pgs.did_not_play), 0))::integer AS offsides
FROM public.player_game_stats pgs
JOIN public.games g ON g.id = pgs.game_id
JOIN public.leagues l ON l.id = g.league_id
JOIN public.players p ON p.id = pgs.player_id
LEFT JOIN public.teams t ON t.id = p.team_id
WHERE l.sport = 'football'
  AND g.status = 'final'
GROUP BY
  p.id, p.league_id, g.season_id, p.team_id,
  p.full_name, p.jersey_number, p."position", p.headshot_url,
  t.name, t.short_name, t.abbreviation, t.primary_color, t.logo_url;


CREATE OR REPLACE VIEW public.football_team_season_averages
WITH (security_invoker = true) AS
WITH base_games AS (
  SELECT
    g.league_id,
    g.season_id,
    g.home_team_id,
    g.away_team_id,
    g.home_score,
    g.away_score,
    g.home_linescores,
    g.away_linescores,
    g.sport_stats->'home' AS hs,
    g.sport_stats->'away' AS as_,
    (
      COALESCE(NULLIF(g.sport_stats->'home'->>'shots', '')::integer, 0)
      + COALESCE(NULLIF(g.sport_stats->'away'->>'shots', '')::integer, 0)
      + COALESCE(NULLIF(g.sport_stats->'home'->>'corners', '')::integer, 0)
      + COALESCE(NULLIF(g.sport_stats->'away'->>'corners', '')::integer, 0)
      + COALESCE(NULLIF(g.sport_stats->'home'->>'fouls', '')::integer, 0)
      + COALESCE(NULLIF(g.sport_stats->'away'->>'fouls', '')::integer, 0)
    ) > 0 AS has_box
  FROM public.games g
  JOIN public.leagues l ON l.id = g.league_id
  WHERE l.sport = 'football' AND g.status = 'final'
),
team_matches AS (
  SELECT
    bg.league_id,
    bg.season_id,
    bg.home_team_id AS team_id,
    true AS is_home,
    bg.home_score AS gf,
    bg.away_score AS ga,
    CASE WHEN jsonb_typeof(bg.home_linescores) = 'array' AND jsonb_array_length(bg.home_linescores) > 0
      THEN NULLIF(bg.home_linescores->>0, '')::numeric ELSE NULL END AS ht_gf,
    CASE WHEN jsonb_typeof(bg.away_linescores) = 'array' AND jsonb_array_length(bg.away_linescores) > 0
      THEN NULLIF(bg.away_linescores->>0, '')::numeric ELSE NULL END AS ht_ga,
    NULLIF((bg.hs->>'possession_pct'), '')::numeric AS possession_pct,
    CASE WHEN bg.has_box THEN NULLIF((bg.hs->>'shots'), '')::numeric ELSE NULL END AS shots,
    CASE WHEN bg.has_box THEN NULLIF((bg.as_->>'shots'), '')::numeric ELSE NULL END AS opp_shots,
    CASE WHEN bg.has_box THEN NULLIF((bg.hs->>'shots_on_target'), '')::numeric ELSE NULL END AS sot,
    CASE WHEN bg.has_box THEN NULLIF((bg.as_->>'shots_on_target'), '')::numeric ELSE NULL END AS opp_sot,
    CASE WHEN bg.has_box THEN NULLIF((bg.hs->>'corners'), '')::numeric ELSE NULL END AS corners,
    CASE WHEN bg.has_box THEN NULLIF((bg.as_->>'corners'), '')::numeric ELSE NULL END AS opp_corners,
    CASE WHEN bg.has_box THEN NULLIF((bg.hs->>'fouls'), '')::numeric ELSE NULL END AS fouls,
    CASE WHEN bg.has_box THEN NULLIF((bg.as_->>'fouls'), '')::numeric ELSE NULL END AS opp_fouls,
    COALESCE(NULLIF((bg.hs->>'yellow_cards'), '')::integer, 0) AS yellow_cards,
    COALESCE(NULLIF((bg.as_->>'yellow_cards'), '')::integer, 0) AS opp_yellow_cards,
    COALESCE(NULLIF((bg.hs->>'red_cards'), '')::integer, 0) AS red_cards,
    CASE WHEN bg.has_box THEN NULLIF((bg.hs->>'offsides'), '')::numeric ELSE NULL END AS offsides,
    CASE WHEN bg.has_box THEN NULLIF((bg.hs->>'saves'), '')::numeric ELSE NULL END AS saves,
    NULLIF((bg.hs->>'total_passes'), '')::numeric AS total_passes,
    NULLIF((bg.hs->>'pass_pct'), '')::numeric AS pass_pct,
    NULLIF((bg.hs->>'tackles'), '')::numeric AS tackles,
    NULLIF((bg.hs->>'interceptions'), '')::numeric AS interceptions
  FROM base_games bg
  UNION ALL
  SELECT
    bg.league_id,
    bg.season_id,
    bg.away_team_id AS team_id,
    false AS is_home,
    bg.away_score AS gf,
    bg.home_score AS ga,
    CASE WHEN jsonb_typeof(bg.away_linescores) = 'array' AND jsonb_array_length(bg.away_linescores) > 0
      THEN NULLIF(bg.away_linescores->>0, '')::numeric ELSE NULL END AS ht_gf,
    CASE WHEN jsonb_typeof(bg.home_linescores) = 'array' AND jsonb_array_length(bg.home_linescores) > 0
      THEN NULLIF(bg.home_linescores->>0, '')::numeric ELSE NULL END AS ht_ga,
    NULLIF((bg.as_->>'possession_pct'), '')::numeric AS possession_pct,
    CASE WHEN bg.has_box THEN NULLIF((bg.as_->>'shots'), '')::numeric ELSE NULL END AS shots,
    CASE WHEN bg.has_box THEN NULLIF((bg.hs->>'shots'), '')::numeric ELSE NULL END AS opp_shots,
    CASE WHEN bg.has_box THEN NULLIF((bg.as_->>'shots_on_target'), '')::numeric ELSE NULL END AS sot,
    CASE WHEN bg.has_box THEN NULLIF((bg.hs->>'shots_on_target'), '')::numeric ELSE NULL END AS opp_sot,
    CASE WHEN bg.has_box THEN NULLIF((bg.as_->>'corners'), '')::numeric ELSE NULL END AS corners,
    CASE WHEN bg.has_box THEN NULLIF((bg.hs->>'corners'), '')::numeric ELSE NULL END AS opp_corners,
    CASE WHEN bg.has_box THEN NULLIF((bg.as_->>'fouls'), '')::numeric ELSE NULL END AS fouls,
    CASE WHEN bg.has_box THEN NULLIF((bg.hs->>'fouls'), '')::numeric ELSE NULL END AS opp_fouls,
    COALESCE(NULLIF((bg.as_->>'yellow_cards'), '')::integer, 0) AS yellow_cards,
    COALESCE(NULLIF((bg.hs->>'yellow_cards'), '')::integer, 0) AS opp_yellow_cards,
    COALESCE(NULLIF((bg.as_->>'red_cards'), '')::integer, 0) AS red_cards,
    CASE WHEN bg.has_box THEN NULLIF((bg.as_->>'offsides'), '')::numeric ELSE NULL END AS offsides,
    CASE WHEN bg.has_box THEN NULLIF((bg.as_->>'saves'), '')::numeric ELSE NULL END AS saves,
    NULLIF((bg.as_->>'total_passes'), '')::numeric AS total_passes,
    NULLIF((bg.as_->>'pass_pct'), '')::numeric AS pass_pct,
    NULLIF((bg.as_->>'tackles'), '')::numeric AS tackles,
    NULLIF((bg.as_->>'interceptions'), '')::numeric AS interceptions
  FROM base_games bg
),
agg AS (
  SELECT
    tm.team_id,
    tm.league_id,
    tm.season_id,
    COUNT(*)::integer AS gp_tracked,
    ROUND(AVG(tm.gf), 2) AS gf_pg,
    ROUND(AVG(tm.ga), 2) AS ga_pg,
    ROUND(AVG(tm.possession_pct), 1) AS possession_avg,
    ROUND(AVG(tm.shots), 1) AS shots_pg,
    ROUND(AVG(tm.sot), 1) AS sot_pg,
    ROUND(AVG(tm.corners), 1) AS corners_pg,
    ROUND(AVG(tm.fouls), 1) AS fouls_pg,
    SUM(tm.yellow_cards)::integer AS yellow_cards,
    SUM(tm.red_cards)::integer AS red_cards,
    (COUNT(*) FILTER (WHERE tm.ga = 0))::integer AS clean_sheets,
    ROUND(AVG(tm.opp_corners), 1) AS corners_against_pg,
    ROUND(AVG(tm.opp_fouls), 1) AS fouls_drawn_pg,
    ROUND(AVG(tm.opp_shots), 1) AS shots_against_pg,
    ROUND(AVG(tm.opp_sot), 1) AS sot_against_pg,
    ROUND(AVG(tm.yellow_cards::numeric), 2) AS yellow_cards_pg,
    ROUND(AVG(tm.opp_yellow_cards::numeric), 2) AS cards_against_pg,
    ROUND(AVG(tm.offsides), 1) AS offsides_pg,
    ROUND(AVG(tm.saves), 1) AS saves_pg,
    ROUND(AVG(tm.total_passes), 1) AS passes_pg,
    ROUND(AVG(tm.pass_pct), 1) AS pass_pct_avg,
    ROUND(AVG(tm.tackles), 1) AS tackles_pg,
    ROUND(AVG(tm.interceptions), 1) AS interceptions_pg,
    ROUND(100.0 * COUNT(*) FILTER (WHERE tm.gf > 0 AND tm.ga > 0) / NULLIF(COUNT(*), 0), 1) AS btts_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE tm.gf + tm.ga >= 3) / NULLIF(COUNT(*), 0), 1) AS over_25_pct,
    ROUND(100.0 * COUNT(*) FILTER (WHERE tm.gf + tm.ga >= 2) / NULLIF(COUNT(*), 0), 1) AS over_15_pct,
    ROUND(AVG(tm.ht_gf), 2) AS ht_gf_pg,
    ROUND(AVG(tm.ht_ga), 2) AS ht_ga_pg,
    ROUND(AVG(tm.gf) FILTER (WHERE tm.is_home), 2) AS home_gf_pg,
    ROUND(AVG(tm.ga) FILTER (WHERE tm.is_home), 2) AS home_ga_pg,
    ROUND(AVG(tm.gf) FILTER (WHERE NOT tm.is_home), 2) AS away_gf_pg,
    ROUND(AVG(tm.ga) FILTER (WHERE NOT tm.is_home), 2) AS away_ga_pg
  FROM team_matches tm
  GROUP BY tm.team_id, tm.league_id, tm.season_id
)
SELECT
  t.id AS team_id,
  t.league_id,
  s.id AS season_id,
  t.name AS team_name,
  t.short_name AS team_short_name,
  t.abbreviation AS team_abbreviation,
  t.primary_color,
  t.alternate_color,
  t.logo_url,
  ts.playoff_seed AS rank,
  GREATEST(COALESCE(ts.played::integer, 0), COALESCE(agg.gp_tracked, 0)) AS played,
  COALESCE(ts.wins::integer, 0) AS wins,
  COALESCE(ts.draws::integer, 0) AS draws,
  COALESCE(ts.losses::integer, 0) AS losses,
  COALESCE(ts.points::integer, 0) AS points,
  COALESCE(ts.goals_for::integer, 0) AS goals_for,
  COALESCE(ts.goals_against::integer, 0) AS goals_against,
  COALESCE(ts.goal_diff::integer, 0) AS goal_diff,
  COALESCE(ts.win_pct, 0::numeric) AS win_pct,
  COALESCE(agg.gf_pg, 0::numeric) AS gf_pg,
  COALESCE(agg.ga_pg, 0::numeric) AS ga_pg,
  agg.possession_avg,
  agg.shots_pg,
  agg.sot_pg,
  agg.corners_pg,
  agg.fouls_pg,
  COALESCE(agg.yellow_cards, 0) AS yellow_cards,
  COALESCE(agg.red_cards, 0) AS red_cards,
  COALESCE(agg.clean_sheets, 0) AS clean_sheets,
  agg.corners_against_pg,
  agg.fouls_drawn_pg,
  agg.shots_against_pg,
  agg.sot_against_pg,
  agg.yellow_cards_pg,
  agg.cards_against_pg,
  agg.offsides_pg,
  agg.saves_pg,
  agg.passes_pg,
  agg.pass_pct_avg,
  agg.tackles_pg,
  agg.interceptions_pg,
  agg.btts_pct,
  agg.over_25_pct,
  agg.over_15_pct,
  agg.ht_gf_pg,
  agg.ht_ga_pg,
  agg.home_gf_pg,
  agg.home_ga_pg,
  agg.away_gf_pg,
  agg.away_ga_pg
FROM public.teams t
JOIN public.leagues l ON l.id = t.league_id AND l.sport = 'football'
JOIN public.seasons s ON s.league_id = t.league_id AND s.is_current = true
LEFT JOIN public.team_standings ts ON ts.team_id = t.id AND ts.season_id = s.id
LEFT JOIN agg ON agg.team_id = t.id AND agg.season_id = s.id;

GRANT SELECT ON public.football_player_season_averages TO anon, authenticated;
GRANT SELECT ON public.football_team_season_averages TO anon, authenticated;
