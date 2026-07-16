# Publishing

How official Causet SDK packages are released from this repository.

## Release model

Use **GitHub Releases** with semver tags (`v0.1.0`):

1. Bump versions in every package you are releasing.
2. Merge to `main`, ensure CI is green.
3. Create a GitHub Release with a matching tag.
4. Publish workflows run automatically.

| Package | Version file |
|---------|----------------|
| `@causet/sdk-*` | `packages/*/package.json` |
| `causet-sdk` (Python) | `packages/python/pyproject.toml` |
| `causet-sdk-go` | git tag |
| `com.causet:causet-sdk` | `packages/java/pom.xml` |
| `causet/laravel-sdk` | git tag (Packagist) |

---

## JavaScript / npm (automated)

**Workflow:** `.github/workflows/publish-npm.yml`

**Setup:**
1. Create `@causet` org on npmjs.com
2. Add repo secret `NPM_TOKEN` (granular or automation token with publish access)
3. Optional: GitHub `npm` environment for approval gates

**Publish:** Create GitHub Release `v0.1.0` (must match `package.json` versions).

**Dry-run:** Actions → Publish npm → Run workflow (dry_run defaults to true).

---

## Python / PyPI (automated)

**Workflow:** `.github/workflows/publish-pypi.yml`

**Setup:**
1. Enable [trusted publishing](https://docs.pypi.org/trusted-publishers/) on PyPI for `Causet-Inc/causet-sdks`
2. Create GitHub `pypi` environment

Uses OIDC — no long-lived PyPI password required.

---

## Go (tag-based)

Tag the repo and consumers install from the monorepo path until a dedicated module repository is published:

```bash
git clone https://github.com/Causet-Inc/causet-sdks.git
cd causet-sdks/packages/go
go test ./...
```

Or use a `replace` directive in your `go.mod` (see `packages/go/README.md`).

---

## Java / Maven Central (coming soon)

Maven Central publishing is in progress. Until `com.causet:causet-sdk` is available:

1. Install from source: `cd packages/java && mvn install`
2. Depend on the local artifact in your project

When ready, register `com.causet` on [central.sonatype.com](https://central.sonatype.com), configure GPG signing and `distributionManagement` in `pom.xml`, and add a `publish-maven.yml` workflow.

---

## Laravel / Packagist (webhook)

Register `causet/laravel-sdk` at [packagist.org](https://packagist.org) pointing at `packages/laravel`. Packagist auto-updates when you push release tags.

---

## First release checklist

- [ ] `NPM_TOKEN` secret + `npm` environment
- [ ] PyPI trusted publisher + `pypi` environment
- [ ] All package versions match release tag
- [ ] GitHub Release `v0.1.0` created

## Local release script

`release.sh` lives at the repo root and is **gitignored** (local tooling). Bootstrap:

```bash
cp scripts/release.sh.example release.sh
chmod +x release.sh
```

```bash
./release.sh --dry-run 0.1.0    # verify build + tests only
./release.sh --bump 0.2.0       # bump versions, test, tag, push, GitHub release
./release.sh 0.1.0              # release when versions already match
```

Creating the GitHub release triggers `publish-npm` and `publish-pypi` workflows automatically.
