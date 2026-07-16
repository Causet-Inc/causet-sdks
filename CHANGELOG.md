# Changelog

All notable changes to the Causet SDKs are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] - 2026-07-16

### Added

- **`submitIntent` API** as the primary method for submitting intents across TypeScript, Python, Go, Java, and Laravel SDKs
- Authoritative SDK status matrix in the root README and `docs/sdk-status.json`
- `scripts/validate-sdk-status.mjs` CI check to detect documentation drift against npm registry
- `SUPPORT.md` with GitHub Issues as the official support channel
- GitHub issue templates (bug, feature, question) and pull request template
- `useCausetSubmitIntent()` and `serverSubmitIntent()` in `@causet/sdk-next`
- `scripts/republish-npm.sh` and npm publish workflow options for republish scope and 2FA OTP
- Open-source readiness: CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, and docs.causet.io links

### Changed

- Root README rewritten with accurate package availability, maturity, and support labels per SDK
- Per-language READMEs updated with status blocks, truthful install instructions, and runtime compatibility
- Replaced internal product naming (`causet-saas-cloud`, `SaaS API`) with **Causet Cloud gateway** and **runtime API**
- Java SDK status: Maven Central publishing coming soon; maturity raised to Preview
- Python SDK documented as not on PyPI yet (source installation only)
- Next.js hooks export `useCausetSubmitIntent` as the primary intent helper

### Deprecated

- `client.intent()` and `client.emit()` on `CausetClient` — use `submitIntent()` instead
- `intent()` / `emit()` equivalents in Python (`intent`), Go (`Intent`), Java (`intent`), and Laravel (`intent`)
- `useCausetIntent()` and `serverIntent()` in `@causet/sdk-next` — use `useCausetSubmitIntent()` and `serverSubmitIntent()`

### Fixed

- Removed broken links to non-existent internal API doc paths from package READMEs
- npm publish workflow now surfaces unpublish failures instead of swallowing errors

## [0.1.0] - 2026-07-14

### Added

- `@causet/sdk-core`, `@causet/sdk`, `@causet/sdk-node`, `@causet/sdk-next` published to npm
- `causet-sdk` Python package (async + sync clients)
- `causet-sdk-go` Go module source
- `com.causet:causet-sdk` Java library source
- `causet/laravel-sdk` PHP package source
- Standalone open-source repository with CI for JavaScript, Python, Go, Java, and Laravel packages
- CONTRIBUTING, SECURITY, and CODE_OF_CONDUCT documentation

[Unreleased]: https://github.com/Causet-Inc/causet-sdks/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Causet-Inc/causet-sdks/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Causet-Inc/causet-sdks/releases/tag/v0.1.0
