#!/bin/sh
# Creates the least-privilege runtime role and its grants on first container start.
#
# The schema-owner role (`hyssop_migrator`) applies migrations. The runtime role
# (`hyssop_app`) may read and write business data but holds no `UPDATE` or `DELETE`
# privilege on `audit_event`, so audit history stays append-only. The
# `audit_event_append_only` trigger additionally rejects mutation for any role.
#
# Runs only when the data volume is first initialized, exactly like every other
# `/docker-entrypoint-initdb.d` entry.

set -eu

: "${APP_ROLE:?APP_ROLE must be set}"
: "${APP_ROLE_PASSWORD:?APP_ROLE_PASSWORD must be set}"

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE ROLE :"APP_ROLE" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'APP_ROLE_PASSWORD';
SQL

psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO :"APP_ROLE";
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"APP_ROLE";
  REVOKE UPDATE, DELETE ON TABLE audit_event FROM :"APP_ROLE";
SQL
