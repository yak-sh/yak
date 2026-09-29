// A page's examples, loaded as the tests they declare. Each compiled module
// is written beside its page, so its imports resolve as the page's do, as a
// hidden file named for the page, the example and this process
// (`.README.md.26.4242.example.ts`), and removed once loaded. One left by a
// process that has since ended is swept by the next run.
import {
  compileDoctests,
  compileFence,
  doctests,
  fences,
  module,
  specifiers,
} from './examples.ts'
import { test } from './suite.ts'

let url = (path: string) => new URL(path, `file://${Deno.cwd()}/`).href

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
  }.${tag}.${Deno.pid}.example.${EXT[lang] ?? 'ts'}`
}

let STRAY = /^\..+\.(\d+)\.example\.[jt]sx?$/

let alive = (pid: number) => {
  try {
    return Deno.statSync(`/proc/${pid}`).isDirectory
  } catch {
    return !Deno.statSync('/proc').isDirectory
  }
}

/** Removes the examples an ended run left beside `pages`. */
export let sweep = async (pages: string[]) => {
  let dirs = new Set(
    pages.map((p) => p.slice(0, p.lastIndexOf('/') + 1) || './'),
  )
  for (let dir of dirs) {
    for await (let e of Deno.readDir(dir)) {
      let pid = Number(e.name.match(STRAY)?.[1])
      if (pid && !alive(pid)) {
        await Deno.remove(`${dir}${e.name}`).catch(() => {})
      }
    }
  }
}

let runs = (source: string, page: string) => ({
  fenced: fences(source, page).filter((f) => !f.skip),
  lines: module(page) ? doctests(source) : [],
})

/**
 * For each page, a module importing what its examples import (the page
 * itself too, when it is a module), written beside it: what the page's
 * examples depend on, as a module graph can say. The caller removes them.
 */
export let plan = async (pages: string[]) =>
  await Promise.all(pages.map(async (page) => {
    let { fenced } = runs(await Deno.readTextFile(page), page)
    let base = page.slice(page.lastIndexOf('/') + 1)
    let named = new Set([
      ...module(page) ? [`./${base}`] : [],
      ...fenced.flatMap((f) => specifiers(f.code)),
    ])
    let path = beside(page, 'plan')
    await Deno.writeTextFile(
      path,
      [...named].map((s) => `import ${JSON.stringify(s)}\n`).join(''),
    )
    return [page, path] as const
  }))

// Loads one compiled example; one that cannot load fails as a test.
let load = async (page: string, tag: string, code: string, lang?: string) => {
  let path = beside(page, tag, lang)
  await Deno.writeTextFile(path, code)
  try {
    await import(url(path))
  } catch (error) {
    test(`${page}:${tag} loads`, () => {
      throw error
    })
  } finally {
    await Deno.remove(path).catch(() => {})
  }
}

// The names a module exports. Read through a module of its own: a namespace
// exporting `then` (@yaks/graph's does) is a thenable, so awaiting its import
// would call that `then` instead of handing the namespace back.
let exported = async (page: string): Promise<string[]> => {
  let base = page.slice(page.lastIndexOf('/') + 1)
  let path = beside(page, 'names')
  await Deno.writeTextFile(
    path,
    `import * as $module from './${base}'\nexport let names = Object.keys($module)\n`,
  )
  try {
    return (await import(url(path))).names
  } finally {
    await Deno.remove(path).catch(() => {})
  }
}

/** Loads a page's examples, each declaring its test. */
export let examples = async (page: string) => {
  let { fenced, lines } = runs(await Deno.readTextFile(page), page)
  let exports = module(page) ? await exported(page) : []
  for (let f of fenced) {
    let name = `${page}:${f.line}`
    await load(page, `${f.line}`, compileFence(name, page, f, exports), f.lang)
  }
  if (lines.length) {
    await load(page, 'doctests', compileDoctests(page, lines, exports))
  }
}
