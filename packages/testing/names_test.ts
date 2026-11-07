import { naming } from './names.ts'
import { equal, test } from './mod.ts'

// A checkout of modules by their text, and the graph deno resolves of it:
// each relative specifier a module imports or re-exports.
let checkout = (files: Record<string, string>) => {
  let url = (f: string) => new URL(f, `file://${Deno.cwd()}/`).href
  let info = {
    modules: Object.entries(files).map(([f, text]) => ({
      specifier: url(f),
      dependencies: [...text.matchAll(/from '(\.\/[^']+)'/g)].map(([, s]) => ({
        specifier: s,
        code: { specifier: url(s.slice(2)) },
      })),
    })),
    redirects: {},
  }
  let tests = Object.keys(files).filter((f) => f.endsWith('_test.ts'))
  return (edited: Record<string, string[]>) =>
    Object.fromEntries(naming(info, tests, edited, (p) => files[p]))
}
let near = checkout({
  'a.ts': 'export let f = () => 1\nexport let h = () => 2',
  'b.ts':
    "import { f } from './a.ts'\nexport let g = () =>\n  f() + 1\nexport let k = 3",
  'mod.ts': "export * from './b.ts'\nexport { f as eff } from './a.ts'",
  'direct_test.ts': "import { f } from './a.ts'",
  'barrel_test.ts': "import { eff, g } from './mod.ts'",
  'whole_test.ts': "import * as a from './a.ts'\na.f()",
  'other_test.ts': "import { k } from './b.ts'",
  'typed_test.ts': "import type { f } from './a.ts'",
})

test('a file naming an edited declaration, or one naming it, is as near as the steps between', () => {
  equal(near({ 'a.ts': ['f'] }), {
    'direct_test.ts': 0,
    'whole_test.ts': 0,
    'barrel_test.ts': 0,
  })
  equal(near({ 'a.ts': ['h'] }), {})
  equal(near({ 'b.ts': ['g'] }), { 'barrel_test.ts': 0 })
})

test('a file naming a declaration that says an edited one is a step from it', () => {
  let stepped = checkout({
    'a.ts': 'export let f = () => 1',
    'b.ts': "import { f } from './a.ts'\nexport let g = () => f()",
    'g_test.ts': "import { g } from './b.ts'",
  })
  equal(stepped({ 'a.ts': ['f'] }), { 'g_test.ts': 1 })
})
