# AGENTS.md

## Work Flow

- Every change needs a GitHub issue before implementation.
- Every change needs its own branch from `main`.
- Branch names should be short and scoped, for example `chore/release-pipeline` or `fix/widget-retry`.

## Release Flow

- Versions use CalVer: `YYYY.MINOR.PATCH`, with prereleases like `YYYY.MINOR.PATCH-alpha.1`.
- Git tags use the same version with a `v` prefix, for example `v2026.1.0-alpha.1`.
- `package.json` must match the tag without the `v` prefix.

Before tagging:

```powershell
npm test
npm run build
npm run package:win
```

Create a release tag:

```powershell
npm version 2026.1.0-alpha.1 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore: prepare 2026.1.0-alpha.1 release"
git tag v2026.1.0-alpha.1
git push origin main
git push origin v2026.1.0-alpha.1
```

Pushing the tag triggers `.github/workflows/release.yml`, which builds Windows and Linux artifacts and publishes a GitHub Release with generated notes.

After the tag is pushed, close the milestone for that release so it stops accepting issues. Look up the milestone number from `gh api repos/:owner/:repo/milestones`, then:

```powershell
gh api repos/:owner/:repo/milestones/<number> --method PATCH -f state=closed
```

### WinGet submission

Submit WinGet only for stable releases, not prerelease tags. After the GitHub Release has published the Windows installer, generate the WinGet manifests:

```powershell
npm run winget:manifest -- -Version 2026.1.0
winget validate winget-manifests\manifests\o\OwenMcGirr\UsefulTopmost\2026.1.0
```

The script writes the `microsoft/winget-pkgs` folder layout under `winget-manifests\`. Copy that manifest folder into a fork or branch of `microsoft/winget-pkgs`, run the repository sandbox test, then open a PR to `microsoft/winget-pkgs`.

Expected package identity:

```yaml
PackageIdentifier: OwenMcGirr.UsefulTopmost
PackageName: Useful Topmost
Publisher: Owen McGirr
InstallerType: nullsoft
```

Before submitting, verify the Windows installer supports silent install and clean uninstall. The WinGet manifest must reference the direct GitHub Release asset URL and exact SHA256 for that asset.

## Design language

- Sentence case for all user-facing text — headings, navigation, buttons, labels, placeholders, status. Acronyms (API, URL, HTTP, NSIS) keep their canonical case.
- Status text uses the single ellipsis character `…` (not three dots `...`) for in-progress states (e.g. "Building widget…", "Searching the official docs…"), and ends with `.` for terminal/empty states (e.g. "No widgets yet.", "Up to date.").
- `aria-label` values match the casing of their visible label. For purely descriptive `aria-label`s with no visible text, use sentence case.
