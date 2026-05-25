#!/bin/bash

# 这个脚本使用 Playwright codegen 来录制登录会话并保存 cookies
# 
# Usage:
#   ./scripts/generate-session.sh

echo "🎬 Opening Playwright Codegen to record your login session..."
echo ""
echo "Instructions:"
echo "1. The browser will open - log in manually using:"
echo "   Email: flpostissuance@gmail.com"
echo "   Password: TvlkQAflight"
echo ""
echo "2. After login succeeds, close the browser or press Ctrl+C"
echo "3. Session data will be saved to session-data.json"
echo ""
echo "Starting codegen..."
echo ""

cd "$(dirname "$0")/.."

# Use Playwright's codegen to record and save storage state
npx playwright codegen \
  --save-storage=session-data.json \
  https://www.traveloka.com/en-en/flight

echo ""
echo "✅ Session saved! You can now run tests:"
echo "   npx playwright test"
