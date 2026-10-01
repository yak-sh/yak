// The deployed page cannot import unpublished workspace exports. One browser
// bundle keeps its client, drafts, completion UI and signals in the same realm.
// Run from the checkout root before staging the app's files.
let root = new URL('../../', import.meta.url)
let bundle = await new Deno.Command(Deno.execPath(), {
  cwd: root,
  args: [
    'bundle',
    '--platform',
    'browser',
    'apps/vale/slash-runtime.ts',
    '-o',
    'apps/vale/slash-runtime.bundle.js',
  ],
}).spawn().status
if (!bundle.success) Deno.exit(bundle.code)
await Deno.copyFile(
  new URL('packages/ui/Choices.css', root),
  new URL('apps/vale/ui/Choices.css', root),
)
