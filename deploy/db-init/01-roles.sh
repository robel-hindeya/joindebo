#!/bin/sh
# Runs once, when the Docker database volume is first created (docker-compose.yml).
# Creates the API's login role, as in docs/DATABASE.md. Migration 0001 keeps tc_app if it exists.
set -eu

psql -v ON_ERROR_STOP=1 -v pw="$TC_API_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
create role tc_app nologin;
create role tc_api login password :'pw';
grant tc_app to tc_api;
alter role tc_api set search_path = tc;
SQL
