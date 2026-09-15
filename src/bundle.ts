// The browser's one module. A shell that loads main.tsx as a graph discovers
// its 250 modules a level at a time, each level parsed before the next is
// asked for, and even preloaded from cache that is ~90 ms to DOMContentLoaded;
// the same code as one file is ~25 ms, with 8 requests where there were 250
// (T-37445). So the server builds that file once at boot, with `deno bundle`
// over the shell's own import map resolved to disk, and serves it in place of
// the entry script. No build step and nothing checked in: the bundle lives in
// memory for the process's life, stamped by the same generation the modules
// are, and a failed build means the shell serves the graph as before.
import { dirname } from 'node:path'

export type Roots = { src: string; repo: string }

// The shell's import map, as files: `/packages/...` is the repo, the rest src.
export let mapFor = (
  imports: Record<string, string>,
  roots: Roots,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(imports).map(([name, path]) => [
      name,
      (path.startsWith('/packages/') ? roots.repo : roots.src) + path.slice(1),
    ]),
  )

// The shell with its entry script pointed at the bundle.
export let shellFor = (html: string, entry: string, bundle: string) =>
  html.replace(
    `<script type="module" src="${entry}"></script>`,
    `<script type="module" src="${bundle}"></script>`,
  )

// The compiler's view: the vocab any TSX in the graph is written in.
let JSX = { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'preact' } }

// Build the bundle for `entry` under `imports`, or null when the build cannot
// run here (an older deno, a refused subprocess): the caller falls back, and
// the reason is on stderr.
export let build = async (
  entry: string,
  imports: Record<string, string>,
): Promise<string | null> => {
  let dir = await Deno.makeTempDir({ prefix: 'bundle-' })
  try {
    await Deno.writeTextFile(`${dir}/map.json`, JSON.stringify({ imports }))
    await Deno.writeTextFile(`${dir}/jsx.json`, JSON.stringify(JSX))
    let out = `${dir}/main.js`
    let ran = await new Deno.Command(Deno.execPath(), {
      args: [
        'bundle',
        '--platform',
        'browser',
        '-c',
        `${dir}/jsx.json`,
        '--import-map',
        `${dir}/map.json`,
        '-o',
        out,
        entry,
      ],
      cwd: dirname(entry),
      stdout: 'null',
      stderr: 'piped',
    }).output()
    if (!ran.success) {
      console.warn(
        'bundle: build failed, serving the module graph —',
        new TextDecoder().decode(ran.stderr).trim().split('\n').at(-1),
      )
      return null
    }
    return await Deno.readTextFile(out)
  } catch (e) {
    console.warn('bundle: build failed, serving the module graph —', e)
    return null
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}
