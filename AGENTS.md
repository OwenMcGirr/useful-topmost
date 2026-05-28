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
