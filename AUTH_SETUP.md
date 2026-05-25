# Authentication Setup for Teams

This project uses a **session-based authentication pool** to share test access across team members without storing passwords in git.

## Quick Start

### For Local Development

1. **Clone the repo** (as usual)
   ```bash
   git clone <repo>
   cd e2e
   npm install
   ```

2. **Generate your first session** - Choose one:

   **Option A: Automatic (Recommended for CI/CD)**
   ```bash
   chmod +x scripts/refresh-auth-sessions.sh
   ./scripts/refresh-auth-sessions.sh --auto tester1
   ```
   ✅ No interaction needed - script logs in automatically

   **Option B: Interactive (For local debugging)**
   ```bash
   ./scripts/refresh-auth-sessions.sh --manual tester1
   ```
   📝 Browser opens - you log in manually

3. **Done!** Session is saved and tests will use it automatically

### Run Tests

```bash
# Tests automatically pick a random session from auth-pool/
npx playwright test

# Or run specific test
npx playwright test tests/web/traveloka-flight-booking-weekly-diff-20260525.spec.ts
```

## How It Works

```
┌─────────────────────────────────────┐
│  fixture.ts (test setup)            │
│                                     │
│  1. Check auth-pool/ directory      │
│  2. Pick random session file        │
│  3. Inject cookies into browser     │
│  4. Run test (authenticated)        │
└─────────────────────────────────────┘
                 ↑
                 │
         ┌───────┴────────┐
         │                │
   ┌─────▼──────┐   ┌────▼─────┐
   │ tester1    │   │ tester2  │
   │ .json      │   │ .json    │
   └────────────┘   └──────────┘
   (cookies, storage)
```

## File Structure

```
auth-pool/
├── .gitkeep              # Keeps directory in git
├── README.md             # Documentation
├── tester1.json          # (auto-generated on first run)
└── tester2.json          # (optional, for parallel testing)
```

⚠️ **Important**: `*.json` files are in `.gitignore` - they're never committed to git.

## Maintenance

### Session Expiration

Sessions expire after ~30 days. To refresh:

**Automatically (CI/CD):**
- GitHub Actions runs `refresh-auth.yml` every Sunday at 2 AM UTC
- Uses `scripts/generate-auth-session.ts` (fully automated, no interaction)
- Commits updated sessions back to repo

**Manually - Automatic method (headless, for servers):**
```bash
./scripts/refresh-auth-sessions.sh --auto tester1
```

**Manually - Interactive method (for local debugging):**
```bash
./scripts/refresh-auth-sessions.sh --manual tester1
```

### Multiple Test Accounts

To add more accounts for parallel testing:

```bash
# Generate tester2 (automatic)
./scripts/refresh-auth-sessions.sh --auto tester2

# Generate tester3 (manual interactive)
./scripts/refresh-auth-sessions.sh --manual tester3

# Then tests will randomly pick from all three
npm test  # Uses tester1, tester2, or tester3
```

## Security

✅ **What's secure:**
- Passwords never stored in git
- Sessions are short-lived (30 days)
- Each team member can regenerate sessions

⚠️ **Security tips:**
- Keep `auth-pool/*.json` files out of git (it's in `.gitignore`)
- Don't share session files in Slack/email
- Rotate test accounts regularly
- Use unique test accounts, not production accounts

## Troubleshooting

### "No session cookies available"

**Cause**: `auth-pool/` directory is empty

**Solution**:
```bash
# Automatic (recommended for CI/CD)
./scripts/refresh-auth-sessions.sh --auto tester1

# Or interactive for debugging
./scripts/refresh-auth-sessions.sh --manual tester1
```

### Tests still fail after login

**Possible causes:**
1. Session expired (older than 30 days)
2. Traveloka changed login page
3. Browser fingerprinting issue

**Solution**:
1. Regenerate session: `./scripts/refresh-auth-sessions.sh --auto tester1`
2. Check if test URL is correct
3. Run with `--headed` to see what's happening:
   ```bash
   npx playwright test --headed
   ```

### GitHub Actions CI refresh failed

**Check:**
1. GitHub has permissions to commit to repo
2. Credentials are still valid
3. Traveloka login UI hasn't changed dramatically

**Manually trigger refresh:**
1. Go to GitHub repo → Actions → Refresh Auth Sessions
2. Click "Run workflow"
3. Select the account to refresh

## Next Steps

- [ ] Generate initial session: `./scripts/refresh-auth-sessions.sh tester1`
- [ ] Run tests: `npm test`
- [ ] Check GitHub Actions is configured
- [ ] Set reminder to refresh sessions monthly

---

For more details, see [auth-pool/README.md](./auth-pool/README.md)
