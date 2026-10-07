---
name: packages-and-plugins
description: >
  How an @yaks package or plugin is made, wired and published in ~/code/tasks,
  and where code belongs. Use it whenever you add a package or plugin, move code
  between packages (or out of workers/yak, packages/web or packages/browse),
  change a subpath export or facet (./vocab, ./graph, ./tools, ./effects,
  ./routes, ./ui, ./service, ./cli, ./views, ./tui, ./web), add a plugin to
  ~/.yak/yak.json, hit an import cycle, publish to jsr, or land with `yak land
  --allow-revert`, even if the task says "put this somewhere", "share this
  helper" or "make it reusable". Reading composed anatomy and causal activity
  is `platform-visualize`, not wiring. Declared words are `vocabulary`; effects
  and rules are `effects-and-rules`; drawn views are `ui-building`; keys a
  plugin reads are `secrets-and-connections`; how its README is written is
  `writing-documentation`. A new package or an owner-decided boundary gets a
  design first (`design-docs`).
---

# Packages and plugins

The repo is one library cut into many `@yaks/*` packages under `packages/`,
plus `workers/yak` (the yaks.app platform) and `apps/`. Every package is also a
plugin: the parts a running graph needs are its subpath exports, called facets,
and a config decides which packages a process loads. Nothing else wires the
platform together. `yak` reads the config and composes what it lists; even
`yak serve` is a plugin's tool (@yaks/api). packages/README.md indexes the
packages, and packages/cli/README.md ("A plugin is a package, and each part of
it is a subpath export") is the reference for facets and `compose()`, which
lives in packages/cli/host.ts.

## Walls and furniture

Inside a package is furniture: mess there is cheap, and you can rearrange it
any time. Between packages are walls, and walls are expensive to move once
people live in them. The owner draws the walls. In his words (M-38025):

> i'm fine with some mess inside each package that i don't see, but it's harder
> to re-organize the packages later and agents tend to stuff things wherever,
> rather than designing clean modules

> It's the modules and their interfaces that need my attention.

The pull you'll feel is toward the nearest code. You're in workers/yak, the
helper you need would fit right there, and the local choice always looks fine.
Many such choices make the "stuffed wherever" shape: a helper living in the
platform, a second copy of an idea growing inside whichever package first
wanted it. Against that pull, every idea already has, or should have, one
owner. So the first move is to find the package that owns the idea and grow it.
A new package is a new wall, and a design says what it owns, what it offers and
what it depends on before it's built (`design-docs`).

What the walls are made of:

- **One home per idea.** A move deletes the old copy and moves every caller in
  the same change (M-17871). A domain component with two consumers gets a
  package of its own rather than a room inside one of them (M-39550).
- **The platform keeps its own screen and glue.** What workers/yak, the browser
  door (packages/web) or the browsing app (packages/browse) do that isn't
  theirs belongs in a package, open source like the rest (M-37867).
- **SQL is @yaks/sql's AST**, and only SQL-facing packages know SQLite exists
  (M-39498).
- **Parts are often already built.** packages/browse/components, with its
  styles.css and components/registry.ts, tends to have the thing you're about
  to write; port it and split it to fit (`ui-building`).
- **A cycle means something lives a floor too high.** When two packages need
  the same type or helper, it moves down into a package both already depend on.
  Restating it on one side to dodge the cycle is a second shape of one thing
  (T-58961 is one still open). `deno task check:publish` refuses a cycle.

## What a package is made of

packages/draft is a good small one to copy:

- **deno.json**: `name`, the family's current `version` (every package moves
  together; bin/release.ts), `exports`, `license`, `description` and `publish`
  excludes. The description is the one place a package says what it is: its
  `./vocab` facet re-exports it (packages/draft/vocab.ts), the graph's package
  rows read it, and `deno task jsr` puts it on jsr.io. Its `imports` name
  outside dependencies only; workspace packages resolve through the workspace.
- **The workspace list** in the root deno.json, which names the package.
- **README.md**, written the way `writing-documentation` describes.
- **vocab.json and vocab.ts** if it declares words (`vocabulary`).
- **browser.json** if a page imports it. `deno task check:browser`
  (bin/check-platform.ts) type-checks its browser-facing exports, and always
  its `./vocab` and `./views`, with only the web platform in scope.
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
the browser door, finds in the config and serves; @yaks/browse has one.
`./graph`'s `plugins(host, options)` returns graph plugins, and
packages/cli/README.md's table has every facet's other exports.

A passing `yak` command serves `graph` alone, so it never pays for routes. The
other side of importing by role: an exported facet that fails to import fails
composition for every process that loads it, so a bad `./graph` breaks every
`yak` command at once. An unexported facet is simply skipped. `./vocab`,
`./views` and `./ui` run in browsers, so SQL, storage drivers and server APIs
stay out of them and out of everything they import. Start-up work is an effect
declared `start: true`, owed by a process that works the effects pool and not
by a command passing through; there is no `./boot`.

To see what a running process composed, which facets are declared, loaded and
bound, read its anatomy: `yak visualize anatomy --group facets`
(`platform-visualize`).

## Turning a plugin on

`~/.yak/yak.json` is the box's spine, and the box serves other configs beside
it (`~/.yak/tracker.json` is the tracker's). A plugin runs in a config once its
`plugins` list names it, as `"@yaks/x"` or `{"use": "@yaks/x", "with": {…}}`,
its components have tables, and the server restarts. Today only the graph
installer, `yak upgrade --config <file>` (packages/cli/README.md, "graph
installer"), creates those tables; until it runs, every query naming the new
plugin's components fails with "no such table". That is a gap, not a design:
T-115787 makes the schema follow the vocabulary wherever a graph is opened for
writing. Every `yak`
command composes from yak.json, so an entry that fails to compose takes all of
them down together, and that has happened. Treat the edit like work on a
running patient: prove the config on a scratch server first
(`end-to-end-checks`), keep a copy of the old file and a `.backup` of its db,
then edit it, run `yak upgrade --config <file>`, and run `yak restart`, the
agent restart door. The file is plain JSON on disk, so a
key in `with` is `{"secret": "NAME"}` and the value lives in the vault
(`secrets-and-connections`).

## Publishing

The family is one release. bin/release.ts writes one version into every
package, commits and tags; pushing the tag publishes
(.github/workflows/publish.yml). CI publishes under GitHub's identity, which
jsr accepts only for a package that already has a page, so a new package needs
its page first or the publish stops partway, and a version can't be
unpublished. bin/release.ts refuses to cut a release while one is missing.
bin/jsr.ts writes the pages from the repo:

```sh
deno task jsr                    # dry run: what would change on every page
deno task jsr --apply --create   # write them, and mint pages for new packages
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

A change here feels finished when each moved idea has one home and nothing
reaches the old one, `deno task check` is green (it runs format, lint, bytes,
types, publish, browser, workers and content, so cycles and browser leaks show
up there), and the package's README and packages/README.md describe it as it
is.

When this skill is wrong or missing something, fix it in the same change.
