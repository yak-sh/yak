# Vale

Vale's chat slash commands use the shared browser-safe `@yaks/cli/grammar` for
parsing (`argsFor`) and completion (`complete`). Command arguments accept both
`--name=value` and `--name value`. `slash.ts` adapts the command listing into
grammar descriptors, `slash-completion.ts` supplies chat replacement ranges, and
`command-lookup.ts` supplies entity lookup. The completion UI uses
`@yaks/ux/completion`, the same behavior reused by filter fields, with drafts
kept by the host.

## Deployment

Vale ships source files, `package.json`, and the map's PNG tiles under `tiles/`.
The platform compiler compiles `main.ts` and its module worker at deploy.
Toolkit dependencies marked `platform` come from the current source packages
shipped with that compiler, not an older registry release. Preact, signals,
Three.js and marked are ordinary npm dependencies.

The grammar, completion, drafts, network client, Markdown and voice packages
join the same compiled page runtime. The creature-build subscription uses server
evaluation: `built.current` is computed by the store, and the page has neither
the complete build graph nor a local rule for it.

`ui/Choices.css` is a tracked port of the shared UI part's stylesheet. It is
loaded by `ui/components.css`; deployment does not copy or generate CSS.

Map ground is painted once per 256-metre cell, then averaged into four image
sizes. The shipped atlas covers the authored world, including its frontier
holes. Its content address includes the theme and building designs: changed
store designs and further frontier cells are charted once per page and kept.
Panning and zooming composite these images; players, nodes, quests and fog
remain overlays. Regenerate tracked images after changing terrain or seed
designs, before landing and deploying:

```sh
deno run -A bin/vale-chart.ts
deno run -A bin/vale-map-time.ts --before=<baseline-sha>
```

The timing command uses a native headless canvas, reporting detailed first
paint, pan and zoom time, and chart calls and milliseconds per pan. It creates
no probe files.

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

Then reread the rows and generate legacy scalar cleanup separately; `effects`
is guarded and never changed by cleanup. A row without effects is untouched.
The Store retains removed scalar properties until their stored values are
cleared, so the cleanup is admitted by its retained schema. The next deploy
drops those empty properties.

```sh
yak admin query yourname/vale '.ability_design' --admin --json > /tmp/vale-ability-update/live.json
deno run --allow-read --allow-write bin/vale-ability-update.ts /tmp/vale-ability-update/live.json /tmp/vale-ability-update/before.json /tmp/vale-ability-update/clean.json clean
yak admin apply yourname/vale @/tmp/vale-ability-update/clean.json --admin --check
yak admin apply yourname/vale @/tmp/vale-ability-update/clean.json --admin
rm -rf /tmp/vale-ability-update
```
