-- T0.2: Initial schema for WC2026
-- Immutable schedule tables + mutable match_state overlay

-- Teams
create table teams (
  id          serial primary key,
  name        text not null unique,
  flag        text not null default '⚽',
  is_host     boolean not null default false
);

-- Venues
create table venues (
  code        text primary key,
  common_name text not null,
  fifa_name   text not null,
  city        text not null,
  country     text not null,
  capacity    integer not null
);

-- Groups
create table groups (
  letter      char(1) primary key,
  color       text not null
);

-- Group memberships (which teams belong to which group)
create table group_teams (
  group_letter char(1) not null references groups(letter),
  team_id      integer not null references teams(id),
  position     smallint not null,
  primary key (group_letter, team_id)
);

-- Matches (immutable 104-match schedule)
-- For group-stage matches: group_letter and match_number are set, round is null.
-- For knockout matches: round is set (e.g. 'Round of 32'), group_letter is null,
--   home_team_id and away_team_id are null until resolved from results.
create table matches (
  id             serial primary key,
  match_number   smallint not null unique,
  stage          text not null check (stage in ('group', 'knockout')),
  group_letter   char(1) references groups(letter),
  round          text,
  match_range    text,
  home_team_id   integer references teams(id),
  away_team_id   integer references teams(id),
  venue_code     text not null references venues(code),
  kickoff_utc    timestamptz not null,
  local_time     text not null,
  et_time        text not null,
  iso_date       date not null
);

create index idx_matches_kickoff on matches(kickoff_utc);
create index idx_matches_group on matches(group_letter) where group_letter is not null;
create index idx_matches_stage on matches(stage);

-- Match state (mutable — updated by the ingestion worker)
-- One row per match, upserted on each poll cycle.
create table match_state (
  match_id       integer primary key references matches(id),
  status         text not null default 'NS',
  elapsed        smallint,
  home_goals     smallint,
  away_goals     smallint,
  vendor_fixture_id bigint,
  updated_at     timestamptz not null default now()
);

-- Enable realtime on match_state for T0.4
alter publication supabase_realtime add table match_state;

-- Row-level security: public read, service-role write
alter table teams enable row level security;
alter table venues enable row level security;
alter table groups enable row level security;
alter table group_teams enable row level security;
alter table matches enable row level security;
alter table match_state enable row level security;

create policy "Public read teams" on teams for select using (true);
create policy "Public read venues" on venues for select using (true);
create policy "Public read groups" on groups for select using (true);
create policy "Public read group_teams" on group_teams for select using (true);
create policy "Public read matches" on matches for select using (true);
create policy "Public read match_state" on match_state for select using (true);
