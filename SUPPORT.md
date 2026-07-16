# Support

The Causet SDKs are open source under the [MIT License](LICENSE). Support is provided through this repository.

## How to get help

| Need | Channel |
|------|---------|
| Bug reports | [GitHub Issues — Bug report](https://github.com/Causet-Inc/causet-sdks/issues/new?template=bug_report.md) |
| Feature requests | [GitHub Issues — Feature request](https://github.com/Causet-Inc/causet-sdks/issues/new?template=feature_request.md) |
| Usage questions | [GitHub Issues — Question](https://github.com/Causet-Inc/causet-sdks/issues/new?template=question.md) |
| Security vulnerabilities | [SECURITY.md](SECURITY.md) — **do not** open public issues |
| Product / platform docs | [docs.causet.io](https://docs.causet.io) |

**GitHub Issues are the official support channel** for SDK bugs, compatibility questions, and feature requests. There is no separate paid support desk or response-time SLA for this repository.

## What to include in an issue

- SDK language and package name (for example `@causet/sdk` **0.2.0**)
- Runtime version (Node.js, Python, Java, etc.)
- Minimal reproduction steps or code sample
- Expected vs actual behavior
- Relevant logs or error messages (redact API keys and tokens)

## Response expectations

Maintainers triage issues on a **best-effort** basis. Published npm packages (`0.2.0`) receive priority for regressions and security fixes. Source-only SDKs (Python, Java, PHP, Go) are maintained in-tree but may have slower turnaround until they reach a public registry.

## SDK status

Current package availability, maturity, and runtime compatibility are documented in:

- [README.md — SDK status matrix](README.md#sdk-status)
- [docs/sdk-status.json](docs/sdk-status.json)

## Contributing fixes

See [CONTRIBUTING.md](CONTRIBUTING.md). Pull requests with tests are welcome.
