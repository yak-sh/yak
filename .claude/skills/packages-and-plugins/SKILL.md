---
name: packages-and-plugins
description: >
  Use when adding/moving @yaks packages or plugins, changing exports or
  facets, wiring plugins, fixing import cycles, publishing to jsr or landing
  with --allow-revert. New package boundaries need design-docs; vocabulary
  is vocabulary; reading composed wiring is platform-visualize.
---

# Packages and plugins

The repo is one library cut into many `@yaks/*` packages under `packages/`, plus
`workers/yak` (the yaks.app platform) and `apps/`. Every package is also a
plugin: the parts a running graph needs are its subpath exports, called facets,
and a config decides which packages a process loads. Nothing else wires the
platform together. `yak` reads the config and composes what it lists; even
`yak serve` is a plugin's tool (@yaks/api). packages/README.md indexes the
packages, and packages/cli/README.md ("A plugin is a package, and each part of
it is a subpath export") is the reference for facets and `compose()`, which
lives in packages/cli/host.ts.

## Walls and furniture

Inside a package is furniture: mess there is cheap, and you can rearrange it any
time. Between packages are walls, and walls are expensive to move once people
live in them. The owner draws the walls. In his words (M-38025):

> i'm fine with some mess inside each package that i don't see, but it's harder
> to re-organize the packages later and agents tend to stuff things wherever,
> rather than designing clean modules

> It's the modules and their interfaces that need my attention.

The pull you'll feel is toward the nearest code. You're in workers/yak, the
helper you need would fit right there, and the local choice always looks fine.
Many such choices make the "stuffed wherever" shape: a helper living in the
platform, a second copy of an idea growing inside whichever package first wanted
it. Against that pull, every idea already has, or should have, one owner. So the
first move is to find the package that owns the idea and grow it. A new package
is a new wall, and a design says what it owns, what it offers and what it
depends on before it's built (`design-docs`).

A task's package list identifies its subject. Consumer, documentation and test
updates that the change requires belong to the same task wherever they live;
separate task-tree items still remain separate work.

What the walls are made of:

- **One home per idea.** A move deletes the old copy and moves every caller in
  the same change (M-17871). A domain component with two consumers gets a
  package of its own rather than a room inside one of them (M-39550).
- **The platform keeps its own screen and glue.** What workers/yak, the browser
  door (packages/web) or the browsing app (packages/browse) do that isn't theirs
  belongs in a package, open source like the rest (M-37867).
- **SQL is @yaks/sql's AST**, and only SQL-facing packages know SQLite exists
  (M-39498).
- **Parts are often already built.** packages/browse/components, with its
  styles.css and components/registry.ts, tends to have the thing you're about to
  write; port it and split it to fit (`ui-building`).
- **A cycle means something lives a floor too high.** When two packages need the
  same type or helper, it moves down into a package both already depend on.
  Restating it on one side to dodge the cycle is a second shape of one thing
  (T-58961 is one still open). `deno task check:publish` refuses a cycle.

## What a package is made of

packages/draft is a good small one to copy:

- **package.json**: `name`, the family's current `version`, `description`,
  `license`, `type: module`, `exports` and `dependencies`, the one manifest
  these are written in. pnpm installs the root workspace, and Deno and esbuild
  resolve the same package exports and dependencies. Add an import and its
  package dependency where it is used; the kernel needs no matching alias.
- **deno.json** keeps only `publish.exclude` and Deno compiler settings. It
  carries no `name` or `exports`: Deno would resolve through those too, so an
  export missing from package.json would pass locally and fail the Workers
  Build. `deno task publish` writes them in from package.json for its run.
- **Workspace membership** comes from its place: `packages/*` in the root
  package.json's `workspaces` and pnpm-workspace.yaml takes in every directory
  there with a package.json. Run `pnpm install` after adding one, and commit
  pnpm-lock.yaml.
- **README.md**, written the way `writing-documentation` describes.
- **vocab.json and vocab.ts** if it declares words (`vocabulary`).
- **browser.json** if a page imports it. `deno task check:browser`
  (bin/check-platform.ts) type-checks its browser-facing exports, and always its
  `./vocab` and `./views`, with only the web platform in scope.
- **Its line in packages/README.md's index.**

## Facets: where things run

The owner, verbatim (M-39540): "facets are about where things run, not when."
And: "each user can decide which part runs where without the plugins being
descriptive." So a plugin offers parts and never says where they go. A process
serves roles and imports only those roles' facets (`ROLES` in
packages/cli/host.ts):

- `graph` takes `./vocab`, `./graph` and `./tools`, though a plugin's tool code
  is imported only by the first call of one of its tools;
- `web` takes `./routes` and `./ui` (kits, UX specimens, themes and skins:
  @yaks/ui's `Contributions`);
- `effects` takes `./effects`;
- a package with `./service` brings a role of its own, named by the package.

Outside `compose`, `./cli` adds `yak` commands, `./views` draws entities in the
web UI and in `yak`'s answers, `./tui` draws them in the terminal, and `./web`
is an application's page (entry, mounting module, stylesheet) that @yaks/web,
the browser door, finds in the config and serves; @yaks/browse has one. `./mail`
is the same move for @yaks/mail: what a package makes of a letter that arrived
(`reading(options)`), asked at mail's door; @yaks/inbox has one. `./graph`'s
`plugins(host, options)` returns graph plugins, and packages/cli/README.md's
table has every facet's other exports.

A passing `yak` command serves `graph` alone, so it never pays for routes. The
other side of importing by role: an exported facet that fails to import fails
composition for every process that loads it, so a bad `./graph` breaks every
`yak` command at once. An unexported facet is simply skipped. `./vocab`,
`./views` and `./ui` run in browsers, so SQL, storage drivers and server APIs
stay out of them and out of everything they import. Start-up work is an effect
declared `start: true`, owed by a process that works the effects pool and not by
a command passing through; there is no `./boot`.

To see what a running process composed, which facets are declared, loaded and
bound, read its anatomy: `visualize_anatomy` with group facets
(`platform-visualize`).

## Turning a plugin on

`~/.yak/yak.json` is the box's spine, and the box serves other configs beside it
(`~/.yak/tracker.json` is the tracker's). A plugin runs in a config once its
`plugins` list names it, as `"@yaks/x"` or `{"use": "@yaks/x", "with": {…}}`,
and the server restarts. Its tables need no step: the first process that opens
the graph to write with the plugin in its config adds them
(packages/cli/README.md, "The schema follows the vocabulary"). Every `yak`
command composes from yak.json, so an entry that fails to compose takes all of
them down together, and that has happened. Treat the edit like work on a running
patient: prove it composes first, with no server, by copying the edited file
beside a scratch graph (`yak init --config <dir>/yak.json` makes one; keep
its `"db"`) and running any command over it, `yak --config

<dir>/yak.json graph schema`. Keep a copy of the old file and a `.backup` of
its db, then edit it and run `yak restart`, the agent restart door. The file
is plain JSON on disk, so a
key in `with` is `{"secret": "NAME"}` and the value lives in the vault
(`secrets-and-connections`).

Which plugins the box loads is the owner's choice, and one the list leaves out
is left out on purpose. A plugin can add work to every page and every commit:
@yaks/inbox's summary is read again after nearly every commit, at about two
seconds on the web's one read thread, so with it loaded every page on
tasks.yak.sh waits behind it. When a command or a check you were asked to run
fails because its plugin isn't loaded (`yak inbox list` answers "has nothing
called inbox"), that is the answer to report. Adding the plugin to make it pass
changes what every process on the box pays, and that is the owner's call.

## Publishing

A release publishes what changed, so a fix in one package ships at once.
bin/release.ts publishes the packages whose published files moved since their
version's tag, every published package that imports one of them, and a package
JSR doesn't have yet only once something it publishes imports it. Those move to
the release's version. The rest keep the version JSR already has, and a
sibling's import (`jsr:@yaks/x@^<version>`) resolves either way.
packages/cli/release.json pins every package of the release at its version, and
an installed CLI loads a plugin a config names at that pin.

```sh
bin/release.ts plan      # what a release would publish today, and how many JSR then holds
bin/release.ts 0.2.18    # write the versions, commit and tag; pushing the tag publishes
```

JSR's scope holds at most 100 packages, and a version can't be unpublished. CI
publishes under GitHub's identity (.github/workflows/publish.yml), which JSR
accepts only for a package that already has a page, so bin/release.ts refuses
while a package it would publish has none. A provider a person may not use is a
plugin their config names, not an import of a published package: an import puts
it in every release that publishes the importer. bin/jsr.ts writes the pages
from the repo, and mints only the pages it is given:

```sh
deno task jsr                              # dry run: what would change on every page
deno task jsr --apply --create @yaks/new   # write them, and mint the pages named
```

Writing needs a `JSR_TOKEN`, so it's often the owner's to run.

## Landing over someone's newer change

`yak land` refuses when a file would end up with content no commit on your
branch wrote. That almost always means your branch would quietly undo someone
else's newer change to it. `--allow-revert <paths>` (comma-separated) lets it
through, so first look at who touched the file after you branched:

```sh
git log --oneline $(git merge-base HEAD main)..main -- <path>
```

A commit there is someone's work: read it, and rebase your change onto it. The
override is for undoing your own earlier work or a change you were asked to
undo, and the commit message says which.

A change here feels finished when each moved idea has one home, its affected
tests pass in seconds, and the package's README and packages/README.md describe
it as it is. Land with `yak land`; main's CI checks cycles, slow types and web
export leaks after the push and files a bug when it fails. Nobody waits on it.

When this skill is wrong or missing something, fix it in the same change.
