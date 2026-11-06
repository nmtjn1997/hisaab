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
GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p') git push -q origin main
out=$(mktemp -d)
rsync -a --exclude .git --exclude .claude --exclude tests --exclude scripts --exclude package.json ./ "$out/"
wrangler pages deploy "$out" --project-name hisaab --branch main --commit-dirty=true 2>&1 | tail -1
rm -rf "$out"
