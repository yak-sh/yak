/// <reference lib="deno.ns" />
// A content file names its own entity (T-34649). Owner: "it should maintain
// its identity between reads" — so the frontmatter carries no `entity` line
// and no `$alias` that means anything: a page IS its slug and a prompt IS its
// name, declared `identity: true` in content.vocab.json, and the eid is
// derived from that value (@yaks/graph identity.ts).
//
// What is proven here is the whole of the claim: the files say it that way,
// and a file's own frontmatter applied twice to a store is one entity.
import { assert, assertEquals } from '@std/assert'
import { front } from '@yaks/yaml'
import type { Bundle } from '@yaks/graph'
import { graph, identityEid } from '@yaks/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import content from './content.vocab.json' with { type: 'json' }
import { memory } from '../../packages/graph/harness.ts'

// The spine and the words a page shares with everything else, so the bundle in
// a file can be applied whole. The store this stands in for is a real one
// (graph.ts); what it stands in for is the fact that nothing applies these
// files yet — the shape is what is under test.
let core: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
  },
}

let vocab = loadVocab([core, content as VocabDoc])

let file = (path: string) =>
  front(Deno.readTextFileSync(new URL(path, import.meta.url)), path)

let named = (dir: string) =>
  [...Deno.readDirSync(new URL(dir, import.meta.url))]
    .map((e) => e.name)
    .filter((n) => n.endsWith('.md'))
    .sort()

// The two rosters, walked rather than listed: a page or a prompt added
// tomorrow is covered the day it lands.
let pages = named('./public/guide/')
let prompts = named('./prompts/')

Deno.test('no content file names an entity — the identity column does', () => {
  assert(pages.length > 1 && prompts.length > 1)
  for (
    let [dir, comp, col, names] of [
      ['./public/guide/', 'guide', 'slug', pages],
      ['./prompts/', 'prompt', 'name', prompts],
    ] as const
  ) {
    for (let name of names) {
      let { meta } = file(`${dir}${name}`)
      let row = meta[comp] as Record<string, unknown>
      assert(row, `${dir}${name} says no ${comp}`)
      assertEquals(
        meta.entity,
        undefined,
        `${dir}${name} names an entity — its ${comp}.${col} is what does that`,
      )
      // The file's name and its identity are one fact, which is also what
      // gen.ts refuses on (a page's row is keyed by slug).
      assertEquals(row[col], name.slice(0, -3), `${dir}${name} ${comp}.${col}`)
    }
  }
})

Deno.test('a page applied twice is one entity, at the id its slug names', () => {
  let g = graph({ storage: memory(), vocab })
  let { meta } = file('./public/guide/store.md')
  let eid = identityEid('guide', ['store'])

  let once = g.apply([{ ...meta, entity: { eid: '$page' } }]) as Bundle[]
  assertEquals(once[0].entity.eid, eid)
  assertEquals(typeof once[0].entity.num, 'number') // born

  // The same file read again, under an alias with nothing to do with the
  // first: no lookup, no eid kept, and no second page.
  let twice = g.apply([{ ...meta, entity: { eid: '$again' } }]) as Bundle[]
  assertEquals(twice[0].entity.eid, eid)
  assert(twice[0].entity.num == null, 'the second read minted a second page')
})
