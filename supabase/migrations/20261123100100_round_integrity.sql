-- A round, and every idea on it, belongs to one person through one of that
-- person's occasions. Until now the keys only made sure each piece had the same
-- owner (T26), so a round could name one person and another person's occasion,
-- and a round idea could name a different person from its round.

-- ─── gift_rounds → occasions ────────────────────────────────────────────────
-- occasions.person_id stays nullable (the column allows an account-wide
-- occasion), but rounds only start from an occasion joined to its person
-- (round_candidates), so a round's occasion always has a person and it must be
-- the round's. The three-column key replaces the (occasion_id, user_id) one:
-- every column is not null on gift_rounds, so it checks the owner as well.
alter table concierge.occasions
  add constraint occasions_id_person_id_user_id_key unique (id, person_id, user_id);

alter table concierge.gift_rounds
  add constraint gift_rounds_occasion_person_fkey foreign key (occasion_id, person_id, user_id)
    references concierge.occasions (id, person_id, user_id) on delete cascade,
  drop constraint gift_rounds_occasion_id_user_id_fkey;

-- ─── gift_ideas → gift_rounds ───────────────────────────────────────────────
-- Round ideas carry the person the idea run was for (save_ideas). When both are
-- set, that person must be the round's. MATCH SIMPLE skips the check when
-- person_id is null, and the existing (round_id, user_id) key still covers
-- the owner then, so it stays.
-- Ideas and idea runs keep their (round_id, user_id) key too, so there are two
-- keys between them and gift_rounds: a PostgREST embed across them needs a
-- !<constraint> hint. occasions_id_user_id_key is no longer used by a key but
-- stays, as it's cheap and other tables may point at occasions that way later.
alter table concierge.gift_rounds
  add constraint gift_rounds_id_person_id_user_id_key unique (id, person_id, user_id);

alter table concierge.gift_ideas
  add constraint gift_ideas_round_person_fkey foreign key (round_id, person_id, user_id)
    references concierge.gift_rounds (id, person_id, user_id) on delete cascade;

-- ─── idea_runs → gift_rounds ────────────────────────────────────────────────
-- A run for a round is a run for that round's person; start_idea_run checks
-- this, and the key makes it hold for every writer. MATCH SIMPLE skips
-- on-demand runs (no round).
alter table concierge.idea_runs
  add constraint idea_runs_round_person_fkey foreign key (round_id, person_id, user_id)
    references concierge.gift_rounds (id, person_id, user_id) on delete cascade;
