# Changelog

All notable changes to the Causet SDKs are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Standalone open-source repository with CI for JavaScript, Python, Go, Java, and Laravel packages
- GitHub Actions workflow with 100% coverage gates for JS and Python
- CONTRIBUTING, SECURITY, and CODE_OF_CONDUCT documentation

### Changed

- SDKs moved out of the Causet platform monorepo into `Causet-Inc/causet-sdks`
- Java SDK: replace removed OkHttp `encodeUtf8` with path-segment encoding helper
- Python SDK: align local WebSocket URL tests with realtime port `8081` mapping

## [0.1.0] - 2026-03-14

### Added

- `@causet/sdk-core`, `@causet/sdk`, `@causet/sdk-node`, `@causet/sdk-next`
- `causet-sdk` Python package (async + sync clients)
- `causet-sdk-go` Go module
- `com.causet:causet-sdk` Java library
- `causet/laravel-sdk` PHP package

[Unreleased]: https://github.com/Causet-Inc/causet-sdks/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Causet-Inc/causet-sdks/releases/tag/v0.1.0
