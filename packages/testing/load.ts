import * as io from '@yaks/file/io'
import * as system from '@yaks/process/system'
// A page's examples, loaded as the tests they declare. Each compiled module
// is written beside its page, so its imports resolve as the page's do, as a
// hidden file named for the page, the example and this process
// (`.README.md.26.4242.example.ts`), and removed once loaded. One left by a
// process that has since ended is swept by the next run.
import {
  compileDoctests,
  compileFence,
  type Examples,
  fenceName,
  module,
  scan,
  specifiers,
} from './examples.ts'
import { written } from './find.ts'
import { test } from './suite.ts'

let url = (path: string) => new URL(path, `file://${system.cwd()}/`).href

let EXT: Record<string, string> = {
  tsx: 'tsx',
  jsx: 'jsx',
  js: 'js',
  javascript: 'js',
  mjs: 'js',
}

/** Where an example of `page` is written while it loads. */
export let beside = (page: string, tag: string, lang = 'ts') => {
  let i = page.lastIndexOf('/')
  return `${page.slice(0, i + 1)}.${
    page.slice(i + 1)
  }.${tag}.${system.pid}.example.${EXT[lang] ?? 'ts'}`
}

let alive = (pid: number) => {
  try {
    return io.statSync(`/proc/${pid}`).isDirectory
  } catch {
    return !io.statSync('/proc').isDirectory
  }
}

/** Removes the examples an ended run left beside `pages`. */
export let sweep = async (pages: string[]) => {
  let dirs = new Set(
    pages.map((p) => p.slice(0, p.lastIndexOf('/') + 1) || './'),
  )
  for (let dir of dirs) {
    for (let e of io.readDirSync(dir)) {
      let pid = written(e.name)
      if (pid && !alive(pid)) {
        await io.remove(`${dir}${e.name}`).catch(() => {})
      }
    }
  }
}

/**
 * For each page, a module importing what its examples import, fenced or
 * doctest, statically or by a literal `import(…)` (the page itself too, when
 * it is a module), written beside it: what the page's examples depend on, as
 * a module graph can say. The caller removes them.
 */
export let plan = (
  pages: string[],
  parsed?: ReadonlyMap<string, Examples>,
) =>
  Promise.try(() =>
    pages.map((page) => {
      let { fenced, lines } = parsed?.get(page) ??
        scan(io.readTextFileSync(page), page)
      let base = page.slice(page.lastIndexOf('/') + 1)
      let named = new Set([
        ...module(page) ? [`./${base}`] : [],
        ...[...fenced, ...lines.filter((l) => !l.skip)]
          .flatMap((e) => specifiers(e.code)),
      ])
      let path = beside(page, 'plan')
      io.writeTextFileSync(
        path,
        [...named].map((s) => `import ${JSON.stringify(s)}\n`).join(''),
      )
      return [page, path] as const
    })
  )

// Loads one compiled example; one that cannot load fails as a test.
let load = async (
  page: string,
  tag: string,
  code: string,
  lang?: string,
) => {
  let path = beside(page, tag, lang)
  await io.writeTextFile(path, code)
  try {
    await import(url(path))
  } catch (error) {
    test(`${page}:${tag} loads`, () => {
      throw error
    })
  } finally {
    await io.remove(path).catch(() => {})
  }
}

/** The names a module exports. */
let exported = async (page: string): Promise<string[]> =>
  Object.keys(await import(url(page)))

/** Loads a page's examples, each declaring its test. */
export let examples = async (page: string, parsed?: Examples) => {
  let { fenced, lines } = parsed ?? scan(io.readTextFileSync(page), page)
  let exports = module(page) ? await exported(page) : []
  for (let f of fenced) {
    let name = await fenceName(page, f)
    await load(
      page,
      `${f.line}`,
      compileFence(name, page, f, exports),
      f.lang,
    )
  }
  if (lines.length) {
    await load(
      page,
      'doctests',
      compileDoctests(page, lines, exports),
    )
  }
}
