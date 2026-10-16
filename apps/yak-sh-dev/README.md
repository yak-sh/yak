# yak.sh developer guide

A static developer-facing site, deployed independently of yak.sh and the CRT
experiment in `apps/yak-sh-v2`. It uses plain HTML, CSS and JavaScript,
including an in-memory graph runtime generated from workspace sources.
`apps/yak-sh` owns the existing personal pages; this app changes neither those
files nor the yak.sh domain.

## Build and run

From the repository root, rebuild the checked-in browser runtime after changing
its workspace dependencies:

```sh
deno run -A apps/yak-sh-dev/build.ts
```

`runtime.ts` exports the workspace graph, RAM adapter, vocabulary loader,
generic tools and stored-call runner. `build.ts` runs
`deno bundle --platform browser` and formats `runtime.js`. Commit the generated
file alongside source changes; serving the site does not require Deno or a build
step. Use the repository's Deno version when rebuilding so generated output
stays reproducible.

Serve this directory with a static HTTP server. The guide needs no server-side
code. `playground.js` imports the generated runtime locally and the CLI parser
from `@yaks/cli@0.2.10` through the page's esm.sh import map. The CLI stays
pinned because its workspace entry includes server dependencies unsuitable for
the browser. The playground adapts workspace positional declarations to that
CLI’s `options` metadata and carries query words as an array before joining them
for the graph tool. Only the CLI parser needs a network connection on first use.
Copy buttons require a secure context (HTTPS or localhost).

The playground holds its own graph in memory; reloading discards all changes. It
runs query patches through the workspace graph tools, including both target
forms:

```sh
graph apply c3272ad7-1f5b-475a-b934-cd6d0a15ab41 .book.pages=500
graph apply .entity.eid=c3272ad7-1f5b-475a-b934-cd6d0a15ab41 .book.pages=500
```

`graph apply --bundles '<JSON array>'` accepts batches. `.book.pages=null`
clears a property and `!book` removes the component. `help graph apply`
describes the arguments. These commands change only this tab's graph.

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
| Browser query and patch commands               | Workspace generic tools and a browser run with the pinned CLI parser                   |
| Toolkit / hosted platform distinction          | M-34600; platform guide                                                                |
| Hosted product pitch                           | M-37845 (a draft, not a settled slogan)                                                |

## Check

From the repository root:

```sh
deno task test apps/yak-sh-dev
deno check apps/yak-sh-dev/build.ts apps/yak-sh-dev/runtime.ts apps/yak-sh-dev/playground_test.ts
deno lint apps/yak-sh-dev
deno fmt --check apps/yak-sh-dev
```

The tests create the full playground with the generated runtime and workspace
CLI parser: they exercise both target forms, batch input, queries, schema types,
property clearing, component removal and refusal without mutation. Browser
checks must also exercise the actual CDN CLI parser through the import map:
check a query, a patch updating the visible book, filtering, help, and reload
isolation. Inspect desktop and phone layouts. Run the build twice and compare
`runtime.js` to check determinism. Deployment is from a clean, current main
checkout with `yak admin push`.
