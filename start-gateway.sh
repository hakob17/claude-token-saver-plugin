#!/usr/bin/env bash
# Start the token-saver team gateway and manager dashboard with sensible defaults.
#
#   ./start-gateway.sh            live gateway (empty team) on http://127.0.0.1:8790/admin
#   ./start-gateway.sh --demo     made-up 30-day demo team on http://127.0.0.1:8791/admin
#   ./start-gateway.sh --restart  stop whatever is listening on the port first
#
# Every default can be overridden by setting the variable before running, e.g.
#   TOKEN_SAVER_TEAM_PORT=9000 TOKEN_SAVER_TEAM_API_KEY=sk-ant-... ./start-gateway.sh
# See bench/TEAM-GATEWAY.md for what each one does.
set -euo pipefail
cd "$(dirname "$0")"

demo=0 restart=0
for arg in "$@"; do
  case "$arg" in
    --demo) demo=1 ;;
    --restart) restart=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 1 ;;
  esac
done

if [ "$demo" = 1 ]; then
  export TOKEN_SAVER_TEAM_DIR="${TOKEN_SAVER_TEAM_DIR:-/tmp/ts-team-demo}"
  export TOKEN_SAVER_TEAM_PORT="${TOKEN_SAVER_TEAM_PORT:-8791}"
  export TOKEN_SAVER_ADMIN_TOKEN="${TOKEN_SAVER_ADMIN_TOKEN:-demo-admin}"
else
  export TOKEN_SAVER_TEAM_DIR="${TOKEN_SAVER_TEAM_DIR:-/tmp/ts-team-real}"
  export TOKEN_SAVER_TEAM_PORT="${TOKEN_SAVER_TEAM_PORT:-8790}"
  export TOKEN_SAVER_ADMIN_TOKEN="${TOKEN_SAVER_ADMIN_TOKEN:-local-admin}"
  # Low thresholds so prompt hints show up quickly when trying it out; raise for real use.
  export TOKEN_SAVER_HINT_MIN_COST="${TOKEN_SAVER_HINT_MIN_COST:-0.05}"
  export TOKEN_SAVER_HINT_MIN_REQUESTS="${TOKEN_SAVER_HINT_MIN_REQUESTS:-3}"
fi
export TOKEN_SAVER_TEAM_HOST="${TOKEN_SAVER_TEAM_HOST:-127.0.0.1}"
export TOKEN_SAVER_PROXY_POLICY="${TOKEN_SAVER_PROXY_POLICY:-smart}"
port="$TOKEN_SAVER_TEAM_PORT"

command -v node >/dev/null || { echo "Node.js 18+ is required" >&2; exit 1; }

pid="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$pid" ]; then
  if [ "$restart" = 1 ]; then
    echo "Stopping the process on port $port (pid $pid)…"
    kill $pid; sleep 1
  else
    echo "Port $port is already in use (pid $pid). Run with --restart to stop it first." >&2
    exit 1
  fi
fi

if [ "$demo" = 1 ] && [ ! -f "$TOKEN_SAVER_TEAM_DIR/team.json" ]; then
  echo "Creating demo data in $TOKEN_SAVER_TEAM_DIR…"
  node plugins/token-saver/team/seed-demo.mjs >/dev/null
fi

url="http://$TOKEN_SAVER_TEAM_HOST:$port"
cat <<EOF

  Dashboard:   $url/admin
  Admin token: $TOKEN_SAVER_ADMIN_TOKEN
  Data:        $TOKEN_SAVER_TEAM_DIR

  Connect Claude Code (after "Add engineer" in the dashboard gives you a key):
    ANTHROPIC_BASE_URL=$url ANTHROPIC_CUSTOM_HEADERS="x-token-saver-key: tsk_YOURKEY" claude --plugin-dir ./plugins/token-saver

  Stop with Ctrl+C.

EOF
exec node plugins/token-saver/team/gateway.mjs
