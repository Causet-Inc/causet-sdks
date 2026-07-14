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

No publish step. Tag the repo and consumers run:

```bash
go get github.com/causet-inc/causet-sdk-go@v0.1.0
```

See `packages/go/README.md` for monorepo vs dedicated-repo module path options.

---

## Java / Maven Central (manual setup)

Register `com.causet` on [central.sonatype.com](https://central.sonatype.com), configure GPG signing and `distributionManagement` in `pom.xml`, then add a `publish-maven.yml` workflow when credentials are ready.

---

## Laravel / Packagist (webhook)

Register `causet/laravel-sdk` at [packagist.org](https://packagist.org) pointing at `packages/laravel`. Packagist auto-updates when you push release tags.

---

## First release checklist

- [ ] `NPM_TOKEN` secret + `npm` environment
- [ ] PyPI trusted publisher + `pypi` environment
- [ ] All package versions match release tag
- [ ] GitHub Release `v0.1.0` created
