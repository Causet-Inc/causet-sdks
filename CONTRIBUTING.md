# Contributing to Causet SDKs

Thank you for helping improve the official Causet client libraries.

## Getting started

1. Fork [causet-sdks](https://github.com/Causet-Inc/causet-sdks) and clone your fork.
2. Install prerequisites listed in [README.md](README.md#development).
3. Create a feature branch from `main`.

```bash
git checkout -b feat/my-change
```

## Development workflow

### JavaScript / TypeScript

```bash
npm install
npm run build
npm test
```

All JS packages enforce **100% Vitest coverage**. If you add code, add tests in the same package under `src/__tests__/`.

### Python

```bash
cd packages/python
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest --cov=causet_sdk --cov-fail-under=100
```

### Go

```bash
cd packages/go
go test ./...
```

### Java

```bash
cd packages/java
mvn test
```

### Laravel

```bash
cd packages/laravel
composer install
composer test
```

## Pull request guidelines

- Keep changes focused — one logical change per PR.
- Update package READMEs when public API or behavior changes.
- Ensure all relevant test suites pass locally before opening a PR.
- Do not commit secrets, API keys, or `.env` files.
- Follow existing naming and style in each language package.

## Commit messages

Use clear, imperative subjects:

- `fix(js): handle SSE reconnect backoff`
- `feat(python): add bearer token refresh hook`
- `docs: clarify fork_id in stream subscriptions`

## Code of conduct

Be respectful and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Questions and support

Open a [GitHub issue](https://github.com/Causet-Inc/causet-sdks/issues/new/choose) for bugs, feature requests, or usage questions. See [SUPPORT.md](SUPPORT.md).

Platform documentation: [docs.causet.io](https://docs.causet.io)

## Publishing releases

Maintainers: see [docs/PUBLISHING.md](docs/PUBLISHING.md) for npm, PyPI, Go, Maven, and Packagist.
