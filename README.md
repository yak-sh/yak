# yaks

One graph, worked by people and agents through the same doors.

This repository is the yaks toolkit: the `@yaks/*` packages, the `yak` command
that composes them over one SQLite file, the web canvas and terminal UI, and
yaks.app, the Cloudflare Worker that hosts yaks apps. Tasks, projects, agent
sessions, memories and the UI's own state are entities in one graph; every
change is a batch of entity patches, and every list is a query.

## Start

There are two ways to run `yak`; pick one.

- **Install the published `yak` from jsr.io**: no clone, no build. Below.
- **Develop from a clone**: run this repository's own code, the way its
  maintainers do. See [Develop](#develop).

`yak` runs on [Deno](https://deno.com) 2.9 or later. To see what Claude Code and
Codex have cost you, [docs/SPEND.md](docs/SPEND.md) is the short version.

```sh
deno run -A jsr:@yaks/cli/install
# to update, or take a release from today: deno run -A --minimum-dependency-age=0 --reload=jsr:@yaks/cli jsr:@yaks/cli/install
yak init            # writes ~/.yak/yak.json and starts your graph; --force rewrites it for this release
yak task new 'Add the sign-up page'
yak task list
yak serve           # the canvas, /mcp and /query on http://127.0.0.1:8787
yak hooks install   # Claude Code sessions join the graph
yak auth yaks.app   # sign in to yaks.app, to reach your apps from here
yak help            # every command
```

The installer puts `yak` on your PATH at its own release, so the command and
every package a config names are one set. Deno refuses any package published
less than a day ago (its minimum dependency age), so the installer takes the
newest release at least a day old. To update, or if Deno says a version "was
newer than the specified minimum dependency date", run the command commented
below it: `--minimum-dependency-age=0` takes a release published today, and
`--reload=jsr:@yaks/cli` asks jsr.io again instead of reusing the release Deno
found last. They are Deno's flags, so they go before the package.

`yak init` writes the config (`db`, the plugins, and who you are) and never
replaces one. `yak init --force` rewrites it for the release you are running,
keeping your graph and your person, and saves the old file beside it. It asks
for no name: it takes git's `user.name`, or else your login, and the graph's
first task, filed to you, is for an agent to ask you whether that is right.
`yak name` renames you. `yak serve` listens on this machine alone, on port 8787
unless the config sets `port`; a config's `hostname` offers it to a network, and
it has no authentication of its own.

Agents join the same graph:

- **Claude Code**: `yak hooks install` writes lifecycle hooks into
  `~/.claude/settings.json`, posting to the `yak serve` of your config. Each
  session becomes a session entity, is told its claims when it starts, and
  releases them when it ends. Its answer names the next steps, among them
  `claude mcp add --scope user --transport http yak http://127.0.0.1:8787/mcp`.
- **Any MCP client**: `http://127.0.0.1:8787/mcp` serves the graph's tools.

`yak auth yaks.app` signs in to yaks.app; the sign-in is a connection in your
graph, which `yak init` composes with @yaks/connections.

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
(`/vocab`, `/graph`, `/tools`, `/effects`, `/service`, `/routes`, `/views`) and
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
| `bin/`             | install, backup, and the test runner                              |

## Develop

A clone runs its own code: every `@yaks/*` package comes from the checkout, and
`deno.lock` and `pnpm-lock.yaml` pin everything else, so nothing is fetched from
jsr.io and the minimum dependency age never applies. You need:

- [Deno](https://deno.com) 2.9 or later
- [pnpm](https://pnpm.io/installation) 12 (`package.json` names 12.16.1)
- git, and a C compiler with `make`: the install builds the SQLite every `yak`
  process opens, once, into `~/.cache/yak` (about a minute)

```sh
git clone https://github.com/yak-sh/yak.git && cd yak
pnpm install       # node_modules, from pnpm-lock.yaml
deno task install  # `yak` on PATH (~/.deno/bin), running this checkout
yak init           # then yak serve, as in Start
deno task test     # the tests this branch's changes reach, against main
deno task check    # fmt, lint, types, and the package checks
```

`deno task install` writes `~/.deno/bin/yak`, a shim that runs
`deno run -A --unstable-no-legacy-abort --config deno.json packages/cli/yak.ts`
in this checkout, so every edit runs at once and nothing needs reinstalling.
`deno run -A packages/cli/yak.ts serve` from the checkout does the same without
the shim. Installing from jsr.io writes the same `~/.deno/bin/yak`, so the last
install wins: a "newer than the specified minimum dependency date" error means
the published `yak` is the one running, and `deno task install` in the checkout
puts the checkout's back.

## License

The `@yaks/*` packages under `packages/`, the `yak` CLI, and everything else
here are Apache-2.0 (`LICENSE`), except `workers/yak`, the hosted yaks.app
platform, which is under the Functional Source License, FSL-1.1-ALv2
(`workers/yak/LICENSE.md`): each version becomes Apache-2.0 two years after its
release.

The names yaks.app and yak.sh and the yak logo are trademarks of Yak Shaving LLC
and are not licensed by either code license.
