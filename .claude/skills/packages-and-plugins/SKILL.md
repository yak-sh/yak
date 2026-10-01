---
name: packages-and-plugins
description: >
  How an @yaks package or plugin is made, wired and published in ~/code/tasks,
  and where code belongs. Use it whenever you add a package or plugin, move code
  from one package to another (or out of workers/yak or packages/web), add or
  change a subpath export or facet (./vocab, ./rules, ./tools, ./effects,
  ./routes, ./service, ./cli, ./views, ./tui), add a plugin to ~/.yak/yak.json,
  hit an import cycle between packages, publish to jsr, or land with
  `yak land --allow-revert`, even if the task only says "put this somewhere",
  "share this helper" or "make it reusable". Not for the words a package
  declares (`vocabulary`), what its effects and rules do (`effects-and-rules`)
  or what its views draw (`ui-building`); a new package or a boundary Jeff
  should decide gets a design first (`design-docs`).
---

# Packages and plugins

The repo is one library cut into many `@yaks/*` packages under `packages/`,
plus `workers/yak` (the yaks.app platform) and `apps/`. A package is also a
plugin: the parts a running graph needs are its subpath exports, and a config
decides which packages a process loads. packages/README.md indexes them;
packages/cli/README.md ("A plugin is a package, and each part of it is a subpath
export") is the reference for facets and `compose()`.

## Where code belongs

Package boundaries are the decision Jeff makes; inside one, mess is cheap to fix
later (M-38025). Left alone you put new code next to the nearest code that
needed it, and a helper lands in workers/yak or a second copy of an idea grows
inside the package that first wanted it.

- **Existing package first.** Find the package that owns the idea and grow it.
  Name a new package only where none does, and say in the design what it owns,
  what it offers, and what it depends on.
- **One home per idea.** Moving code is a move: the old copy is deleted and
  every caller moves in the same change (M-17871). A domain component with two
  consumers gets a package of its own, not a home inside one of them (M-39550).
- **The platform keeps its UI and wiring.** What workers/yak or packages/web do
  that isn't their own screen or glue belongs in a package (M-37867). SQL is
  @yaks/sql's AST, and only SQL-facing packages know SQLite exists (M-39498).
- **Before building a part, look for it.** packages/web often has it already;
  port it and split it to fit (the `ui-building` skill).
- **No cycles.** When two packages need the same type or helper, it moves down
  into a package both already depend on. Restating it on one side to dodge the
  cycle is a second shape (T-58961 is one such case). `deno task check:publish`
  refuses a cycle.

## What a package is made of

Copy the shape of a small one, such as packages/draft:

- **deno.json**: `name`, the family's current `version` (every package moves
  together; bin/release.ts), `exports`, `license`, `description` and `publish`
  excludes. The description is the one place a package says what it is: its
  `./vocab` facet re-exports it (packages/draft/vocab.ts), the graph's package
  rows read it, and `deno task jsr` puts it on jsr.io. Imports name outside
  dependencies only, never another workspace package.
- **The workspace list** in the root deno.json names the package.
- **README.md**: what it is, its exports, how to use it, its limits. Its
  examples run as tests.
- **vocab.json and vocab.ts** if it declares words (the `vocabulary` skill).
- **browser.json** if a page imports it: `deno task check:browser` type-checks
  its browser-facing exports, and always its `./vocab` and `./views`, with only
  the web platform in scope (bin/check-platform.ts).
- **An entry in packages/README.md's index.**

## Facets: what a plugin contributes

A facet is one optional subpath, and a plugin never says where it runs
(M-39540). A process serves roles and imports only those roles' facets
(`ROLES` in packages/cli/host.ts): `graph` takes `./vocab`, `./rules`,
`./tools`; `web` takes `./routes`; `effects` takes `./effects`; a package with
`./service` brings a role of its own. `./cli` adds terminal commands, `./views`
and `./tui` draw entities. The README's table lists what each subpath exports.

Consequences worth knowing:
- An exported facet that fails to import fails composition for every process
  that loads it, so a bad `./rules` breaks every `yak` command. An unexported
  facet is simply skipped.
- `./vocab` and `./views` run in browsers: no SQL, storage drivers or server
  APIs in them or in anything they import.
- Start-up work is an effect declared `start: true`, owed only by a process
  that works the effects pool, never by a CLI command passing through.

## Turning a plugin on

A plugin runs on the box only once `~/.yak/yak.json` lists it in `plugins`,
either as a name or as `{"use": "@yaks/x", "with": {…}}`, and the server is
restarted. Adding one has broken every `yak` command before, so prove the config
on a scratch server first (the `end-to-end-checks` skill), back up yak.json,
then edit it and `systemctl --user restart yak`.

## Publishing

- A new package has no page on jsr.io, and CI's publish refuses it until one
  exists: `deno task jsr` shows what would change, and
  `deno task jsr --apply --create` creates missing pages (it needs a JSR token,
  so this is often Jeff's to run). bin/release.ts refuses to cut a release
  while a package has no page.
- Releases are one version for the whole family: bin/release.ts writes it,
  commits and tags; pushing the tag publishes.

## Landing: `yak land` and `--allow-revert`

`yak land` refuses when a file would end up with content that no commit on your
branch wrote, which almost always means your branch would undo someone else's
newer change to that file. `--allow-revert <paths>` overrides that, so check
before you use it:

```sh
git log --oneline $(git merge-base HEAD main)..main -- <path>
```

Any commit listed changed the file after you branched; read it and rebase your
change onto it rather than reverting it. Allow the revert only when the content
you are undoing is your own earlier work or a change you were asked to undo, and
say so in the commit message.

## Before you land

- Each moved thing has one home; the old copy is gone and no caller reaches it.
- `deno task check` passes (format, lint, types, publish, browser, workers).
- The package's README and packages/README.md describe it as it is now.

When this skill is wrong or missing something, fix it in the same change.
