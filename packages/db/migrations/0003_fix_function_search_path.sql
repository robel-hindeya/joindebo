-- Pin the search_path of the append-only trigger function (database linter 0011).
alter function tc.refuse_change() set search_path = '';
