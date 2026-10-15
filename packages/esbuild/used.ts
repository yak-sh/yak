// Which exports of each shared npm specifier a page's consumers use, so that
// its shared module carries those and no more (./shared.ts), as a bundled copy
// did. esbuild answers, by shaking the consumers as it shook each copy: one
// build reads what each specifier exports, and a second builds every
// consumer's entries with each specifier read from a stand-in, which passes
// each export through a pure call carrying a mark. A call nothing uses is
// shaken out with its mark, so the marks left name what is used. A namespace
// that escapes (passed along, or read with a computed key) keeps every export.
// The stand-in passes the package's own export through, so what a shared
// package is used for decides what it uses of another; an import from inside
// the package is its own and reads the module itself.
import { bundle, type Options, type Source } from './bundle.ts'
import { owner } from './common.ts'
import { packageOf } from './graph.ts'

let MARK = 'yaks:used:'
let MARKS = /yaks:used:(\d+):(\d+)/g

/** A module exporting what `path` exports, each export through a marked
 * call: the `i`th specifier's `j`th export carries `yaks:used:i:j`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(
 *   standIn('node_modules/a/index.js', ['default'], 0),
 *   'let mark = (_, value) => value\n' +
 *     'import { "default" as a0 } from "/node_modules/a/index.js"\n' +
 *     'let b0 = /* @__PURE__ *\/ mark("yaks:used:0:0", a0)\n' +
 *     'export { b0 as "default" }',
 * )
 * ```
 */
export let standIn = (path: string, names: string[], i: number): string => {
  let from = JSON.stringify(`/${path}`)
  let named = (as: (name: string, j: number) => string) =>
    names.map(as).join(', ')
  return names.length
    ? [
      'let mark = (_, value) => value',
      `import { ${named((n, j) => `${JSON.stringify(n)} as a${j}`)} } ` +
      `from ${from}`,
      ...names.map((_, j) =>
        `let b${j} = /* @__PURE__ */ mark("${MARK}${i}:${j}", a${j})`
      ),
      `export { ${named((n, j) => `b${j} as ${JSON.stringify(n)}`)} }`,
    ].join('\n')
    : `import ${from}`
}

let points = (paths: string[]) =>
  Object.fromEntries(paths.map((path, i) => [`entry-${i}`, path]))

/** The exports of each shared specifier (`entries`, by the file it names)
 * that `files`, every consumer's entries, use once built with `options`. */
export let used = async (
  fs: Source,
  files: string[],
  entries: Record<string, string>,
  options: Options,
): Promise<Record<string, string[]>> => {
  let specs = Object.keys(entries).sort()
  if (!specs.length) return {}
  let { exports } = await bundle(fs, points(specs.map((s) => entries[s])), {
    graph: true,
  })
  let names = specs.map((_, i) => exports![`entry-${i}.js`])
  let stands: Record<string, string> = Object.fromEntries(
    specs.map((spec, i) => [
      `__used/${i}.js`,
      standIn(entries[spec], names[i], i),
    ]),
  )
  let built = await bundle(
    { read: (path) => stands[path] ?? fs.read(path) },
    points(files),
    {
      ...options,
      alias: (spec, importer) => {
        let i = specs.indexOf(spec)
        return i < 0 || packageOf(spec) == owner(importer)
          ? undefined
          : `__used/${i}.js`
      },
    },
  )
  let marks = new Set(
    Object.values(built.files).flatMap((text) =>
      [...text.matchAll(MARKS)].map((m) => m[0])
    ),
  )
  return Object.fromEntries(specs.map((spec, i) => [
    spec,
    names[i].filter((_, j) => marks.has(`${MARK}${i}:${j}`)),
  ]))
}
