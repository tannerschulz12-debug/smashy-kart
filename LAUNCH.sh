#!/bin/sh
# Start Smashy Kart: Wanted (Solo + Live Phone Party Lobby)
set -eu
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$DIR"
PORT="${PORT:-4567}"
exec node server.mjs
