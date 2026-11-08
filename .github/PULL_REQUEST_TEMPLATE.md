## Summary

<!-- What changes, and why. Link the issue if one exists. -->

## Surfaces affected

- [ ] Host API / storage
- [ ] Rule engine / command parser
- [ ] Commit guard / model tools
- [ ] Git hooks
- [ ] Client UI / i18n
- [ ] Documentation / manifest

## Verification

- [ ] `npm run verify` passes
- [ ] A new or updated test fails without this change
- [ ] Real Harness check (describe the profile, workspace type, and surface)

## Risk and compatibility

<!-- Any storage schema change, DSH version move, or behavior change that could block a commit. -->

## Checklist

- [ ] No secrets, tokens, or private keys are added.
- [ ] Enforcement failures still fail open.
- [ ] Repository writes remain limited to the opt-in hooks.
- [ ] `CHANGELOG.md` updated for user-visible changes.
- [ ] English and Chinese UI strings updated when the Client changed.
