## What changed and why

## How it was tested
- [ ] `npm run check` passes (lint, all tests, dependency audit)
- [ ] New behaviour has a test that fails without the change

## Security checklist
- [ ] New request bodies have a schema in `server/schemas.js`
- [ ] New data-changing routes use `requireAuth` (which also checks the CSRF token)
- [ ] User-supplied text shown in the page goes through `esc()`
- [ ] No secrets, personal data or real financial records in code, tests or logs
