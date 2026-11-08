# Release

## One-time setup

- npm account with publish rights for `dsh-visualrules` (current status: **not published**; the package name is reserved locally but not on the registry).
- GitHub repository `Mephisto1056/DSH-visualrules`.
- `npm login` on the release machine.

## Publish path

The `Release` workflow triggered by a GitHub Release only **verifies** the artifact. npm publishing is an explicit manual run (`workflow_dispatch` with `dry_run: false`), so a missing token can never turn a release red. The steps below are the local equivalent.

## Checklist

```sh
# 1. Clean install and gate
rm -rf node_modules package-lock.json
npm install
npm run verify

# 2. Version bump (package.json + package-lock.json)
npm version 0.2.1 --no-git-tag-version

# 3. Update CHANGELOG.md and both README install snippets if needed
# 4. Pack and inspect what would ship
npm pack --dry-run

# 5. Publish
npm publish --access public

# 6. Tag and release
git add -A
git commit -m "chore(release): v0.2.1"
git tag -a v0.2.1 -m "v0.2.1"
git push origin main --tags
gh release create v0.2.1 --title "v0.2.1" --notes-file CHANGELOG.md
```

## Package contents to verify

`npm pack --dry-run` should list:

- `lib/**/*.js`, `lib/hook/check.mjs`
- `locale/en.json`, `locale/zh.json`
- `cordis.patch.yml`, `icon.svg`
- `README.md`, `README_ZH.md`, `CHANGELOG.md`, `LICENSE`
- `examples/profile.yaml`
- `scripts/hooks.mjs`

The `files` list in `package.json` is authoritative. Do not ship tests, screenshots, or local storage.

## After publishing

- `npm view dsh-visualrules version`
- `npm view dsh-visualrules dist.tarball`
- Install into a scratch DSH profile and run the smoke flow:
  1. Header entry appears.
  2. Full page loads with all tabs.
  3. Validation tab reaches the Host API.
  4. A protected-branch commit is rejected and the model reads the reason.
  5. The hook install preview shows both files; install/uninstall works.
  6. The AI commit index records a successful commit.

## Release note template

```markdown
## dsh-visualrules vX.Y.Z

### Added
- …

### Changed
- …

### Fixed
- …

### Verification
- `npm run verify` (N tests)
- Real-host checks: …
```
