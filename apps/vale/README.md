# Vale

## Where state lives

Mossvale exists to exercise yaks.app and the @yaks packages (M-41238). Its state
lives in the page's graph, the @yaks/client graph `net.ts` keeps, and nowhere
beside it:

- What the store holds is read from that graph, never copied into a module's own
  array or Map.
- The page's own state (selection, open panels, what was generated for the page)
  is page-only entities in the same graph (`sync: none`), the way @yaks/ux keeps
  a component's state (M-39550).
- What a person sets or types (settings, drafts) is theirs, kept in the store
  and synced to every device they play on (M-59093); never `localStorage`.
- What a person sees is @yaks/ui parts in Preact, never `innerHTML`.

Moving code's state in means modelling it fresh, not copying its shape: the
vocabulary skill's "Moving state that code keeps into the graph" says how.

When the graph or a package cannot do what the game needs (large binary values,
a worker sharing the page's graph, a write that must be fast), that is platform
work: file it and fix it in the package that owns it, never around it in
apps/vale. Code that predates this is being moved (the tasks under "Mossvale's
state lives in the page's graph").

Hero positions relay between connected pages, and the server saves their latest
value every thirty seconds. A returning hero resumes that position facing the
default direction. Wildlife positions only relay. Teleport requests carry a
`completed` mark once the addressed hero moves. Villagers follow their daily rhythm derived in each page. Human dialogue asks
a model; playing nearby creates no autonomous model turn or world clock.

Vale's chat slash commands use the shared browser-safe `@yaks/cli/grammar` for
parsing (`argsFor`) and completion (`complete`). Command arguments accept both
`--name=value` and `--name value`. Commands declare `positional` beside `input`;
a final `...` suffix takes the remaining words, and `short` on an input property
declares its single-letter flag. `/spawn a large polar bear --at mossvale` fills
`beast` with the description and `at` with the land. `slash.ts` adapts the
command listing into grammar descriptors, `slash-completion.ts` supplies chat
replacement ranges, and `command-lookup.ts` supplies entity lookup. The
completion UI uses `@yaks/ux/completion`, the same behavior reused by filter
fields, with drafts kept by the host.

## Deployment

Vale ships source files and `package.json`; the map has no shipped images. The
platform compiler compiles `main.ts` and its module worker at deploy. Toolkit
dependencies marked `platform` come from the current source packages shipped
with that compiler, not an older registry release. Preact, signals, Three.js and
marked are ordinary npm dependencies.

The grammar, completion, drafts, network client, Markdown and voice packages
join the same compiled page runtime. The creature-build subscription uses server
evaluation: `built.current` is computed by the store, and the page has neither
the complete build graph nor a local rule for it.

`ui/Choices.css` is a tracked port of the shared UI part's stylesheet. It is
loaded by `ui/components.css`; deployment does not copy or generate CSS.

Map ground is charted once per 16-metre chunk at one pixel per metre, from
patches already grown for play. The page keeps these charts even after the
terrain cache evicts their patches. Only explored chunks missing from this
session are grown and charted in the world worker when the map shows them.
Panning and zooming scale the same canvases; players, nodes, quests and opaque
fog remain overlays. Design changes retire the page's charts. The map keeps
nothing on the server or in device storage.

```sh
deno run -A bin/vale-map-time.ts --before=<baseline-sha>
```

The timing command uses a native headless canvas, reporting first paint, pan and
zoom, and chart calls and milliseconds per pan. It measures both ground already
grown for play and the reload case, and removes its baseline checkout.

Deploy only from the main checkout after the release's commits have landed:

```sh
yak admin push apps/vale --space=yourname --app=vale --owner
yak admin tool app_errors --space yourname --app vale --owner
```

Check `app_errors` immediately after every deploy and fix new errors before
continuing. A feature worktree is not a release source: deploying its snapshot
can undo another landed change.

Ability seed changes do not rewrite existing Store rows. For this effect-set
update, generate guarded patches against the previous shipped seed, preserving
any property the person changed. Run from main after deploying the new schema:

```sh
mkdir -p /tmp/vale-ability-update
yak admin query yourname/vale '.ability_design' --admin --json > /tmp/vale-ability-update/live.json
git show ff0fc0c44:apps/vale/seed/abilities/abilities.json > /tmp/vale-ability-update/before.json
deno run --allow-read --allow-write bin/vale-ability-update.ts /tmp/vale-ability-update/live.json /tmp/vale-ability-update/before.json /tmp/vale-ability-update/update.json
yak admin apply yourname/vale @/tmp/vale-ability-update/update.json --admin --check
yak admin apply yourname/vale @/tmp/vale-ability-update/update.json --admin
```

Then reread the rows and generate legacy scalar cleanup separately; `effects` is
guarded and never changed by cleanup. A row without effects is untouched. The
Store retains removed scalar properties until their stored values are cleared,
so the cleanup is admitted by its retained schema. The next deploy drops those
empty properties.

```sh
yak admin query yourname/vale '.ability_design' --admin --json > /tmp/vale-ability-update/live.json
deno run --allow-read --allow-write bin/vale-ability-update.ts /tmp/vale-ability-update/live.json /tmp/vale-ability-update/before.json /tmp/vale-ability-update/clean.json clean
yak admin apply yourname/vale @/tmp/vale-ability-update/clean.json --admin --check
yak admin apply yourname/vale @/tmp/vale-ability-update/clean.json --admin
rm -rf /tmp/vale-ability-update
```

### Persisted fight declaration cutover

`fight.dealt` is an array. A store retaining its JSON-text declaration cannot
accept that declaration while any persisted `fight.dealt` value remains.
`bin/vale-fight-update.ts` generates guarded patches for an operator to move
those values. It does not contact a store. Malformed JSON or a value other than
a dealings array refuses the entire plan, without offering any clears. Extra
object fields and numerical values survive parsing; the original export keeps
the exact text. No entity, component, or person input is deleted.

The operator must keep all Vale pages and command writers stopped during the
cutover. Do not begin while someone is playing. Keep the original export outside
`/tmp` until verification is complete. These commands are **operator-only**;
agents rehearse them against synthetic rows, never against the live store. From
the main checkout containing the desired release:

```sh
D="$HOME/vale-fight-cutover"
mkdir -p "$D"
yak admin query yourname/vale '.fight&?doc&?person' --admin --json > "$D/original.json"
deno run --allow-read --allow-write bin/vale-fight-update.ts clear "$D/original.json" "$D/clear.json"
yak admin apply yourname/vale @"$D/clear.json" --admin --check
# Inspect the plan/count; every patch clears only fight.dealt, never fight itself.
yak admin apply yourname/vale @"$D/clear.json" --admin
# Release the intended files and array declaration from main.
yak admin push apps/vale --space=yourname --app=vale --owner
yak admin query yourname/vale '.fight&?doc&?person' --admin --json > "$D/after-deploy.json"
deno run --allow-read --allow-write bin/vale-fight-update.ts restore "$D/original.json" "$D/restore.json" "$D/after-deploy.json"
yak admin apply yourname/vale @"$D/restore.json" --admin --check
yak admin apply yourname/vale @"$D/restore.json" --admin
yak admin query yourname/vale '.fight&?doc&?person' --admin --json > "$D/after-restore.json"
deno run --allow-read --allow-write bin/vale-fight-update.ts restore "$D/original.json" "$D/verify.json" "$D/after-restore.json"
# Expected: zero restore patches. Compare row counts and person prose with original.json.
yak admin tool app_errors --space yourname --app vale --owner
```

A changed or disappeared fight refuses restoration instead of overwriting or
resurrecting it. Stop and inspect such a conflict; do not weaken its guards. If
deployment refuses, the serving declaration remains text. While writers are
still stopped, regenerate `restore-text` against a fresh read and apply its
checked patches to put the exact original strings back:

```sh
yak admin query yourname/vale '.fight&?doc&?person' --admin --json > "$D/failed-deploy.json"
deno run --allow-read --allow-write bin/vale-fight-update.ts restore-text "$D/original.json" "$D/recover.json" "$D/failed-deploy.json"
yak admin apply yourname/vale @"$D/recover.json" --admin --check
yak admin apply yourname/vale @"$D/recover.json" --admin
```

Use `restore-text` only while the served declaration is still text; an accepted
array release uses `restore`. Do not resume writers until restored values and
person input have been verified. The local workerd rehearsal is
`workers/yak/fight_update_workerd_test.ts`: it retains two legacy rows, proves
the array deployment refusal, checks both dry runs roll back, moves and restores
the values, and verifies a second restoration produces no patches.
