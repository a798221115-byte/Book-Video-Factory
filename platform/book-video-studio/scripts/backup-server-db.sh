#!/bin/zsh
set -euo pipefail

server_dir="${BOOK_VIDEO_SERVER_DATA_DIR:-${HOME}/Library/Application Support/BookVideoFactory}"
data_dir="${DATA_DIR:-${server_dir}/data}"
backup_dir="${server_dir}/backups/database"
timestamp="$(date '+%Y-%m-%d_%H-%M-%S')"

mkdir -p "${backup_dir}"

if [[ ! -f "${data_dir}/app.db" ]]; then
  print -u2 "Database not found: ${data_dir}/app.db"
  exit 1
fi

/usr/bin/sqlite3 "${data_dir}/app.db" ".timeout 10000" ".backup '${backup_dir}/app-${timestamp}.db'"
/usr/bin/sqlite3 "${backup_dir}/app-${timestamp}.db" "PRAGMA integrity_check;"
print "Database backup created: ${backup_dir}/app-${timestamp}.db"
