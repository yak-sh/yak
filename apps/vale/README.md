# Vale

Vale's chat slash commands use the shared browser-safe `@yaks/cli/grammar` for
parsing (`argsFor`) and completion (`complete`). Command arguments accept both
`--name=value` and `--name value`. `slash.ts` adapts the command listing into
grammar descriptors, `slash-completion.ts` supplies chat replacement ranges, and
`command-lookup.ts` supplies entity lookup. The completion UI uses
`@yaks/ux/completion`, the same behavior reused by filter fields, with drafts
kept by the host.

## Deployment

Vale ships source files and `package.json`; it has no local build or generated
runtime files to stage. The platform compiler compiles `main.ts` and its module
worker at deploy. Toolkit dependencies marked `platform` come from the current
source packages shipped with that compiler, not an older registry release.
Preact, signals, Three.js and marked are ordinary npm dependencies.

The grammar, completion, drafts, network client, Markdown and voice packages
join the same compiled page runtime. The creature-build subscription uses server
evaluation: `built.current` is computed by the store, and the page has neither
the complete build graph nor a local rule for it.

`ui/Choices.css` is a tracked port of the shared UI part's stylesheet. It is
loaded by `ui/components.css`; deployment does not copy or generate CSS.

Deploy only from the main checkout after the release's commits have landed:

```sh
yak admin push apps/vale --space=yourname --app=vale --owner
yak admin tool app_errors space=yourname app=vale --owner
```

Check `app_errors` immediately after every deploy and fix new errors before
continuing. A feature worktree is not a release source: deploying its snapshot
can undo another landed change.
