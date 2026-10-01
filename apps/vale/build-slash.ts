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

// Push consumes a directory as the complete desired release. Prepare one
// containing the generated runtime too, rather than a tracked-file-only tree
// which would delete the browser's dependency bundle from the next release.
let stage = Deno.args[0]
if (stage) {
  let target = new URL(`${stage.replace(/\/$/, '')}/`, `file://${Deno.cwd()}/`)
  let source = new URL('./', import.meta.url)
  if (target.href.startsWith(source.href)) {
    throw new Error(
      'Stage outside apps/vale so the copy cannot include itself.',
    )
  }
  await Deno.mkdir(target, { recursive: true })
  let copy = async (dir: URL, rel = '') => {
    for await (let entry of Deno.readDir(dir)) {
      if (entry.name.startsWith('.') || entry.name == 'node_modules') continue
      let path = rel + entry.name
      if (entry.isDirectory) {
        await Deno.mkdir(new URL(`${path}/`, target), { recursive: true })
        await copy(new URL(`${entry.name}/`, dir), `${path}/`)
      } else if (
        entry.isFile && !/_test\.ts$|_fixture\.ts$|\.md$/.test(path) &&
        !['build-slash.ts', 'slash-runtime.ts'].includes(path)
      ) {
        await Deno.copyFile(new URL(entry.name, dir), new URL(path, target))
      }
    }
  }
  await copy(source)
  console.log(`Prepared Vale runtime files in ${target.pathname}`)
}
