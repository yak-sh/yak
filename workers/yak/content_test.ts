/// <reference lib="deno.ns" />
// A content file names its own entity (T-34649). Owner: "it should maintain
// its identity between reads" — so the frontmatter carries no `entity` line
// and no `$alias` that means anything: a page is its slug and a prompt is its
// name, declared `identity: true` in content.vocab.json, and the eid is
// derived from that value (@yaks/graph identity.ts).
//
// Generation enforces the file identity at a per-file seam, and a file's
// own frontmatter applied twice to a store is one entity.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { contentIdentity } from './content-identity.ts'
import { front } from '@yaks/yaml'
import type { Bundle } from '@yaks/graph'
import { graph, identityEid } from '@yaks/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import content from './content.vocab.json' with { type: 'json' }
import { memory } from '../../packages/graph/testing.ts'

// The spine and the words a page shares with everything else, so the bundle in
// a file can be applied whole. The store this stands in for is a real one
// (graph.ts); what it stands in for is the fact that nothing applies these
// files yet — the shape is what is under test.
let core: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
  },
}

let vocab = loadVocab([core, content as VocabDoc])

let file = (path: string) =>
  front(Deno.readTextFileSync(new URL(path, import.meta.url)), path)

// Generation calls this for every guide and prompt; exercise its decision on
// bounded frontmatter, rather than rereading the growing guide in a test.
for (let [kind, prop] of [['guide', 'slug'], ['prompt', 'name']] as const) {
  let meta = { [kind]: { [prop]: 'sample' } }
  let path = `${kind}/sample.md`
  test(`${kind} content uses its identity property without an entity`, () => {
    contentIdentity(meta, kind, 'sample', path)
  })
  test(`${kind} content refuses an explicit entity`, () => {
    assertThrows(
      () =>
        contentIdentity(
          { ...meta, entity: { eid: '$page' } },
          kind,
          'sample',
          path,
        ),
      Error,
      'names an entity',
    )
  })
  test(`${kind} content refuses an identity different from its filename`, () => {
    assertThrows(
      () => contentIdentity(meta, kind, 'other', path),
      Error,
      `not other`,
    )
  })
  test(`${kind} content requires its identity row`, () => {
    assertThrows(
      () => contentIdentity({}, kind, 'sample', path),
      Error,
      `says no ${kind}`,
    )
  })
}

// The store the page is applied to, and the page as read, both made once.
let g = graph({ storage: memory(), vocab })
let { meta } = file('./public/docs/store.md')
let once = g.apply([{ ...meta, entity: { eid: '$page' } }]) as Bundle[]

test('a page applied twice is one entity, at the id its slug names', () => {
  let eid = identityEid('guide', ['store'])

  assertEquals(once[0].entity.eid, eid)
  assertEquals(typeof once[0].entity.num, 'number') // born

  // The same file read again, under an alias with nothing to do with the
  // first: no lookup, no eid kept, and no second page.
  let twice = g.apply([{ ...meta, entity: { eid: '$again' } }]) as Bundle[]
  assertEquals(twice[0].entity.eid, eid)
  assert(twice[0].entity.num == null, 'the second read minted a second page')
})
