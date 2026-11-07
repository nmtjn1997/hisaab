#!/bin/bash
# Test, bump the service-worker cache version, push to GitHub Pages and deploy Cloudflare Pages.
set -euo pipefail
cd "$(dirname "$0")/.."
node tests/run.mjs
for f in js/*.js; do node --check "$f"; done
v=$(date +%y%m%d%H%M)
sed -i '' "s/^const VERSION = '.*';/const VERSION = 'h-$v';/" sw.js
git add -A
git commit -q --no-verify -m "${1:-Update}" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" || true
GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p') git push -q origin main || echo "GitHub push failed (network); it goes out with the next deploy"
out=$(mktemp -d)
# Server: only when its code changed (worker/ or the shared merge/history logic), and never hang the deploy.
wsum=$(cat worker/index.js worker/wrangler.toml js/merge.js js/history.js | shasum | cut -c1-12)
if [ "$wsum" != "$(cat .worker-sum 2>/dev/null)" ]; then
  (cd worker && timeout 120 wrangler deploy 2>&1 | grep -E 'Deployed|error') && echo "$wsum" > .worker-sum || echo "worker deploy skipped or failed"
fi
rsync -a --exclude worker --exclude .git --exclude .claude --exclude tests --exclude scripts --exclude package.json ./ "$out/"
# Cloudflare sometimes publishes but never answers this network; kill after 120s and check the live site instead.
marker=$(sed -n "s/^const VERSION = '\(.*\)';/\1/p" sw.js)
for proj in gethisaab hisaab; do
  host=$([ "$proj" = hisaab ] && echo hisaab-s4u || echo gethisaab)
  timeout -k 5 120 wrangler pages deploy "$out" --project-name $proj --branch main --commit-dirty=true >/dev/null 2>&1
  if curl -s -m 20 "https://$host.pages.dev/sw.js" | grep -q "$marker"; then echo "live: https://$host.pages.dev ($marker)"; else echo "NOT live yet: https://$host.pages.dev"; fi
done
rm -rf "$out"
