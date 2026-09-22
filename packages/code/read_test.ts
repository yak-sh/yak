import { assertEquals } from '@std/assert'
import {
  exportsOf,
  header,
  type Manifest,
  manifest,
  markdown,
  owner,
  resolve,
  specifiers,
} from './read.ts'

Deno.test('header: a // paragraph, a /** */ block, and no header at all', () => {
  let cases: [string, string][] = [
    [
      '// Owns the store.\n//\n// Nothing else.\nlet x = 1',
      'Owns the store.\n\nNothing else.',
    ],
    [
      '#!/usr/bin/env -S deno run\n// deno-lint-ignore-file\n// Tool.\n',
      'Tool.',
    ],
    ['/**\n * The module.\n *\n * @module\n */\nexport {}', 'The module.'],
    ['/** One line. */\nlet x = 1', 'One line.'],
    ['let x = 1\n// not a header', ''],
  ]
  for (let [text, want] of cases) assertEquals(header(text), want, text)
})

Deno.test('specifiers: statements at the start of a line, never quoted ones', () => {
  let text = [
    "import { a } from './a.ts'",
    "import type { B } from '../b.ts'",
    "import * as c from '@yaks/c'",
    "import d, { e } from './d.ts'",
    "export * from './e.ts'",
    "export { f } from './f.ts'",
    "import './side.ts'",
    "import {\n  g,\n  h,\n} from './g.ts'",
    " * import { quoted } from './no.ts'",
    "export let x = Array.from('abc')",
  ].join('\n')
  assertEquals(specifiers(text), [
    './a.ts',
    '../b.ts',
    '@yaks/c',
    './d.ts',
    './e.ts',
    './f.ts',
    './side.ts',
    './g.ts',
  ])
})

let git = manifest(
  'packages/git/deno.json',
  JSON.stringify({
    name: '@yaks/git',
    exports: { '.': './mod.ts', './cites': './cites.ts' },
  }),
)!
let root = manifest(
  'deno.json',
  JSON.stringify({ name: 'tasks', exports: './src/mod.ts' }),
)!

Deno.test('manifest: a named package, and nothing for an unnamed one', () => {
  assertEquals(git.dir, 'packages/git')
  assertEquals(root.exports, { '.': './src/mod.ts' })
  assertEquals(manifest('a/deno.json', '{"tasks": {}}'), undefined)
  assertEquals(manifest('a/deno.json', 'not json'), undefined)
})

Deno.test('resolve and owner: relative paths, workspace names, and the nearest manifest', () => {
  let pkgs: Manifest[] = [git, root]
  assertEquals(resolve('./b.ts', 'src/a.ts', pkgs), 'src/b.ts')
  assertEquals(resolve('../x/y.ts', 'src/a/b.ts', pkgs), 'src/x/y.ts')
  assertEquals(resolve('@yaks/git', 'src/a.ts', pkgs), 'packages/git/mod.ts')
  assertEquals(
    resolve('@yaks/git/cites', 'src/a.ts', pkgs),
    'packages/git/cites.ts',
  )
  assertEquals(resolve('@yaks/git/nope', 'src/a.ts', pkgs), undefined)
  assertEquals(resolve('jsr:@std/assert', 'src/a.ts', pkgs), undefined)
  assertEquals(owner('packages/git/land.ts', pkgs)?.name, '@yaks/git')
  assertEquals(owner('src/db.ts', pkgs)?.name, 'tasks')
})

Deno.test('markdown: frontmatter title, first heading, or the file name', () => {
  assertEquals(markdown('a/README.md', '# Hello\n\nBody'), {
    title: 'Hello',
    body: '# Hello\n\nBody',
  })
  assertEquals(
    markdown('b.md', '---\ndoc:\n  title: Given\n---\n# Not this').title,
    'Given',
  )
  assertEquals(markdown('docs/notes.md', 'plain').title, 'notes.md')
})

Deno.test('exportsOf: own exports once each, never a re-export', () => {
  let url = 'file:///r/a.ts'
  let decl = (filename: string, kind: string, line: number, doc?: string) => ({
    location: { filename, line },
    declarationKind: 'export',
    kind,
    ...(doc ? { jsDoc: { doc } } : {}),
  })
  let nodes = {
    [url]: {
      symbols: [
        {
          name: 'f',
          declarations: [
            decl(url, 'function', 3, ' Does f. '),
            decl(url, 'function', 9),
          ],
        },
        { name: 'g', declarations: [decl('file:///r/b.ts', 'variable', 1)] },
        { name: 'h', declarations: [decl(url, 'reference', 5)] },
        { name: 'T', declarations: [decl(url, 'typeAlias', 12)] },
      ],
    },
  }
  assertEquals(exportsOf(nodes, url), [
    { name: 'f', kind: 'function', line: 3, doc: 'Does f.' },
    { name: 'T', kind: 'typeAlias', line: 12, doc: '' },
  ])
})
