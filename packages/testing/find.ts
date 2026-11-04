import * as io from '@yaks/file/io'
// What a run is given: test modules, and the pages whose examples it runs.
// A path names a file or a directory; a directory is walked, never into
// another project's code (`node_modules`, `vendor`, a build's scratch) or a
// hidden one.
import { type Examples, module, scan } from './examples.ts'

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

/// written('.README.md.plan.4242.example.ts') -> 4242
/// written('.mod.ts.3.4242.example.tsx') -> 4242
/// written('README.md') -> undefined
/** The process that wrote a file beside a page while the page was keyed or
 * its examples loaded (./load.ts `beside`), by the file's name; none for any
 * other file. */
export let written = (name: string): number | undefined => {
  let pid = name.match(/^\..+\.(\d+)\.example\.[jt]sx?$/)?.[1]
  return pid ? Number(pid) : undefined
}

/** Every file under the paths, sorted, each once. */
export let walk = (paths: string[]): Promise<string[]> =>
  Promise.try(() => {
    let out = new Set<string>()
    let visited = new Set<string>()
    let go = (path: string): void => {
      if (visited.has(path)) return
      visited.add(path)
      let info = io.statSync(path)
      if (info.isFile) return void out.add(path)
      for (let e of io.readDirSync(path)) {
        if (e.name.startsWith('.') || SKIP.includes(e.name)) continue
        let at = `${path}/${e.name}`
        if (e.isDirectory) go(at)
        else if (e.isFile) out.add(at)
      }
    }
    for (let p of paths) go(p.replace(/^\.\//, '').replace(/\/+$/, ''))
    return [...out].sort()
  })

/** Whether a page's source holds an example that runs. */
export let examples = (path: string, source: string): boolean => {
  let { fenced, lines } = scan(source, path)
  return !!(fenced.length || lines.length)
}

export type Found = {
  tests: string[]
  pages: string[]
  parsed?: ReadonlyMap<string, Examples>
}

/** Test modules, example pages and their parsed inputs for one command. */
export let discover = async (
  paths: string[],
): Promise<Found> => {
  let files = await walk(paths)
  let parsed = new Map<string, Examples>()
  for (let file of files.filter(paged)) {
    let examples = scan(io.readTextFileSync(file), file)
    if (examples.fenced.length || examples.lines.length) {
      parsed.set(file, examples)
    }
  }
  return { tests: files.filter(tested), pages: [...parsed.keys()], parsed }
}

/** The test modules and the example pages under the paths. */
export let find = async (
  paths: string[],
): Promise<{ tests: string[]; pages: string[] }> => {
  let { tests, pages } = await discover(paths)
  return { tests, pages }
}
