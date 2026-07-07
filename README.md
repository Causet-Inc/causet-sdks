# Causet SDKs

Official SDKs for building applications on Causet.

This repository contains language-specific SDKs used to define, publish, and interact with Causet programs, events, workflows, projections, timelines, and runtime APIs.

> This repository does not currently publish GitHub Releases. For now, official releases are only published for the Causet CLI.

## What is Causet?

Causet is a platform for building durable, event-driven applications. It helps developers model business workflows, state changes, timelines, projections, and background processing in a consistent way across local development, cloud environments, and production runtimes.

## Repository Scope

This repository is intended to contain the official SDKs for Causet-supported languages.

Examples may include:

* TypeScript / JavaScript SDK
* Java SDK
* Go SDK
* Python SDK
* Runtime client libraries
* Event publishing helpers
* Workflow definition helpers
* Projection and query helpers

## Current Status

The SDKs are under active development.

The initial focus is on stabilizing the Causet CLI, compiler, and runtime developer experience. SDK packages may exist in this repository before they are formally versioned or released.

Until SDK releases are officially published, treat APIs as experimental.

## Releases

GitHub Releases are not currently published from this repository.

For now, official downloadable releases are only available from the `causet-cli` repository.

## Goals

The Causet SDKs are designed to make it easier to:

* Define Causet programs in application code
* Publish and consume events
* Interact with the Causet runtime
* Build durable workflows
* Query projections and timeline state
* Integrate Causet with existing services
* Support local development and production deployment flows

## Example Structure

```text
causet-sdks/
  typescript/
  java/
  go/
  python/
  examples/
  docs/
```

Actual package structure may change as the SDKs mature.

## Contributing

Contribution guidelines will be added as the SDKs stabilize.

## License

License information will be added before the first public release.
