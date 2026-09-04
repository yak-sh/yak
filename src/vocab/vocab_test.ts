// The vocabulary's value-level guard: types.ts (a GENERATED file) must say
// exactly what src/vocab/fixture.json records — both are written together
// by `deno task codegen`, so a hand edit to either drifts and fails here.
// The byte-level stale check against the manifests is `deno task codegen
// --check`, wired into `deno task check`; this test holds the semantic
// line inside the fast tier.
import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import { capture } from './fixture.ts'
import { assemble, typesStaleDiagnostic } from './gen.ts'
import * as types from '../types.ts'

let fixture = JSON.parse(
  Deno.readTextFileSync(new URL('./fixture.json', import.meta.url)),
)

// The real assembled vocabulary, straight from the manifests — the same input
// codegen sees, so the derivation is tested against ground truth, not a mock.
let mdir = new URL('./manifests/', import.meta.url)
let real = assemble(
  [...Deno.readDirSync(mdir)].filter((f) => f.name.endsWith('.json'))
    .map((f) => f.name).sort()
    .map((f) => JSON.parse(Deno.readTextFileSync(new URL(f, mdir)))),
)

// The five global lists assemble() refuses without — supplied so a synthetic
// one-manifest test can exercise just the kind derivation.
let lists = {
  edges: ['a about b'],
  governed: [],
  session_active: [],
  capabilities: [],
  session_facets: [],
}

Deno.test('types.ts matches the vocabulary fixture', () => {
  assertEquals(capture(types), fixture)
})

Deno.test('types.ts stale diagnostic names the current authority', () => {
  assertStringIncludes(typesStaleDiagnostic, 'src/vocab/manifests/*.json')
  assertFalse(typesStaleDiagnostic.includes('.toml'))
})

Deno.test('comp and stamped order are alphabetical', () => {
  assertEquals(real.compOrder, real.compOrder.slice().sort())
  assertEquals(real.stampedOrder, real.stampedOrder.slice().sort())
})

Deno.test('kindOrder is a topo sort of `before`, alphabetical base', () => {
  let at: Record<string, number> = {}
  real.kindOrder.forEach((k, i) => (at[k] = i))
  // Every declared `before` is honored: the winner precedes what it beats.
  for (let k of real.kindOrder) {
    for (let x of real.comps[k].before ?? []) {
      if (at[x] < at[k]) {
        throw new Error(`before violated: ${k} not before ${x}`)
      }
    }
  }
  // Where `before` says nothing between two kinds, alphabetical breaks the tie:
  // no kind may sit before an alphabetically-smaller kind unless a `before`
  // chain forces it. Check the immediate neighbors — a swap would need an edge.
  let edge = (a: string, b: string) => (real.comps[a].before ?? []).includes(b)
  for (let i = 1; i < real.kindOrder.length; i++) {
    let prev = real.kindOrder[i - 1], cur = real.kindOrder[i]
    if (cur < prev && !edge(prev, cur)) {
      throw new Error(`unforced inversion: ${prev} before ${cur}`)
    }
  }
})

Deno.test('a cycle in `before` refuses', () => {
  assertThrows(
    () =>
      assemble([{
        name: 'cyc',
        comps: {
          x: { kind: true, before: ['y'] },
          y: { kind: true, before: ['x'] },
        },
        ...lists,
      }]),
    Error,
    'cycle',
  )
})

Deno.test('`before` naming a non-kind refuses', () => {
  assertThrows(
    () =>
      assemble([{
        name: 'bad',
        comps: {
          x: { kind: true, before: ['plain'] },
          plain: {},
        },
        ...lists,
      }]),
    Error,
    'not a kind',
  )
})
