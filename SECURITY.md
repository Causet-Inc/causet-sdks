# Security Policy

## Supported versions

Security fixes are provided for the **latest published release** of each package:

| Package | Registry | Currently published |
|---------|----------|---------------------|
| `@causet/sdk-core`, `@causet/sdk`, `@causet/sdk-node`, `@causet/sdk-next` | npm | Yes — **0.2.0** |
| `causet-sdk` | PyPI | No — source only |
| `com.causet:causet-sdk` | Maven Central | No — coming soon |
| `github.com/causet-inc/causet-sdk-go` | Go modules | No — source only |
| `causet/laravel-sdk` | Packagist | No — source only |

For unpublished source-only SDKs, apply fixes on `main` and install from this repository.

## Reporting a vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report security issues privately to **security@causet.cloud** with:

- A description of the issue and potential impact
- Steps to reproduce
- Affected package(s) and version(s)
- Any suggested remediation

We aim to acknowledge reports within **3 business days** and will coordinate disclosure and fixes with reporters.

For non-security bugs, use [GitHub Issues](https://github.com/Causet-Inc/causet-sdks/issues/new/choose). See [SUPPORT.md](SUPPORT.md).

## Safe usage

- Never embed production API keys (`ck_live_...`) in browser code or client-side bundles.
- Use `bearerToken` / session JWTs for user-facing apps.
- Rotate API keys if you suspect exposure.
- Pin SDK versions in production deployments.

## Dependency updates

This repository runs `npm audit` in CI for JavaScript packages. Report supply-chain concerns through the private security channel above.
