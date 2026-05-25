#!/bin/bash

# Script to generate auth sessions (automatic or manual)
# Usage: ./scripts/refresh-auth-sessions.sh [--auto] [tester1|tester2|tester3]

set -euo pipefail

ACCOUNT="${2:-tester1}"
MODE="${1:---manual}"
AUTH_POOL_DIR="./auth-pool"

if [[ ! "$ACCOUNT" =~ ^tester[123]$ ]]; then
  echo "Usage: $0 [--auto|--manual] [tester1|tester2|tester3]"
  echo ""
  echo "Options:"
  echo "  --auto      Automatic headless login (for CI/CD)"
  echo "  --manual    Interactive codegen login (default)"
  echo ""
  echo "Examples:"
  echo "  ./scripts/refresh-auth-sessions.sh --auto tester1"
  echo "  ./scripts/refresh-auth-sessions.sh --manual tester2"
  exit 1
fi

mkdir -p "$AUTH_POOL_DIR"
SESSION_FILE="$AUTH_POOL_DIR/$ACCOUNT.json"

echo "🔐 Generating session for $ACCOUNT..."
echo "Mode: $MODE"
echo ""

if [[ "$MODE" == "--auto" ]]; then
  # Automatic headless login
  echo "🤖 Using automatic headless login (no interaction needed)..."
  echo ""
  npx ts-node scripts/generate-auth-session.ts "$ACCOUNT"
  
elif [[ "$MODE" == "--manual" ]]; then
  # Interactive codegen
  echo "📝 Using interactive Playwright Codegen..."
  echo "Instructions:"
  echo "  1. Browser will open - log in manually"
  echo "  2. Email: flpostissuance@gmail.com"
  echo "  3. Password: TvlkQAflight"
  echo "  4. After login, close the browser or press Ctrl+C"
  echo ""
  
  npx playwright codegen --save-storage="$SESSION_FILE" https://www.traveloka.com/en-en/flight
else
  echo "Invalid mode: $MODE"
  exit 1
fi

if [[ -f "$SESSION_FILE" ]]; then
  COOKIE_COUNT=$(jq '.cookies | length' "$SESSION_FILE")
  echo ""
  echo "✅ Session saved successfully!"
  echo "   - File: $SESSION_FILE"
  echo "   - Cookies: $COOKIE_COUNT"
  
  # Show git status
  echo ""
  echo "📋 Next steps:"
  echo "   git status $SESSION_FILE"
  echo "   (This file is in .gitignore - don't commit it)"
else
  echo ""
  echo "❌ Session file not created"
  exit 1
fi
