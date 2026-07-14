# Security Policy

## Supported versions

Security fixes are provided for the latest release of each published package:

| Package | Registry |
|---------|----------|
| `@causet/sdk-core`, `@causet/sdk`, `@causet/sdk-node`, `@causet/sdk-next` | npm |
| `causet-sdk` | PyPI |
| `github.com/causet-inc/causet-sdk-go` | Go modules |
| `com.causet:causet-sdk` | Maven Central |
| `causet/laravel-sdk` | Packagist |

## Reporting a vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report security issues privately to **security@causet.cloud** with:

- A description of the issue and potential impact
- Steps to reproduce
- Affected package(s) and version(s)
- Any suggested remediation

We aim to acknowledge reports within **3 business days** and will coordinate disclosure and fixes with reporters.

## Safe usage

- Never embed production API keys (`ck_live_...`) in browser code or client-side bundles.
- Use `bearerToken` / session JWTs for user-facing apps.
- Rotate API keys if you suspect exposure.
- Pin SDK versions in production deployments.

## Dependency updates

This repository runs `npm audit` in CI for JavaScript packages. Report supply-chain concerns through the same private channel above.
