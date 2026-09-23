# yaks

The `@yaks/*` packages, the `yak` CLI, and yaks.app, the hosted platform built
from them.

An **entity** is a record identified by `entity.eid`. Its **components** are
named objects describing different aspects of it, and a **bundle** is one
entity's components as a JSON object. A write is a batch of bundles applied in
one transaction; each component in a bundle is a patch. A graph is a store of
entities plus the vocabulary that says which components it accepts.
[packages/README.md](packages/README.md) starts from there.

## What is here

- `packages/` — the `@yaks/*` packages: graph, vocabulary, storage, query, sync,
  rendering, and the plugins (tasks, sessions, mail, pages, memory, …) a graph
  is composed from. [packages/README.md](packages/README.md) lists them.
- `packages/cli` — `yak`, the command line. Every tool a graph declares is a
  subcommand, and `yak serve` hosts a graph composed from the plugins a config
  names ([packages/cli/README.md](packages/cli/README.md)).
- `workers/yak` — yaks.app, the Cloudflare Worker that hosts yaks apps
  ([workers/yak/README.md](workers/yak/README.md)).
- `plugins/yaks.app` — the skills and assets an assistant installs for yaks.app.
- `extension/` — the browser extension that files a page into a graph.
- `bin/` — the repository's own scripts: the test runner, backups, deploy gates.

## Run

```sh
deno task install       # a global `yak` on PATH
deno task dev           # yak serve with ~/.yak/yak.json
deno task dev:yak       # the yaks.app Worker under wrangler dev
deno task check         # fmt, lint, typecheck, and the package checks
deno task test          # the fast tier
deno task test:workerd  # the Worker under workerd
```

## License

The `@yaks/*` packages under `packages/`, the `yak` CLI, and everything else
here are Apache-2.0 (`LICENSE`), except `workers/yak`, the hosted yaks.app
platform, which is under the Functional Source License, FSL-1.1-ALv2
(`workers/yak/LICENSE.md`): each version becomes Apache-2.0 two years after its
release.

The names yaks.app and yak.sh and the yak logo are trademarks of Yak Shaving LLC
and are not licensed by either code license.
