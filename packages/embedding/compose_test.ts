// The plugin as a HOST composes it (@yaks/cli `compose`): a config names the
// embedder and the text, the sweep is an effect, and `.near` is a query the
// door answers — nobody wires an extension up by hand. The package depends on
// nothing up here; the test does, because what it is checking is the wiring.

import { assert, assertEquals } from '@std/assert'
import { compose } from '@yaks/cli/serve'

// Three documents: two about the same thing in different words, one about
// something else. The offline embedder sees vocabulary overlap and no meaning,
// which is all this has to prove — the model is the host's choice, not ours.
let shelf = [
  {
    entity: { eid: 'd1' },
    doc: {
      title: 'The Hobbit',
      body: 'A burglar leaves home and meets a dragon.',
    },
  },
  {
    entity: { eid: 'd2' },
    doc: {
      title: 'Dragonflight',
      body: 'A burglar meets a dragon and leaves home.',
    },
  },
  {
    entity: { eid: 'd3' },
    doc: {
      title: 'Kitchen Confidential',
      body: 'A cook writes what the nights are like.',
    },
  },
]

let host = () =>
  compose({
    db: ':memory:',
    numbers: false,
    plugins: [
      '@yaks/doc',
      {
        use: '@yaks/embedding',
        with: {
          embedder: { via: 'hash' },
          text: ['doc.title', 'doc.body'],
          after: 0,
        },
      },
    ],
  })

Deno.test('a config composes the vectors, and asking the door ranks by them', async () => {
  let yak = await host()
  try {
    await yak.graph.apply(shelf)
    let vectors = () =>
      Number(yak.sql.query('select count(*) as n from embedding', [])[0].n)
    for (let i = 0; i < 400 && vectors() < 3; i++) {
      await new Promise((go) => setTimeout(go, 1))
    }
    assertEquals(vectors(), 3, 'the sweep the write woke')

    let ask = async (q: string) => {
      let res = await yak.handler(
        new Request(`http://host/query?q=${encodeURIComponent(q)}`),
      )
      return { status: res.status, said: await res.json() }
    }
    let near = await ask('.near=d1&.order=similar')
    assertEquals(near.status, 200)
    assertEquals(
      (near.said as { entity: { eid: string } }[]).map((b) => b.entity.eid),
      ['d2', 'd3'],
    )
    // and the compiler still refuses a ranking with nothing to rank
    let bare = await ask('.order=similar')
    assertEquals(bare.status, 400)
    assert(JSON.stringify(bare.said).includes('rank by'), `${bare.said}`)
  } finally {
    yak.close()
  }
})
