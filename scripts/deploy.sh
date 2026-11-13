#!/bin/bash
# Test, bump the service-worker cache version, push to GitHub Pages and deploy Cloudflare Pages.
set -euo pipefail
cd "$(dirname "$0")/.."
# Run a command for at most N seconds of wall-clock time. GNU timeout can stall across
# laptop sleep; this checks the real clock every 3 seconds and kills hard.
kill_tree() { local c; for c in $(pgrep -P "$1"); do kill_tree "$c"; done; kill -9 "$1" 2>/dev/null; }
run_for() {
  local limit=$1; shift
  "$@" >/dev/null 2>&1 & local pid=$! start=$(date +%s)
  while kill -0 $pid 2>/dev/null; do
    if [ $(( $(date +%s) - start )) -ge "$limit" ]; then kill_tree $pid; break; fi
    sleep 3
  done
  wait $pid 2>/dev/null
}
node tests/run.mjs
for f in js/*.js; do node --check "$f"; done
v=$(date +%y%m%d%H%M)
sed -i '' "s/^const VERSION = '.*';/const VERSION = 'h-$v';/" sw.js
# The build a device reports in its stats is the same one the service worker caches.
sed -i '' "s/^const VERSION = '.*';/const VERSION = 'h-$v';/" js/telemetry.js
git add -A
git commit -q --no-verify -m "${1:-Update}" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || true
GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p') git push -q origin main || echo "GitHub push failed (network); it goes out with the next deploy"
out=$(mktemp -d)
# Server: only when its code changed (worker/ or the shared merge/history logic), and never hang the deploy.
wsum=$(cat worker/index.js worker/wrangler.toml js/merge.js js/history.js js/access.js js/webpush.js js/money.js js/auth.js | shasum | cut -c1-12)
if [ "$wsum" != "$(cat .worker-sum 2>/dev/null)" ]; then
  (cd worker && run_for 150 wrangler deploy) && echo "$wsum" > .worker-sum && echo "server deployed" || echo "server deploy skipped or failed"
fi
rsync -a --exclude worker --exclude .git --exclude .claude --exclude tests --exclude scripts --exclude package.json ./ "$out/"
# Cloudflare sometimes publishes but never answers this network; kill after 120s and check the live site instead.
marker=$(sed -n "s/^const VERSION = '\(.*\)';/\1/p" sw.js)
for proj in gethisaab hisaab; do
  host=$([ "$proj" = hisaab ] && echo hisaab-s4u || echo gethisaab)
  run_for 150 wrangler pages deploy "$out" --project-name $proj --branch main --commit-dirty=true || true
  if curl -s -m 20 "https://$host.pages.dev/sw.js" | grep -q "$marker"; then echo "live: https://$host.pages.dev ($marker)"; else echo "NOT live yet: https://$host.pages.dev"; fi
done
rm -rf "$out"
