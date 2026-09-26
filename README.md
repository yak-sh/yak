# yaks

One graph, worked by people and agents through the same doors.

This repository is the yaks toolkit: the `@yaks/*` packages, the `yak` command
that composes them over one SQLite file, the web canvas and terminal UI, and
yaks.app, the Cloudflare Worker that hosts yaks apps. Tasks, projects, agent
sessions, memories and the UI's own state are entities in one graph; every
change is a batch of entity patches, and every list is a query.

## Start

```sh
deno install -gAf jsr:@yaks/cli/yak  # or, from a checkout: deno task install
yak init Ada                         # ~/.yak/yak.json and its graph, worked at by Ada
yak task new 'Buy the cake'
yak task list
yak serve                            # the canvas, /mcp and /query on http://127.0.0.1:8787
```

`yak init` writes the config (`db`, the plugins, and who you are) and never
replaces one. `yak serve` listens on this machine alone; a config's `hostname`
offers it to a network, and it has no authentication of its own. @yaks/web is
not on JSR yet, so the web canvas comes with a checkout.

Agents join the same graph:

- **Claude Code**: `yak hooks install` writes lifecycle hooks into
  `~/.claude/settings.json`. Each session becomes a session entity, is told its
  claims when it starts, and releases them when it ends.
- **Any MCP client**: `http://127.0.0.1:8787/mcp` serves the graph's tools.

## The model

An **entity** is an id carrying **components**: a task is `doc{title, body}`
plus `task{}`, a board is `doc` plus `board{query}`, and nothing stores a kind.
An edge between two entities is an entity too. A write is a batch of bundles,
`{entity: {eid}, <component>: {<properties>}}`, applied in one transaction: an
omitted property is unchanged, `null` clears one, and `$delete: true` deletes
the entity. One query grammar filters everywhere: `.task.status=open`,
`.priority<=1`, a bare word for text.

[packages/graph](packages/graph/README.md) is the model and its
[architecture](packages/graph/ARCHITECTURE.md);
[packages/README.md](packages/README.md) indexes every package.

## Plugins and roles

A config lists plugins. Each plugin is a package whose subpaths are its facets
(`/vocab`, `/rules`, `/tools`, `/effects`, `/service`, `/routes`, `/views`) and
never says where it runs. A process serves roles, and imports only the facets of
the roles it serves: a `yak` command opens the graph and runs one tool,
`yak serve` answers HTTP, effects are worked by a pool of processes, and each
plugin's service runs in one process at a time.
[packages/cli](packages/cli/README.md) says how.

## The repository

| path               | holds                                                             |
| ------------------ | ----------------------------------------------------------------- |
| `packages/`        | the `@yaks/*` packages, each with its own README                  |
| `packages/cli`     | `yak`, and `compose()`, which builds a process from a config      |
| `packages/web`     | the web canvas and the terminal UI                                |
| `apps/`            | the yaks apps this repository keeps, pushed with `yak admin push` |
| `workers/yak`      | yaks.app, the Cloudflare Worker that hosts yaks apps              |
| `plugins/yaks.app` | the yaks.app agent plugin: skills and assets                      |
| `extension/`       | the browser extension: file a task about a page                   |
| `bin/`             | install, backup, and the test runner                              |

## Develop

```sh
deno task install  # yak on PATH, running this checkout
deno task check    # fmt, lint, types, and the package checks
deno task test     # the tests
deno task tui      # the terminal UI
```

## License

The `@yaks/*` packages under `packages/`, the `yak` CLI, and everything else
here are Apache-2.0 (`LICENSE`), except `workers/yak`, the hosted yaks.app
platform, which is under the Functional Source License, FSL-1.1-ALv2
(`workers/yak/LICENSE.md`): each version becomes Apache-2.0 two years after its
release.

The names yaks.app and yak.sh and the yak logo are trademarks of Yak Shaving LLC
and are not licensed by either code license.
