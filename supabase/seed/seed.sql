-- T0.2: Seed the validated 104-match WC2026 schedule
-- Source of truth: hand-validated dataset cross-checked 11 Jun 2026

-- ============================================================
-- TEAMS (48)
-- ============================================================
insert into teams (name, flag, is_host) values
  ('Mexico', '🇲🇽', true),
  ('Canada', '🇨🇦', true),
  ('United States', '🇺🇸', true),
  ('South Africa', '🇿🇦', false),
  ('South Korea', '🇰🇷', false),
  ('Czechia', '🇨🇿', false),
  ('Bosnia & Herzegovina', '🇧🇦', false),
  ('Qatar', '🇶🇦', false),
  ('Switzerland', '🇨🇭', false),
  ('Brazil', '🇧🇷', false),
  ('Morocco', '🇲🇦', false),
  ('Haiti', '🇭🇹', false),
  ('Scotland', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', false),
  ('Paraguay', '🇵🇾', false),
  ('Australia', '🇦🇺', false),
  ('Türkiye', '🇹🇷', false),
  ('Germany', '🇩🇪', false),
  ('Curaçao', '🇨🇼', false),
  ('Ivory Coast', '🇨🇮', false),
  ('Ecuador', '🇪🇨', false),
  ('Netherlands', '🇳🇱', false),
  ('Japan', '🇯🇵', false),
  ('Sweden', '🇸🇪', false),
  ('Tunisia', '🇹🇳', false),
  ('Belgium', '🇧🇪', false),
  ('Egypt', '🇪🇬', false),
  ('Iran', '🇮🇷', false),
  ('New Zealand', '🇳🇿', false),
  ('Spain', '🇪🇸', false),
  ('Cape Verde', '🇨🇻', false),
  ('Saudi Arabia', '🇸🇦', false),
  ('Uruguay', '🇺🇾', false),
  ('France', '🇫🇷', false),
  ('Senegal', '🇸🇳', false),
  ('Iraq', '🇮🇶', false),
  ('Norway', '🇳🇴', false),
  ('Argentina', '🇦🇷', false),
  ('Algeria', '🇩🇿', false),
  ('Austria', '🇦🇹', false),
  ('Jordan', '🇯🇴', false),
  ('Portugal', '🇵🇹', false),
  ('DR Congo', '🇨🇩', false),
  ('Uzbekistan', '🇺🇿', false),
  ('Colombia', '🇨🇴', false),
  ('England', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', false),
  ('Croatia', '🇭🇷', false),
  ('Ghana', '🇬🇭', false),
  ('Panama', '🇵🇦', false);

-- ============================================================
-- VENUES (16)
-- ============================================================
insert into venues (code, common_name, fifa_name, city, country, capacity) values
  ('AZT',      'Estadio Azteca',           'Mexico City Stadium',              'Mexico City',           'Mexico',  83000),
  ('AKR',      'Estadio Akron',            'Estadio Guadalajara',              'Guadalajara',           'Mexico',  48000),
  ('BBVA',     'Estadio BBVA',             'Estadio Monterrey',                'Monterrey',             'Mexico',  53500),
  ('BMO',      'BMO Field',                'Toronto Stadium',                  'Toronto',               'Canada',  45000),
  ('BCP',      'BC Place',                 'BC Place Vancouver',               'Vancouver',             'Canada',  54000),
  ('SOFI',     'SoFi Stadium',             'Los Angeles Stadium',              'Los Angeles',           'USA',     70000),
  ('LEVI',     'Levi''s Stadium',          'San Francisco Bay Area Stadium',   'SF Bay Area',           'USA',     71000),
  ('LUMEN',    'Lumen Field',              'Seattle Stadium',                  'Seattle',               'USA',     69000),
  ('METLIFE',  'MetLife Stadium',           'New York New Jersey Stadium',      'New York / New Jersey', 'USA',     82500),
  ('GILLETTE', 'Gillette Stadium',          'Boston Stadium',                   'Boston',                'USA',     65000),
  ('LINC',     'Lincoln Financial Field',   'Philadelphia Stadium',             'Philadelphia',          'USA',     69000),
  ('MBS',      'Mercedes-Benz Stadium',     'Atlanta Stadium',                  'Atlanta',               'USA',     75000),
  ('HARDROCK', 'Hard Rock Stadium',         'Miami Stadium',                    'Miami',                 'USA',     65000),
  ('ATT',      'AT&T Stadium',             'Dallas Stadium',                   'Dallas',                'USA',     94000),
  ('NRG',      'NRG Stadium',              'Houston Stadium',                  'Houston',               'USA',     72000),
  ('ARROW',    'Arrowhead Stadium',         'Kansas City Stadium',              'Kansas City',           'USA',     73000);

-- ============================================================
-- GROUPS (12) with colors
-- ============================================================
insert into groups (letter, color) values
  ('A', '#0A5C3E'), ('B', '#1C6E8C'), ('C', '#C04A2B'), ('D', '#2D5BA8'),
  ('E', '#7A4FB5'), ('F', '#A8761F'), ('G', '#1F8A6B'), ('H', '#B23A6F'),
  ('I', '#3F6FB0'), ('J', '#C25E2A'), ('K', '#4F7A2E'), ('L', '#8A4B9C');

-- ============================================================
-- GROUP_TEAMS (48 memberships)
-- ============================================================
insert into group_teams (group_letter, team_id, position)
select 'A', id, pos from (values
  ('Mexico', 1), ('South Africa', 2), ('South Korea', 3), ('Czechia', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'B', id, pos from (values
  ('Canada', 1), ('Bosnia & Herzegovina', 2), ('Qatar', 3), ('Switzerland', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'C', id, pos from (values
  ('Brazil', 1), ('Morocco', 2), ('Haiti', 3), ('Scotland', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'D', id, pos from (values
  ('United States', 1), ('Paraguay', 2), ('Australia', 3), ('Türkiye', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'E', id, pos from (values
  ('Germany', 1), ('Curaçao', 2), ('Ivory Coast', 3), ('Ecuador', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'F', id, pos from (values
  ('Netherlands', 1), ('Japan', 2), ('Sweden', 3), ('Tunisia', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'G', id, pos from (values
  ('Belgium', 1), ('Egypt', 2), ('Iran', 3), ('New Zealand', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'H', id, pos from (values
  ('Spain', 1), ('Cape Verde', 2), ('Saudi Arabia', 3), ('Uruguay', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'I', id, pos from (values
  ('France', 1), ('Senegal', 2), ('Iraq', 3), ('Norway', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'J', id, pos from (values
  ('Argentina', 1), ('Algeria', 2), ('Austria', 3), ('Jordan', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'K', id, pos from (values
  ('Portugal', 1), ('DR Congo', 2), ('Uzbekistan', 3), ('Colombia', 4)
) as v(name, pos) join teams t on t.name = v.name;

insert into group_teams (group_letter, team_id, position)
select 'L', id, pos from (values
  ('England', 1), ('Croatia', 2), ('Ghana', 3), ('Panama', 4)
) as v(name, pos) join teams t on t.name = v.name;

-- ============================================================
-- MATCHES — Group stage (72 matches, #1–#72)
-- ============================================================
-- Helper: look up team id by name inline via subselect

insert into matches (match_number, stage, group_letter, home_team_id, away_team_id, venue_code, kickoff_utc, local_time, et_time, iso_date) values
  (1,  'group', 'A', (select id from teams where name='Mexico'),              (select id from teams where name='South Africa'),           'AZT',      '2026-06-11 19:00:00+00', '1:00 PM CST',    '3:00 PM ET',   '2026-06-11'),
  (2,  'group', 'A', (select id from teams where name='South Korea'),         (select id from teams where name='Czechia'),                'AKR',      '2026-06-12 02:00:00+00', '8:00 PM CST',    '10:00 PM ET',  '2026-06-11'),
  (3,  'group', 'B', (select id from teams where name='Canada'),              (select id from teams where name='Bosnia & Herzegovina'),   'BMO',      '2026-06-12 19:00:00+00', '3:00 PM ET',     '3:00 PM ET',   '2026-06-12'),
  (4,  'group', 'D', (select id from teams where name='United States'),       (select id from teams where name='Paraguay'),               'SOFI',     '2026-06-13 01:00:00+00', '6:00 PM PT',     '9:00 PM ET',   '2026-06-12'),
  (5,  'group', 'B', (select id from teams where name='Qatar'),               (select id from teams where name='Switzerland'),            'LEVI',     '2026-06-13 19:00:00+00', '12:00 PM PT',    '3:00 PM ET',   '2026-06-13'),
  (6,  'group', 'C', (select id from teams where name='Brazil'),              (select id from teams where name='Morocco'),                'METLIFE',  '2026-06-13 22:00:00+00', '6:00 PM ET',     '6:00 PM ET',   '2026-06-13'),
  (7,  'group', 'C', (select id from teams where name='Haiti'),               (select id from teams where name='Scotland'),               'GILLETTE', '2026-06-14 01:00:00+00', '9:00 PM ET',     '9:00 PM ET',   '2026-06-13'),
  (8,  'group', 'D', (select id from teams where name='Australia'),           (select id from teams where name='Türkiye'),                'BCP',      '2026-06-14 04:00:00+00', '9:00 PM PT',     '12:00 AM ET',  '2026-06-13'),
  (9,  'group', 'E', (select id from teams where name='Germany'),             (select id from teams where name='Curaçao'),                'NRG',      '2026-06-14 17:00:00+00', '12:00 PM CDT',   '1:00 PM ET',   '2026-06-14'),
  (10, 'group', 'F', (select id from teams where name='Netherlands'),         (select id from teams where name='Japan'),                  'ATT',      '2026-06-14 20:00:00+00', '3:00 PM CDT',    '4:00 PM ET',   '2026-06-14'),
  (11, 'group', 'E', (select id from teams where name='Ivory Coast'),         (select id from teams where name='Ecuador'),                'LINC',     '2026-06-14 23:00:00+00', '7:00 PM ET',     '7:00 PM ET',   '2026-06-14'),
  (12, 'group', 'F', (select id from teams where name='Sweden'),              (select id from teams where name='Tunisia'),                'BBVA',     '2026-06-15 02:00:00+00', '8:00 PM CST',    '10:00 PM ET',  '2026-06-14'),
  (13, 'group', 'H', (select id from teams where name='Spain'),               (select id from teams where name='Cape Verde'),             'MBS',      '2026-06-15 16:00:00+00', '12:00 PM ET',    '12:00 PM ET',  '2026-06-15'),
  (14, 'group', 'G', (select id from teams where name='Belgium'),             (select id from teams where name='Egypt'),                  'LUMEN',    '2026-06-15 19:00:00+00', '12:00 PM PT',    '3:00 PM ET',   '2026-06-15'),
  (15, 'group', 'H', (select id from teams where name='Saudi Arabia'),        (select id from teams where name='Uruguay'),                'HARDROCK', '2026-06-15 22:00:00+00', '6:00 PM ET',     '6:00 PM ET',   '2026-06-15'),
  (16, 'group', 'G', (select id from teams where name='Iran'),                (select id from teams where name='New Zealand'),            'SOFI',     '2026-06-16 01:00:00+00', '6:00 PM PT',     '9:00 PM ET',   '2026-06-15'),
  (17, 'group', 'I', (select id from teams where name='France'),              (select id from teams where name='Senegal'),                'METLIFE',  '2026-06-16 19:00:00+00', '3:00 PM ET',     '3:00 PM ET',   '2026-06-16'),
  (18, 'group', 'I', (select id from teams where name='Iraq'),                (select id from teams where name='Norway'),                 'GILLETTE', '2026-06-16 22:00:00+00', '6:00 PM ET',     '6:00 PM ET',   '2026-06-16'),
  (19, 'group', 'J', (select id from teams where name='Argentina'),           (select id from teams where name='Algeria'),                'ARROW',    '2026-06-17 01:00:00+00', '8:00 PM CDT',    '9:00 PM ET',   '2026-06-16'),
  (20, 'group', 'J', (select id from teams where name='Austria'),             (select id from teams where name='Jordan'),                 'LEVI',     '2026-06-17 04:00:00+00', '9:00 PM PT',     '12:00 AM ET',  '2026-06-16'),
  (21, 'group', 'K', (select id from teams where name='Portugal'),            (select id from teams where name='DR Congo'),               'NRG',      '2026-06-17 17:00:00+00', '12:00 PM CDT',   '1:00 PM ET',   '2026-06-17'),
  (22, 'group', 'L', (select id from teams where name='England'),             (select id from teams where name='Croatia'),                'ATT',      '2026-06-17 20:00:00+00', '3:00 PM CDT',    '4:00 PM ET',   '2026-06-17'),
  (23, 'group', 'L', (select id from teams where name='Ghana'),               (select id from teams where name='Panama'),                 'BMO',      '2026-06-17 23:00:00+00', '7:00 PM ET',     '7:00 PM ET',   '2026-06-17'),
  (24, 'group', 'K', (select id from teams where name='Uzbekistan'),          (select id from teams where name='Colombia'),               'AZT',      '2026-06-18 02:00:00+00', '8:00 PM CST',    '10:00 PM ET',  '2026-06-17'),
  (25, 'group', 'A', (select id from teams where name='Czechia'),             (select id from teams where name='South Africa'),           'MBS',      '2026-06-18 16:00:00+00', '12:00 PM ET',    '12:00 PM ET',  '2026-06-18'),
  (26, 'group', 'B', (select id from teams where name='Switzerland'),         (select id from teams where name='Bosnia & Herzegovina'),   'SOFI',     '2026-06-18 19:00:00+00', '12:00 PM PT',    '3:00 PM ET',   '2026-06-18'),
  (27, 'group', 'B', (select id from teams where name='Canada'),              (select id from teams where name='Qatar'),                  'BCP',      '2026-06-18 22:00:00+00', '3:00 PM PT',     '6:00 PM ET',   '2026-06-18'),
  (28, 'group', 'A', (select id from teams where name='Mexico'),              (select id from teams where name='South Korea'),            'AKR',      '2026-06-19 01:00:00+00', '7:00 PM CST',    '9:00 PM ET',   '2026-06-18'),
  (29, 'group', 'D', (select id from teams where name='United States'),       (select id from teams where name='Australia'),              'LUMEN',    '2026-06-19 19:00:00+00', '12:00 PM PT',    '3:00 PM ET',   '2026-06-19'),
  (30, 'group', 'C', (select id from teams where name='Scotland'),            (select id from teams where name='Morocco'),                'GILLETTE', '2026-06-19 22:00:00+00', '6:00 PM ET',     '6:00 PM ET',   '2026-06-19'),
  (31, 'group', 'C', (select id from teams where name='Brazil'),              (select id from teams where name='Haiti'),                  'LINC',     '2026-06-20 00:30:00+00', '8:30 PM ET',     '8:30 PM ET',   '2026-06-19'),
  (32, 'group', 'D', (select id from teams where name='Türkiye'),             (select id from teams where name='Paraguay'),               'LEVI',     '2026-06-20 04:00:00+00', '9:00 PM PT',     '12:00 AM ET',  '2026-06-19'),
  (33, 'group', 'F', (select id from teams where name='Netherlands'),         (select id from teams where name='Sweden'),                 'NRG',      '2026-06-20 17:00:00+00', '12:00 PM CDT',   '1:00 PM ET',   '2026-06-20'),
  (34, 'group', 'E', (select id from teams where name='Germany'),             (select id from teams where name='Ivory Coast'),            'BMO',      '2026-06-20 20:00:00+00', '4:00 PM ET',     '4:00 PM ET',   '2026-06-20'),
  (35, 'group', 'E', (select id from teams where name='Ecuador'),             (select id from teams where name='Curaçao'),                'ARROW',    '2026-06-21 00:00:00+00', '7:00 PM CDT',    '8:00 PM ET',   '2026-06-20'),
  (36, 'group', 'F', (select id from teams where name='Tunisia'),             (select id from teams where name='Japan'),                  'BBVA',     '2026-06-21 04:00:00+00', '10:00 PM CST',   '12:00 AM ET',  '2026-06-20'),
  (37, 'group', 'H', (select id from teams where name='Spain'),               (select id from teams where name='Saudi Arabia'),           'MBS',      '2026-06-21 16:00:00+00', '12:00 PM ET',    '12:00 PM ET',  '2026-06-21'),
  (38, 'group', 'G', (select id from teams where name='Belgium'),             (select id from teams where name='Iran'),                   'SOFI',     '2026-06-21 19:00:00+00', '12:00 PM PT',    '3:00 PM ET',   '2026-06-21'),
  (39, 'group', 'H', (select id from teams where name='Uruguay'),             (select id from teams where name='Cape Verde'),             'HARDROCK', '2026-06-21 22:00:00+00', '6:00 PM ET',     '6:00 PM ET',   '2026-06-21'),
  (40, 'group', 'G', (select id from teams where name='New Zealand'),         (select id from teams where name='Egypt'),                  'BCP',      '2026-06-22 01:00:00+00', '6:00 PM PT',     '9:00 PM ET',   '2026-06-21'),
  (41, 'group', 'J', (select id from teams where name='Argentina'),           (select id from teams where name='Austria'),                'ATT',      '2026-06-22 17:00:00+00', '12:00 PM CDT',   '1:00 PM ET',   '2026-06-22'),
  (42, 'group', 'I', (select id from teams where name='France'),              (select id from teams where name='Iraq'),                   'LINC',     '2026-06-22 21:00:00+00', '5:00 PM ET',     '5:00 PM ET',   '2026-06-22'),
  (43, 'group', 'I', (select id from teams where name='Norway'),              (select id from teams where name='Senegal'),                'METLIFE',  '2026-06-23 00:00:00+00', '8:00 PM ET',     '8:00 PM ET',   '2026-06-22'),
  (44, 'group', 'J', (select id from teams where name='Jordan'),              (select id from teams where name='Algeria'),                'LEVI',     '2026-06-23 03:00:00+00', '8:00 PM PT',     '11:00 PM ET',  '2026-06-22'),
  (45, 'group', 'K', (select id from teams where name='Portugal'),            (select id from teams where name='Uzbekistan'),             'NRG',      '2026-06-23 17:00:00+00', '12:00 PM CDT',   '1:00 PM ET',   '2026-06-23'),
  (46, 'group', 'L', (select id from teams where name='England'),             (select id from teams where name='Ghana'),                  'GILLETTE', '2026-06-23 20:00:00+00', '4:00 PM ET',     '4:00 PM ET',   '2026-06-23'),
  (47, 'group', 'L', (select id from teams where name='Panama'),              (select id from teams where name='Croatia'),                'BMO',      '2026-06-23 23:00:00+00', '7:00 PM ET',     '7:00 PM ET',   '2026-06-23'),
  (48, 'group', 'K', (select id from teams where name='Colombia'),            (select id from teams where name='DR Congo'),               'AKR',      '2026-06-24 02:00:00+00', '8:00 PM CST',    '10:00 PM ET',  '2026-06-23'),
  (49, 'group', 'B', (select id from teams where name='Switzerland'),         (select id from teams where name='Canada'),                 'BCP',      '2026-06-24 19:00:00+00', '12:00 PM PT',    '3:00 PM ET',   '2026-06-24'),
  (50, 'group', 'B', (select id from teams where name='Bosnia & Herzegovina'),(select id from teams where name='Qatar'),                  'LUMEN',    '2026-06-24 19:00:00+00', '12:00 PM PT',    '3:00 PM ET',   '2026-06-24'),
  (51, 'group', 'C', (select id from teams where name='Scotland'),            (select id from teams where name='Brazil'),                 'HARDROCK', '2026-06-24 22:00:00+00', '6:00 PM ET',     '6:00 PM ET',   '2026-06-24'),
  (52, 'group', 'C', (select id from teams where name='Morocco'),             (select id from teams where name='Haiti'),                  'MBS',      '2026-06-24 22:00:00+00', '6:00 PM ET',     '6:00 PM ET',   '2026-06-24'),
  (53, 'group', 'A', (select id from teams where name='Czechia'),             (select id from teams where name='Mexico'),                 'AZT',      '2026-06-25 01:00:00+00', '7:00 PM CST',    '9:00 PM ET',   '2026-06-24'),
  (54, 'group', 'A', (select id from teams where name='South Africa'),        (select id from teams where name='South Korea'),            'BBVA',     '2026-06-25 01:00:00+00', '7:00 PM CST',    '9:00 PM ET',   '2026-06-24'),
  (55, 'group', 'E', (select id from teams where name='Ecuador'),             (select id from teams where name='Germany'),                'METLIFE',  '2026-06-25 20:00:00+00', '4:00 PM ET',     '4:00 PM ET',   '2026-06-25'),
  (56, 'group', 'E', (select id from teams where name='Curaçao'),             (select id from teams where name='Ivory Coast'),            'LINC',     '2026-06-25 20:00:00+00', '4:00 PM ET',     '4:00 PM ET',   '2026-06-25'),
  (57, 'group', 'F', (select id from teams where name='Japan'),               (select id from teams where name='Sweden'),                 'ATT',      '2026-06-25 23:00:00+00', '6:00 PM CDT',    '7:00 PM ET',   '2026-06-25'),
  (58, 'group', 'F', (select id from teams where name='Tunisia'),             (select id from teams where name='Netherlands'),            'ARROW',    '2026-06-25 23:00:00+00', '6:00 PM CDT',    '7:00 PM ET',   '2026-06-25'),
  (59, 'group', 'D', (select id from teams where name='Türkiye'),             (select id from teams where name='United States'),          'SOFI',     '2026-06-26 02:00:00+00', '7:00 PM PT',     '10:00 PM ET',  '2026-06-25'),
  (60, 'group', 'D', (select id from teams where name='Paraguay'),            (select id from teams where name='Australia'),              'LEVI',     '2026-06-26 02:00:00+00', '7:00 PM PT',     '10:00 PM ET',  '2026-06-25'),
  (61, 'group', 'I', (select id from teams where name='Norway'),              (select id from teams where name='France'),                 'GILLETTE', '2026-06-26 19:00:00+00', '3:00 PM ET',     '3:00 PM ET',   '2026-06-26'),
  (62, 'group', 'I', (select id from teams where name='Senegal'),             (select id from teams where name='Iraq'),                   'BMO',      '2026-06-26 19:00:00+00', '3:00 PM ET',     '3:00 PM ET',   '2026-06-26'),
  (63, 'group', 'H', (select id from teams where name='Cape Verde'),          (select id from teams where name='Saudi Arabia'),           'NRG',      '2026-06-27 00:00:00+00', '7:00 PM CDT',    '8:00 PM ET',   '2026-06-26'),
  (64, 'group', 'H', (select id from teams where name='Uruguay'),             (select id from teams where name='Spain'),                  'AKR',      '2026-06-27 00:00:00+00', '6:00 PM CST',    '8:00 PM ET',   '2026-06-26'),
  (65, 'group', 'G', (select id from teams where name='Egypt'),               (select id from teams where name='Iran'),                   'LUMEN',    '2026-06-27 03:00:00+00', '8:00 PM PT',     '11:00 PM ET',  '2026-06-26'),
  (66, 'group', 'G', (select id from teams where name='New Zealand'),         (select id from teams where name='Belgium'),                'BCP',      '2026-06-27 03:00:00+00', '8:00 PM PT',     '11:00 PM ET',  '2026-06-26'),
  (67, 'group', 'L', (select id from teams where name='Panama'),              (select id from teams where name='England'),                'METLIFE',  '2026-06-27 21:00:00+00', '5:00 PM ET',     '5:00 PM ET',   '2026-06-27'),
  (68, 'group', 'L', (select id from teams where name='Croatia'),             (select id from teams where name='Ghana'),                  'LINC',     '2026-06-27 21:00:00+00', '5:00 PM ET',     '5:00 PM ET',   '2026-06-27'),
  (69, 'group', 'K', (select id from teams where name='Colombia'),            (select id from teams where name='Portugal'),               'HARDROCK', '2026-06-27 23:30:00+00', '7:30 PM ET',     '7:30 PM ET',   '2026-06-27'),
  (70, 'group', 'K', (select id from teams where name='DR Congo'),            (select id from teams where name='Uzbekistan'),             'MBS',      '2026-06-27 23:30:00+00', '7:30 PM ET',     '7:30 PM ET',   '2026-06-27'),
  (71, 'group', 'J', (select id from teams where name='Algeria'),             (select id from teams where name='Austria'),                'ARROW',    '2026-06-28 02:00:00+00', '9:00 PM CDT',    '10:00 PM ET',  '2026-06-27'),
  (72, 'group', 'J', (select id from teams where name='Jordan'),              (select id from teams where name='Argentina'),              'ATT',      '2026-06-28 02:00:00+00', '9:00 PM CDT',    '10:00 PM ET',  '2026-06-27');

-- ============================================================
-- MATCHES — Knockout (32 matches, #73–#104)
-- Teams are null until resolved from group results.
-- ============================================================
insert into matches (match_number, stage, round, match_range, venue_code, kickoff_utc, local_time, et_time, iso_date) values
  (73,  'knockout', 'Round of 32',          '73–88',  'SOFI',     '2026-06-28 19:00:00+00', '12:00 PM PT',     '3:00 PM ET',   '2026-06-28'),
  (74,  'knockout', 'Round of 32',          '73–88',  'NRG',      '2026-06-29 17:00:00+00', '12:00 PM CDT',    '1:00 PM ET',   '2026-06-29'),
  (75,  'knockout', 'Round of 32',          '73–88',  'GILLETTE', '2026-06-29 20:30:00+00', '4:30 PM ET',      '4:30 PM ET',   '2026-06-29'),
  (76,  'knockout', 'Round of 32',          '73–88',  'BBVA',     '2026-06-30 01:00:00+00', '7:00 PM CST',     '9:00 PM ET',   '2026-06-29'),
  (77,  'knockout', 'Round of 32',          '73–88',  'ATT',      '2026-06-30 17:00:00+00', '12:00 PM CDT',    '1:00 PM ET',   '2026-06-30'),
  (78,  'knockout', 'Round of 32',          '73–88',  'METLIFE',  '2026-06-30 21:00:00+00', '5:00 PM ET',      '5:00 PM ET',   '2026-06-30'),
  (79,  'knockout', 'Round of 32',          '73–88',  'AZT',      '2026-07-01 01:00:00+00', '7:00 PM CST',     '9:00 PM ET',   '2026-06-30'),
  (80,  'knockout', 'Round of 32',          '73–88',  'MBS',      '2026-07-01 16:00:00+00', '12:00 PM ET',     '12:00 PM ET',  '2026-07-01'),
  (81,  'knockout', 'Round of 32',          '73–88',  'LUMEN',    '2026-07-01 20:00:00+00', '1:00 PM PT',      '4:00 PM ET',   '2026-07-01'),
  (82,  'knockout', 'Round of 32',          '73–88',  'LEVI',     '2026-07-02 00:00:00+00', '5:00 PM PT',      '8:00 PM ET',   '2026-07-01'),
  (83,  'knockout', 'Round of 32',          '73–88',  'SOFI',     '2026-07-02 19:00:00+00', '12:00 PM PT',     '3:00 PM ET',   '2026-07-02'),
  (84,  'knockout', 'Round of 32',          '73–88',  'BMO',      '2026-07-02 23:00:00+00', '7:00 PM ET',      '7:00 PM ET',   '2026-07-02'),
  (85,  'knockout', 'Round of 32',          '73–88',  'BCP',      '2026-07-03 03:00:00+00', '8:00 PM PT',      '11:00 PM ET',  '2026-07-02'),
  (86,  'knockout', 'Round of 32',          '73–88',  'ATT',      '2026-07-03 18:00:00+00', '1:00 PM CDT',     '2:00 PM ET',   '2026-07-03'),
  (87,  'knockout', 'Round of 32',          '73–88',  'HARDROCK', '2026-07-03 22:00:00+00', '6:00 PM ET',      '6:00 PM ET',   '2026-07-03'),
  (88,  'knockout', 'Round of 32',          '73–88',  'ARROW',    '2026-07-04 01:30:00+00', '8:30 PM CDT',     '9:30 PM ET',   '2026-07-03'),
  (89,  'knockout', 'Round of 16',          '89–96',  'NRG',      '2026-07-04 17:00:00+00', '12:00 PM CDT',    '1:00 PM ET',   '2026-07-04'),
  (90,  'knockout', 'Round of 16',          '89–96',  'LINC',     '2026-07-04 21:00:00+00', '5:00 PM ET',      '5:00 PM ET',   '2026-07-04'),
  (91,  'knockout', 'Round of 16',          '89–96',  'METLIFE',  '2026-07-05 20:00:00+00', '4:00 PM ET',      '4:00 PM ET',   '2026-07-05'),
  (92,  'knockout', 'Round of 16',          '89–96',  'AZT',      '2026-07-06 00:00:00+00', '6:00 PM CST',     '8:00 PM ET',   '2026-07-05'),
  (93,  'knockout', 'Round of 16',          '89–96',  'ATT',      '2026-07-06 19:00:00+00', '2:00 PM CDT',     '3:00 PM ET',   '2026-07-06'),
  (94,  'knockout', 'Round of 16',          '89–96',  'LUMEN',    '2026-07-07 00:00:00+00', '5:00 PM PT',      '8:00 PM ET',   '2026-07-06'),
  (95,  'knockout', 'Round of 16',          '89–96',  'MBS',      '2026-07-07 16:00:00+00', '12:00 PM ET',     '12:00 PM ET',  '2026-07-07'),
  (96,  'knockout', 'Round of 16',          '89–96',  'BCP',      '2026-07-07 20:00:00+00', '1:00 PM PT',      '4:00 PM ET',   '2026-07-07'),
  (97,  'knockout', 'Quarter-final',        '97–100', 'GILLETTE', '2026-07-09 20:00:00+00', '4:00 PM ET',      '4:00 PM ET',   '2026-07-09'),
  (98,  'knockout', 'Quarter-final',        '97–100', 'SOFI',     '2026-07-10 19:00:00+00', '12:00 PM PT',     '3:00 PM ET',   '2026-07-10'),
  (99,  'knockout', 'Quarter-final',        '97–100', 'HARDROCK', '2026-07-11 21:00:00+00', '5:00 PM ET',      '5:00 PM ET',   '2026-07-11'),
  (100, 'knockout', 'Quarter-final',        '97–100', 'ARROW',    '2026-07-12 01:00:00+00', '8:00 PM CDT',     '9:00 PM ET',   '2026-07-11'),
  (101, 'knockout', 'Semi-final',           '101–102','ATT',      '2026-07-14 19:00:00+00', '2:00 PM CDT',     '3:00 PM ET',   '2026-07-14'),
  (102, 'knockout', 'Semi-final',           '101–102','MBS',      '2026-07-15 19:00:00+00', '3:00 PM ET',      '3:00 PM ET',   '2026-07-15'),
  (103, 'knockout', 'Third-place play-off', '103',    'HARDROCK', '2026-07-18 21:00:00+00', '5:00 PM ET',      '5:00 PM ET',   '2026-07-18'),
  (104, 'knockout', 'Final',                '104',    'METLIFE',  '2026-07-19 19:00:00+00', '3:00 PM ET',      '3:00 PM ET',   '2026-07-19');
