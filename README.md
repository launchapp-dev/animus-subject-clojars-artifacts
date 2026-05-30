# animus-subject-clojars-artifacts

Animus subject backend for Clojars artifact metadata.

The plugin queries the public Clojars JSON search and artifact APIs, maps artifact search results into `clojars.artifact` subjects, and supports detail lookups by `group/artifact` coordinate. Artifact subjects include versions, downloads, maintainer user, homepage, SCM, licenses, dependencies, recent versions, and search-result metadata when available.

## Configuration

All settings are optional.

| Environment variable | Description |
| --- | --- |
| `CLOJARS_BASE_URL` | Clojars base URL. Defaults to `https://clojars.org`. |
| `CLOJARS_API_URL` | Deprecated alias for `CLOJARS_BASE_URL`. |
| `CLOJARS_QUERY` | Artifact search query for list requests. Defaults to `ring`. |
| `CLOJARS_PAGE` | Starting search results page. Defaults to `1`. |
| `CLOJARS_LIMIT` | Maximum artifacts to return, 1-100. Defaults to `24`. |
| `CLOJARS_GROUP` | Exact Clojars group filter applied after search. |
| `CLOJARS_LICENSE` | Exact license-name filter applied after search, such as `The MIT License`. |
| `CLOJARS_LOCAL_QUERY` | Local text query applied to artifact, dependency, SCM, license, user, and version fields. |

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run manifest
```

## Install

```bash
animus plugin install launchapp-dev/animus-subject-clojars-artifacts
```
