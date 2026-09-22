// The plugin as a host composes it (@yaks/cli `compose`): a config names the
// embedder and the text, the sweep is an effect, and `.near` is a query the
// door answers — nobody wires an extension up by hand. The package depends on
// nothing up here; the test does, because what it is checking is the wiring.

import { assert, assertEquals } from '@std/assert'
import type { Handler } from '@yaks/api'
import { compose } from '@yaks/cli/host'

// The door these tests ask: @yaks/api is in every config here, so a host
// without a handler would be this file's own bug.
let door = (host: { handler?: Handler }): Handler => {
  if (!host.handler) throw new Error('this host composed no handler')
  return host.handler
}

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
      '@yaks/api',
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
      let res = await door(yak)(
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

// T-37699: a host whose key has not arrived comes up anyway. It keeps no
// vectors, its check says what it is waiting for, and `.near` still compiles —
// the config names the space even where it cannot reach the model yet.
Deno.test('a config with no key composes, and nothing about the boot is different', async () => {
  let warn = console.warn
  console.warn = () => {}
  let yak = await compose({
    db: ':memory:',
    numbers: false,
    plugins: [
      '@yaks/doc',
      '@yaks/api',
      {
        use: '@yaks/embedding',
        with: {
          embedder: {
            via: 'ollama',
            model: 'qwen3',
            base: 'https://box',
            key: undefined,
          },
          text: ['doc.title', 'doc.body'],
          after: 5,
        },
      },
    ],
  })
  try {
    await yak.graph.apply(shelf)
    let res = await door(yak)(
      new Request(
        `http://host/query?q=${encodeURIComponent('.near=d1&.order=similar')}`,
      ),
    )
    assertEquals(res.status, 200, await res.text())
    await new Promise((go) => setTimeout(go, 30))
    assertEquals(
      Number(yak.sql.query('select count(*) as n from embedding', [])[0].n),
      0,
      'a host with no key embeds nothing',
    )
  } finally {
    await yak.close()
    console.warn = warn
  }
})

// T-37726: open, write, close — and nothing fires afterwards. The settle timer
// the write armed is cancelled by the ending rather than waking over a
// database that is gone.
Deno.test('a host that closes takes its pending sweep with it', async () => {
  let late: unknown[] = []
  let warn = console.warn
  console.warn = (...said: unknown[]) => late.push(said)
  try {
    let yak = await compose({
      db: ':memory:',
      numbers: false,
      plugins: [
        '@yaks/doc',
        {
          use: '@yaks/embedding',
          with: { embedder: { via: 'hash' }, after: 30 },
        },
      ],
    })
    await yak.graph.apply(shelf)
    await yak.close()
    await new Promise((go) => setTimeout(go, 80))
    assertEquals(late, [], 'the sweep fired after the store was closed')
  } finally {
    console.warn = warn
  }
})
