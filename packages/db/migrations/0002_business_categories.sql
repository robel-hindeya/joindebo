-- The prototype's Admin board also has barbers and bakeries.
alter table tc.business drop constraint business_category_check;
alter table tc.business add constraint business_category_check
  check (category in ('cafe', 'salon', 'barber', 'spa', 'restaurant', 'bakery', 'car_wash', 'other'));
