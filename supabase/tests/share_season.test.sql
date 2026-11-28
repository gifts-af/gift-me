-- The season wording on shared lists (ALL-191): its name and dates are app settings (T23),
-- seeded so production has them, and visitors can't read or change them.
begin;
\ir _helpers.psql
select plan(5);

select is((select value #>> '{}' from concierge.app_settings where key = 'share_season_name'), 'Christmas', 'the season is Christmas');
select ok((select (value #>> '{}')::date is not null from concierge.app_settings where key = 'share_season_start'), 'it has a start date');
select is((select (value #>> '{}')::date from concierge.app_settings where key = 'share_season_end'), date '2026-12-26', 'it ends on Dec 26');
select ok((select (s.value #>> '{}')::date < (e.value #>> '{}')::date
             from concierge.app_settings s, concierge.app_settings e
            where s.key = 'share_season_start' and e.key = 'share_season_end'), 'it starts before it ends');
select ok(not has_table_privilege('anon', 'concierge.app_settings', 'select'), 'visitors can''t read the settings');

select * from finish();
rollback;
