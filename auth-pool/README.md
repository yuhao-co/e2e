# Authentication Pool Configuration

This directory stores pre-generated Playwright authentication sessions for different test accounts.

## Files

- `tester1.json` - Primary test account (flpostissuance@gmail.com)
- `tester2.json` - (Optional) Secondary test account for parallel runs
- `tester3.json` - (Optional) Tertiary test account

## .gitignore

These files contain sensitive session cookies and should NOT be committed to version control.

Create a `.gitignore` entry:

```
# .gitignore
auth-pool/*.json
!auth-pool/.gitkeep
!auth-pool/README.md
```

## Generating New Sessions

### Manual: Using Playwright Codegen

```bash
npx playwright codegen --save-storage=auth-pool/tester1.json https://www.traveloka.com/en-en/flight
```

This will:
1. Open a browser
2. Let you manually log in
3. Automatically save cookies/storage to `auth-pool/tester1.json`

### Automated: Using GitHub Actions (CI)

The `.github/workflows/refresh-auth.yml` workflow runs weekly to refresh all session files.

## Usage in Tests

The fixture automatically:
1. Loads available session files from `auth-pool/`
2. Randomly picks one for each test run
3. Injects cookies into the browser context

No manual configuration needed!

## Session Refresh Strategy

Sessions expire after 30 days. To keep them fresh:

1. **Local Development**: Manually run codegen when needed
2. **CI/CD**: Automated weekly refresh via GitHub Actions
3. **Production**: Use `.github/workflows/refresh-auth.yml`

## Security Notes

- ⚠️ Session files contain authentication tokens
- Never commit `*.json` files to git
- Only share session files through secure channels
- Rotate test accounts regularly
