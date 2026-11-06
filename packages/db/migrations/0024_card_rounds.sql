-- A full card starts a new round (DECISIONS.md, 2026-11-06). The round is worked out from the
-- stamps, as the count is. Each round earns the rewards again, so a reward row says which round
-- it belongs to. Rewards already unlocked belong to round 1. Unused rewards stay valid.
alter table tc.reward add column card_round int not null default 1 check (card_round >= 1);
alter table tc.reward drop constraint reward_card_id_tier_key;
alter table tc.reward add constraint reward_once_per_round unique (card_id, card_round, tier);

-- Cards no longer close when every reward is used: bring those back, unless the customer has
-- since joined the shop again on a new card.
update tc.card c set status = 'active'
where c.status = 'redeemed'
  and not exists (select 1 from tc.card o where o.customer_id = c.customer_id and o.business_id = c.business_id and o.status in ('active', 'paused'));
