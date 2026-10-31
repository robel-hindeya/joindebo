-- The owner sign-up board (OwnSignUp) offers "Food and drink" as one choice,
-- alongside the finer categories the admin board uses.
alter table tc.business drop constraint business_category_check;
alter table tc.business add constraint business_category_check
  check (category in ('food', 'cafe', 'salon', 'barber', 'spa', 'restaurant', 'bakery', 'car_wash', 'other'));
alter table tc.business add column terms_accepted_at timestamptz;
