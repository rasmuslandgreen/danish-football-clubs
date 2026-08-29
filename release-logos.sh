#!/bin/bash
set -e

npm run logos

git add assets/logos/ clubs.json index.js
git commit -m "Add logos"
git push origin main

echo ""
echo "✓ Done. Run 'npm update danish-football-clubs' in consuming projects to get the latest logos."
