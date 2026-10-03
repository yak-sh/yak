// A stored pace follows the kernel-vouched instrument, independently for each
// entity, and survives another instrument's edit, sign-in and redeployment.
import { test, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import {
  accepted,
  client,
  connector,
  type Kernel,
  kernel,
  meta,
  seed,
  signIn,
} from './probe.ts'
import { COOKIE, sign } from './lib/token.ts'
import { browserOf, SESSION } from './session.ts'
import { GRANT, granting } from './dispatch.ts'

let setup = async (k: Kernel) => {
  let space = `pace${crypto.randomUUID().slice(0, 8)}`
  let owner = await seed(k, [{ slug: space, apps: ['world'] }])
  let agent = connector(k, owner.cookie)
  let at = { space, app: 'world' }
  await agent.tool('app_set', { ...at, access: 'open' })
  await agent.tool('app_files', {
    ...at,
    files: [{
      path: 'vocab.json',
      content: JSON.stringify({
        $defs: {
          position: {
            component: true,
            type: 'object',
            pace: '1m',
            properties: { x: { type: 'number' } },
          },
        },
      }),
    }],
  })
  await agent.tool('app_deploy', at)
  let [row] = await meta(k).query(
    `.entity.eid=${owner.eids[`${space}/world`]}&?app`,
  )
  let store = (row.app as { store?: string }).store
  assert(typeof store == 'string')
  return { owner, agent, at, store, host: `${space}.${k.host}` }
}

let session = async (k: Kernel, person: string, via: string) =>
  `${COOKIE}=${await sign({
    person,
    space: null,
    via,
    exp: Math.floor(Date.now() / 1000) + SESSION,
  }, k.secret)}`

let move = (eid: string, x: number): Bundle => ({
  entity: { eid },
  position: { x },
})
let paced = async (response: Response) => {
  assertEquals(response.status, 429, await response.clone().text())
  await response.body?.cancel()
}
let visible = (rows: object[]) => {
  for (let row of rows) {
    assert(!('_pace' in row), 'internal pace clocks stay in the store')
  }
}
let idOf = (v: unknown): string | undefined =>
  typeof v == 'string' ? v : (v as { eid?: string } | null)?.eid

test('stored pacing separates entities and sealed vias, keeps earlier writers, and ignores claimed vias', async () => {
  let k = await kernel()
  try {
    let { owner, agent, at, store, host } = await setup(k)
    let via = crypto.randomUUID()
    let cookie = await session(k, owner.person, via)
    let page = client(k, host, 'world', cookie)
    let another = client(
      k,
      host,
      'world',
      await session(k, owner.person, crypto.randomUUID()),
    )
    let eid = crypto.randomUUID()
    let saved = await page.applied([move(eid, 1)])
    visible(saved)
    let made = saved.find((r) => r.entity.eid == eid)!
    assertEquals(made.position, { x: 1 })
    assert(made.created, 'the public creation stamp still reaches the caller')
    await paced(await page.post([move(eid, 2)]))

    // This is the same person through another verified instrument. It may
    // write the row immediately, without erasing the first instrument's pace.
    await another.applied([move(eid, 3)])
    await paced(await page.post([move(eid, 4)]))
    await paced(await another.post([move(eid, 4)]))

    let person = await signIn(k)
    await agent.tool('member_add', {
      space: at.space,
      email: person.email,
      role: 'owner',
    })
    await accepted(k, person.email, person.cookie)
    let same = client(k, host, 'world', await session(k, person.person, via))
    await paced(await same.post([move(eid, 5)]))

    let forged = await k.at(host, '/world/api/apply', {
      method: 'POST',
      headers: {
        cookie,
        'x-via': crypto.randomUUID(),
        'x-yak-via': crypto.randomUUID(),
      },
      body: JSON.stringify([{
        ...move(eid, 6),
        $actor: { by: person.person, via: crypto.randomUUID() },
      }]),
    })
    await paced(forged)
    assertEquals((await page.get(`.entity.eid=${eid}&?position`))[0].position, {
      x: 3,
    })
    for (let query of [`.entity.eid=${eid}`, `.entity.eid=${eid}&*`]) {
      let rows = await page.get(query)
      visible(rows)
      assertEquals(rows[0].position, { x: 3 })
    }
    let stamped = await page.get(`.entity.eid=${eid}&*&?created&?updated`)
    visible(stamped)
    assert(
      stamped[0].created && stamped[0].updated,
      'requested public stamps still reach the caller',
    )

    // A different entity has its own pace, including when several are written
    // together by one instrument.
    let envelopeEid = crypto.randomUUID()
    let envelope = await page.applied({ entities: [move(envelopeEid, 7)] })
    assertEquals(envelope.ok, true)
    visible(envelope.bundles)
    let enveloped = envelope.bundles.find((r) => r.entity.eid == envelopeEid)!
    assertEquals(enveloped.position, { x: 7 })
    assert(
      enveloped.created,
      'the legacy envelope still includes the public stamp',
    )
    let batch = [move(crypto.randomUUID(), 8), move(crypto.randomUUID(), 9)]
    await page.applied(batch)
    await paced(await page.post([{ ...batch[0], position: { x: 10 } }]))

    await agent.tool('app_deploy', at)
    await paced(await page.post([move(eid, 11)]))

    // A browser that keeps sending its original signed-in cookie from before
    // vias existed cannot gain a fresh pace on each request.
    let oldCookie = `${COOKIE}=${await sign({
      person: owner.person,
      space: null,
      exp: Math.floor(Date.now() / 1000) + SESSION,
    }, k.secret)}`
    let oldPage = client(k, host, 'world', oldCookie)
    let oldRow = crypto.randomUUID()
    await oldPage.applied([move(oldRow, 1)])
    await paced(await oldPage.post([move(oldRow, 2)]))
    let otherOld = `${COOKIE}=${await sign({
      person: owner.person,
      space: null,
      exp: Math.floor(Date.now() / 1000) + SESSION + 1,
    }, k.secret)}`
    assert(otherOld != oldCookie)
    await client(k, host, 'world', otherOld).applied([move(oldRow, 3)])
    await paced(await oldPage.post([move(oldRow, 4)]))

    // Older app-worker grants still answer, each with a stable instrument
    // derived from the verified credential when it names no via itself.
    let legacyRow = crypto.randomUUID()
    let token = (person: string) =>
      granting(k.secret, store, {
        person,
        role: 'owner',
      })
    let legacy = await token(owner.person)
    let second = await token(person.person)
    let granted = (grant: string, x: number) =>
      k.at(host, '/world/api/apply', {
        method: 'POST',
        headers: { [GRANT]: grant },
        body: JSON.stringify([move(legacyRow, x)]),
      })
    let first = await granted(legacy, 1)
    assertEquals(first.status, 200, await first.text())
    await paced(await granted(legacy, 2))
    let independent = await granted(second, 3)
    assertEquals(independent.status, 200, await independent.text())
    await paced(await granted(legacy, 4))
  } finally {
    await k.stop()
  }
})

test('a guest pace survives signing in and the adoption of its unsigned stamps', async () => {
  let k = await kernel()
  try {
    let { host } = await setup(k)
    let eid = crypto.randomUUID()
    let first = await client(k, host, 'world').post([move(eid, 1)])
    assertEquals(first.status, 200, await first.text())
    let cookie = (first.headers.get('set-cookie') ?? '').split(';')[0]
    let browser = await browserOf(
      new Request(`https://${host}/`, { headers: { cookie } }),
      k.secret,
    )
    assert(browser)
    let page = client(k, host, 'world', cookie)
    await paced(await page.post([move(eid, 2)]))
    let person = await signIn({
      ...k,
      at: (host, path, init = {}) =>
        k.at(host, path, {
          ...init,
          headers: { ...init.headers as Record<string, string>, cookie },
        }),
    })
    let signed = await browserOf(
      new Request(`https://${host}/`, { headers: { cookie: person.cookie } }),
      k.secret,
    )
    assertEquals(signed?.via, browser.via)
    await until(async () => {
      let [row] = await page.get(`.entity.eid=${eid}&?created`)
      return idOf((row.created as { by?: unknown }).by) == person.person
    }, { timeout: 5000, label: 'guest position adopted after sign-in' })
    await paced(
      await client(k, host, 'world', person.cookie).post([move(eid, 3)]),
    )
    assertEquals((await page.get(`.entity.eid=${eid}&?position`))[0].position, {
      x: 1,
    })
    await client(k, host, 'world', person.cookie).applied([
      move(crypto.randomUUID(), 4),
    ])
  } finally {
    await k.stop()
  }
})
