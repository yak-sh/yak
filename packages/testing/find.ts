// What a run is given: test modules, and the pages whose examples it runs.
// A path names a file or a directory; a directory is walked, never into
// another project's code (`node_modules`, `vendor`, a build's scratch) or a
// hidden one.
import { doctests, fences, module } from './examples.ts'

let SKIP = ['vendor', 'node_modules', '.wrangler']

/// tested('a/b_test.ts') -> true
/// tested('a/b.ts') -> false
/** Whether a path is a test module. */
export let tested = (path: string): boolean => /_test\.[mc]?[jt]sx?$/.test(path)

/// paged('a/README.md') -> true
/// paged('a/b.ts') -> true
/// paged('a/b_test.ts') -> false
/// paged('a/b.json') -> false
/** Whether a path could hold examples: a module or a Markdown page. */
export let paged = (path: string): boolean =>
  !tested(path) && (module(path) || path.endsWith('.md'))

/** Every file under the paths, sorted, each once. */
export let walk = async (paths: string[]): Promise<string[]> => {
  let out = new Set<string>()
  let go = async (path: string): Promise<void> => {
    let info = await Deno.stat(path)
    if (info.isFile) return void out.add(path)
    for await (let e of Deno.readDir(path)) {
      if (e.name.startsWith('.') || SKIP.includes(e.name)) continue
      let at = `${path}/${e.name}`
      if (e.isDirectory) await go(at)
      else if (e.isFile) out.add(at)
    }
  }
  for (let p of paths) await go(p.replace(/^\.\//, '').replace(/\/+$/, ''))
  return [...out].sort()
}

/** Whether a page's source holds an example that runs. */
export let examples = (path: string, source: string): boolean =>
  fences(source, path).some((f) => !f.skip) ||
  module(path) && doctests(source).length > 0

/** The test modules and the example pages under the paths. */
export let find = async (
  paths: string[],
): Promise<{ tests: string[]; pages: string[] }> => {
  let files = await walk(paths)
  let pages = await Promise.all(
    files.filter(paged).map(async (f) =>
      examples(f, await Deno.readTextFile(f)) ? [f] : []
    ),
  )
  return { tests: files.filter(tested), pages: pages.flat() }
}
