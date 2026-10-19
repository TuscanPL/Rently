#!/usr/bin/env bash
# Runs a second (third, …) local Supabase stack from this checkout, e.g. in a git
# worktree, without clashing with the default one. Usage: scripts/isolated-stack.sh <n>
# with n in 1..9. Ports move from 543xx to 5(4+n)3xx, the web dev server to 5173+n*10.
# The config.toml edits are local only: the file is marked skip-worktree so they
# never get committed. Undo with: git update-index --no-skip-worktree supabase/config.toml
set -euo pipefail
n="${1:?usage: scripts/isolated-stack.sh <1-9>}"
root="$(git rev-parse --show-toplevel)"
cd "$root"

prefix=$((54 + n))
cfg=supabase/config.toml
git update-index --skip-worktree "$cfg"
sed -i -E \
  -e "s/^project_id = \".*\"/project_id = \"apartment-together-$n\"/" \
  -e "s/^(port|shadow_port|inspector_port) = 54([0-9]{3})$/\1 = ${prefix}\2/" \
  -e "s/^inspector_port = 8083$/inspector_port = $((8083 + n))/" \
  "$cfg"

api="http://127.0.0.1:${prefix}321"
web_port=$((5173 + n * 10))
anon='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\nVITE_BASE=/\n' "$api" "$anon" > apps/web/.env.local
[ -f supabase/functions/.env ] || cp supabase/functions/.env.example supabase/functions/.env

cat <<MSG
Configured stack $n. Start it with:
  npx supabase start -x studio,imgproxy,vector,logflare,supavisor,postgres-meta
Then use:
  export SUPABASE_URL=$api SUPABASE_API_URL=$api MAILPIT_URL=http://127.0.0.1:${prefix}324 E2E_WEB_PORT=$web_port
  DB: postgresql://postgres:postgres@127.0.0.1:${prefix}322/postgres
MSG
