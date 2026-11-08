// A reference's death rule across a space's apps (deaths.ts), through the
// whole kernel: a person deleted in one app takes the memberships naming them
// in another, and clears another app's detached reference to them.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { connector, kernel, signIn, txt, vocabFile } from './probe.ts'
import { minted } from './mcp-probe.ts'

let ref = (death: string) => ({ type: 'string', ref: 'entity', death })

type Kernel = Awaited<ReturnType<typeof kernel>>

// A fresh person's space and a connector to it: apps made from their words,
// written to and read by app.
let space = async (k: Kernel) => {
  let agent = connector(k, (await signIn(k)).cookie)
  return {
    made: async (slug: string, defs: Record<string, object>) => {
      await agent.tool('app_new', { slug, title: slug })
      await agent.tool('app_files', {
        app: slug,
        files: [{ path: 'vocab.json', content: vocabFile(defs as never) }],
      })
      await agent.tool('app_deploy', { app: slug })
    },
    applied: (app: string, entities: object[]) =>
      agent.tool('graph_apply', { app, entities }),
    rows: async (app: string, filter: string) =>
      JSON.parse(await agent.tool('graph_query', { app, filter })) as {
        entity: { eid: string }
        badge?: { holder?: string; label: string }
      }[],
  }
}

let PEOPLE = { individual: { first: txt } }
let MESSAGES = {
  membership: { person: ref('cascade'), group: txt },
  badge: { holder: ref('detach'), label: txt },
}

test("a death in one app takes what refers to it in the space's others", async () => {
  let k = await kernel()
  try {
    let { made, applied, rows } = await space(k)
    await made('people', PEOPLE)
    await made('messages', MESSAGES)
    let said = await applied('people', [
      { entity: { eid: '$ada' }, individual: { first: 'Ada' } },
      { entity: { eid: '$bo' }, individual: { first: 'Bo' } },
    ])
    let ada = minted(said, '$ada'), bo = minted(said, '$bo')
    await applied('messages', [
      { entity: { eid: '$m1' }, membership: { person: ada, group: 'choir' } },
      { entity: { eid: '$m2' }, membership: { person: ada, group: 'band' } },
      { entity: { eid: '$m3' }, membership: { person: bo, group: 'choir' } },
      { entity: { eid: '$b1' }, badge: { holder: ada, label: 'founder' } },
    ])

    await applied('people', [{ entity: { eid: ada }, tombstone: {} }])
    await k.settled()

    let left = await rows('messages', '.membership')
    assertEquals(left.length, 1)
    assertEquals((await rows('messages', '.badge'))[0].badge, {
      label: 'founder',
    })
    // Bo stands, and so does what names him.
    assertEquals(
      (await rows('people', '.individual')).map((r) => r.entity.eid),
      [
        bo,
      ],
    )
  } finally {
    await k.stop()
  }
})

// A reference written before its target's death was told across apps, or
// after it: the sweep's wake (`/api/move`) has each store tell the deaths it
// holds once, and the rule is carried out where the reference stands.
test('the move sweep carries out the deaths a store held before', async () => {
  let k = await kernel()
  try {
    let { made, applied, rows } = await space(k)
    await made('folk', PEOPLE)
    // More graves than one page of the walk holds.
    let folk = Array.from({ length: 120 }, (_, i) => `$p${i}`)
    let said = await applied(
      'folk',
      folk.map((alias, i) => ({
        entity: { eid: alias },
        individual: { first: `P${i}` },
      })),
    )
    let gone = folk.map((alias) => minted(said, alias))
    await applied(
      'folk',
      gone.map((eid) => ({ entity: { eid }, tombstone: {} })),
    )
    await k.settled()
    let ada = gone[110]
    await made('notes', MESSAGES)
    await applied('notes', [
      { entity: { eid: '$m' }, membership: { person: ada, group: 'choir' } },
    ])
    assertEquals((await rows('notes', '.membership')).length, 1)

    let sweep = async (query = '') =>
      await (await k.at(k.host, `/api/move${query}`, {
        method: query ? 'POST' : 'GET',
        headers: { cookie: k.owner.cookie },
      })).json()
    let listed = await sweep() as { store: string; at: string }[]
    let held = listed.find((s) =>
      s.at.endsWith('/folk') &&
      listed.some((n) => n.at == s.at.replace(/folk$/, 'notes'))
    )!
    let woken = `?store=${encodeURIComponent(held.store)}`
    assertEquals((await sweep(woken)).mourned, null)
    await k.settled()
    assertEquals(await rows('notes', '.membership'), [])
    assert((await sweep(woken)).mourned)
  } finally {
    await k.stop()
  }
})
