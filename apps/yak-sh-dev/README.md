# yak.sh developer guide

A static developer-facing site, deployed independently of yak.sh and the CRT
experiment in `apps/yak-sh-v2`. It uses plain HTML, CSS and JavaScript with no
build step. `apps/yak-sh` owns the existing personal pages; this app changes
neither those files nor the yak.sh domain.

## Run

Serve this directory with a static HTTP server. The guide needs no server-side
code. The playground lazily imports published packages through esm.sh and holds
its own graph in memory; reloading discards all changes. Copy buttons require a
secure context (HTTPS or localhost).

`playground.js` composes the real graph, RAM adapter, generic tools, stored-call
runner, and CLI parser. Its import map pins published release 0.2.10. That
release's graph apply tool calls its array input `--change`; current workspace
help calls it `--bundles`. The playground examples use the published tool's
syntax, checked in a browser, not a speculative version of the workspace API.

## Content sources

The package READMEs are the reference, linked rather than reproduced. The site
is a draft developer pitch, not the consumer home page of yaks.app.

| Site content                                   | Checked against                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Entity, component, bundle, batch, transactions | `packages/graph/README.md` Data model                                                  |
| Deno / Node library install                    | `packages/graph/README.md` Install                                                     |
| In-memory book graph                           | `packages/graph/README.md` complete example; `packages/ram/README.md` Use              |
| CLI install, init, local / remote target       | `packages/cli/README.md` opening example, Where a command runs, The config; `yak help` |
| MCP route and authentication                   | `packages/mcp/README.md` Use, plugin route; `packages/api/README.md` serving defaults  |
| Package descriptions                           | Each linked package's README opening and exports                                       |
| Browser query and patch commands               | Published generic tools' CLI help and a real browser run                               |
| Toolkit / hosted platform distinction          | M-34600; platform guide                                                                |
| Hosted product pitch                           | M-37845 (a draft, not a settled slogan)                                                |

## Check

From the repository root:

```sh
deno task test apps/yak-sh-dev
deno check apps/yak-sh-dev/playground_test.ts
deno lint apps/yak-sh-dev
deno fmt --check apps/yak-sh-dev
```

The tests check command tokenization using workspace imports; browser checks
exercise the actual graph commands through the pinned published modules. Check a
query, a patch updating the visible book, filtering, help, and reload isolation.
Inspect desktop and phone layouts. Deployment is from a clean, current main
checkout with `yak admin push`.
