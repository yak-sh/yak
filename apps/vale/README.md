# Vale

Vale's chat slash commands use the shared browser-safe `@yaks/cli/grammar` for
parsing (`argsFor`) and completion (`complete`). Command arguments accept both
`--name=value` and `--name value`. `slash.ts` adapts the command listing into
grammar descriptors, `slash-completion.ts` supplies chat replacement ranges, and
`command-lookup.ts` supplies entity lookup. The completion UI uses
`@yaks/ux/completion`, the same behavior reused by filter fields, with drafts
kept by the host.

## Build the slash runtime before staging files

From the checkout root:

```sh
deno run -A apps/vale/build-slash.ts
```

The script bundles `apps/vale/slash-runtime.ts` for the browser into
`apps/vale/slash-runtime.bundle.js` and copies `packages/ui/Choices.css` to
`apps/vale/ui/Choices.css`. The single runtime bundle keeps the grammar,
completion, drafts, client, Preact and signals together, including workspace
exports not yet available in published packages. `index.html` maps those imports
to `./slash-runtime.bundle.js`; `ui/components.css` imports `Choices.css`.

For an app upload, explicitly stage both generated files together with the app's
other runtime files:

- `slash-runtime.bundle.js`
- `ui/Choices.css`

Both outputs are ignored by Git, so a tracked-file-only upload list omits them.
Rebuild and include both whenever the slash runtime or shared completion UI
changes. Here, staging means preparing the app's upload files, not adding these
ignored outputs to Git.

`build-slash.ts` and `slash-runtime.ts` are local build inputs, not upload
files. The deployed page loads the generated JavaScript bundle, not the
TypeScript dependency entry. Building prepares local artifacts only; it does not
publish packages or deploy the app.
