// Which files name what a change edits: a test importing `fields` from
// @yaks/fts checks `fields`, where a kernel test reaching the same module
// through the platform it composes merely loads it. The module graph ranks
// both alike; the names a file imports, followed through the modules
// re-exporting them and the declarations saying them, tell the first apart.
// A change's edits are named by the top-level declaration holding each edited
// line (`declared`).
import type { Info } from '@yaks/process/modules'
import { location } from './deps.ts'

// What opens a top-level declaration, and the name it gives.
let DECLARED =
  /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:let|const|var|function\*?|class|enum|type|interface)\s+([\w$]+)/
// A line going on with what an earlier line opened.
let GOING_ON = /^[)\]}]/

/// let src = ['import { x } from "./x.ts"', '', 'export let a = (', '  n: number,', '): number => {', '  return n', '}', 'let b = 2']
/// declared(src.join('\n')) -> [undefined, undefined, 'a', 'a', 'a', 'a', 'a', 'b']
/// declared('let c = [\n  1,\n]\nf(c)') -> ['c', 'c', 'c', undefined]
/** The top-level declaration each line of formatted source belongs to, by
 * the nearest line above it at no indentation that opens one; none for an
 * import or other top-level code. */
export let declared = (text: string): (string | undefined)[] => {
  let at: string | undefined
  return text.split('\n').map((l) => {
    if (l && !/^\s/.test(l) && !GOING_ON.test(l)) at = DECLARED.exec(l)?.[1]
    return at
  })
}

/** What a module imports or re-exports from one specifier: each name by the
 * name it has there and the one it is given here, every name (`*`), or the
 * whole module under one name (`as`). */
export type Imported = {
  from: string
  names: [string, string][]
  all?: boolean
  as?: string
  exported?: boolean
}

let STATEMENT =
  /^(import|export)\s+(type\s+)?(?:\*\s+as\s+([\w$]+)|(\*)|\{([^}]*)\})\s*from\s*['"]([^'"]+)['"]/gm

/// imported("import { a, b as c, type T } from './m.ts'") -> [{ from: './m.ts', names: [['a', 'a'], ['b', 'c']] }]
/// imported("import type { T } from './m.ts'") -> []
/// imported("import * as m from '@yaks/m'") -> [{ from: '@yaks/m', names: [], as: 'm' }]
/// imported("export * from './f.ts'\nexport { g as h } from './g.ts'") -> [{ from: './f.ts', names: [], all: true, exported: true }, { from: './g.ts', names: [['g', 'h']], exported: true }]
/// imported('import {\n  a,\n  b,\n} from "x"') -> [{ from: 'x', names: [['a', 'a'], ['b', 'b']] }]
/** The values a module imports and re-exports by a specifier, but types. */
export let imported = (text: string): Imported[] =>
  [...text.matchAll(STATEMENT)].flatMap(
    ([, verb, type, as, star, list, from]) => {
      if (type) return []
      let exported = verb == 'export' ? { exported: true } : {}
      if (as) return [{ from, names: [], as, ...exported }]
      if (star) return [{ from, names: [], all: true, ...exported }]
      let names = list.split(',').map((n) => n.trim())
        .filter((n) => n && !n.startsWith('type '))
        .map((n) => n.split(/\s+as\s+/) as [string, string])
        .map(([n, k]) => [n, k ?? n] as [string, string])
      return [{ from, names, ...exported }]
    },
  )

/** How many declarations a name is followed through: a test calling what
 * calls what calls an edited function is as far as it goes. */
export const STEPS = 2

/**
 * Of `files`, how near each is to what a change `edited` (each module's
 * declarations, by checkout path): 0 for a file importing an edited
 * declaration by name, directly or from a module re-exporting it, or reading
 * it off the whole module (`m.fields`); 1 for one naming a declaration that
 * names an edited one, in its module or another; and so on to `steps`. A file
 * naming none is left out. Each file is read for the root it stands for
 * (`root`, an example page's plan module), and modules as `info` resolved
 * them.
 */
export let naming = (
  info: Info,
  files: string[],
  edited: Record<string, string[]>,
  read: (path: string) => string | undefined,
  root: (file: string) => string = (f) => f,
  steps: number = STEPS,
): Map<string, number> => {
  let { url, rel } = location()
  // What each module's specifiers resolve to, and who imports each module.
  let resolved = new Map<string, Map<string, string>>()
  let importers = new Map<string, string[]>()
  for (let m of info.modules) {
    let to = new Map<string, string>()
    for (let d of m.dependencies ?? []) {
      let at = d.code?.specifier ?? d.type?.specifier
      if (!d.specifier || !at) continue
      to.set(d.specifier, at)
      ;(importers.get(at) ?? importers.set(at, []).get(at)!).push(m.specifier)
    }
    resolved.set(m.specifier, to)
  }
  let texts = new Map<string, string>()
  let text = (module: string) => {
    if (!texts.has(module)) texts.set(module, read(rel(module)) ?? '')
    return texts.get(module)!
  }
  let parsed = new Map<string, Imported[]>()
  let of = (module: string) => {
    if (!parsed.has(module)) parsed.set(module, imported(text(module)))
    return parsed.get(module)!
  }
  // The declarations of a module whose lines say `word`.
  let owners = new Map<string, (string | undefined)[]>()
  let saying = (module: string, word: string) => {
    if (!owners.has(module)) owners.set(module, declared(text(module)))
    let of = owners.get(module)!, said = new Set<string>()
    let re = new RegExp(
      `(?<![\\w$.])${word.replace(/[$.]/g, '\\$&')}(?![\\w$])`,
    )
    text(module).split('\n').forEach((l, i) => {
      if (of[i] && re.test(l)) said.add(of[i]!)
    })
    return said
  }
  let roots = new Map(files.map((f) => [url(root(f)), f]))
  let near = new Map<string, number>()
  let seen = new Map<string, number>()
  // Breadth first, so each declaration is reached at its fewest steps.
  let go = Object.entries(edited).flatMap(([m, names]) =>
    names.map((n) => ({ m: url(m), n, step: 0 }))
  )
  for (let at = 0; at < go.length; at++) {
    let { m, n, step } = go[at]
    if ((seen.get(`${m}#${n}`) ?? Infinity) <= step) continue
    seen.set(`${m}#${n}`, step)
    let next = (module: string, word: string) => {
      if (step >= steps) return
      for (let d of saying(module, word)) {
        if (d != n || module != m) go.push({ m: module, n: d, step: step + 1 })
      }
    }
    next(m, n)
    for (let e of importers.get(m) ?? []) {
      for (let i of of(e)) {
        if (resolved.get(e)?.get(i.from) != m) continue
        let words = i.names.filter(([from]) => from == n).map(([, as]) => as)
        if (i.exported) {
          if (i.all) words.push(n)
          for (let w of words) go.push({ m: e, n: w, step })
          continue
        }
        if (i.as && text(e).includes(`${i.as}.${n}`)) words.push(`${i.as}.${n}`)
        if (!words.length) continue
        let f = roots.get(e)
        if (f != undefined) near.set(f, Math.min(near.get(f) ?? Infinity, step))
        for (let w of words) next(e, w)
      }
    }
  }
  return near
}
