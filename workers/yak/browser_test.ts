// Guest writes go through the kernel's sealed browser instrument, and signing
// in adopts that browser's unsigned stamps across the stores it wrote to.
import { test, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  client,
  connector,
  type Kernel,
  kernel,
  seed,
  signIn,
  vocabFile,
} from './probe.ts'
import { COOKIE, sign, verify } from './lib/token.ts'
import { browserOf, SESSION } from './session.ts'

type Row = Record<string, Record<string, unknown> | undefined>

let idOf = (v: unknown): string | undefined =>
  typeof v == 'string' ? v : (v as { eid?: string } | null)?.eid

let setup = async (k: Kernel, apps: string[]) => {
  let space = `browser${crypto.randomUUID().slice(0, 8)}`
  let owner = await seed(k, [{ slug: space, apps }])
  let agent = connector(k, owner.cookie)
  for (let app of apps) {
    let at = { space, app }
    await agent.tool('app_set', { ...at, access: 'open' })
    await agent.tool('app_files', {
      ...at,
      files: [{
        path: 'vocab.json',
        content: vocabFile({}, {
          note: {
            description: 'Keep a note',
            input: { title: { type: 'string' } },
            required: ['title'],
            apply: { entity: { eid: '$note' }, doc: { title: '$title' } },
          },
        }),
      }],
    })
    await agent.tool('app_deploy', at)
  }
  return { owner, host: `${space}.${k.host}` }
}

let kept = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0]
let instrument = async (k: Kernel, cookie: string) => {
  let browser = await browserOf(
    new Request(`https://${k.host}/`, { headers: { cookie } }),
    k.secret,
  )
  assert(browser, 'the kernel sealed a browser instrument')
  return browser.via
}

let row = async (page: ReturnType<typeof client>, eid: string) =>
  (await page.get(`.entity.eid=${eid}&?doc&?created&?updated`))[0] as
    | Row
    | undefined

// Keep the guest cookie on both code-card requests, through the same sign-in
// helper every kernel probe uses. The cookie returned by the code door becomes
// the signed-in session; the preceding browser seal stays good as a guest.
let signedIn = (k: Kernel, cookie: string) =>
  signIn({
    ...k,
    at: (host, path, init = {}) =>
      k.at(host, path, {
        ...init,
        headers: { ...init.headers as Record<string, string>, cookie },
      }),
  })

test('guest writes and commands belong only to the sealed browser, never a claimed actor', async () => {
  let k = await kernel()
  try {
    let { owner, host } = await setup(k, ['notes'])
    let eid = crypto.randomUUID()
    let first = await client(k, host, 'notes').post([{
      entity: { eid },
      doc: { title: 'Guest note' },
      $actor: { by: owner.person, via: 'invented' },
    }])
    assertEquals(first.status, 200, await first.text())
    let cookie = kept(first)
    let via = await instrument(k, cookie)
    assertEquals(await verify(cookie.slice(COOKIE.length + 1), k.secret), null)
    let page = client(k, host, 'notes', cookie)
    let made = (await row(page, eid))!
    assertEquals(made.doc?.title, 'Guest note')
    assertEquals(idOf(made.created?.by), undefined)
    assertEquals(idOf(made.created?.via), via)
    assert(typeof made.created?.at == 'string')

    await page.applied({
      entities: [{ entity: { eid }, doc: { title: 'Edited' } }],
    })
    let edited = (await row(page, eid))!
    assertEquals(idOf(edited.updated?.by), undefined)
    assertEquals(idOf(edited.updated?.via), via)

    let second = await k.at(host, '/notes/api/query?.doc')
    assertEquals(second.status, 200)
    let stranger = kept(second)
    await second.body?.cancel()
    assert(await instrument(k, stranger) != via)
    for (
      let headers of [
        { cookie: stranger },
        {
          cookie: stranger,
          'x-via': via,
          'x-yak-via': via,
          'x-yak-person': owner.person,
        },
      ]
    ) {
      for (
        let change of [
          { entity: { eid }, doc: { title: 'Stolen' } },
          { entity: { eid }, $delete: true },
        ]
      ) {
        let no = await k.at(host, '/notes/api/apply', {
          method: 'POST',
          headers: new Headers(headers as Record<string, string>),
          body: JSON.stringify([{
            ...change,
            $actor: { by: owner.person, via },
          }]),
        })
        assert(no.status == 400 || no.status == 403, await no.text())
      }
    }
    assertEquals((await row(page, eid))?.doc?.title, 'Edited')

    let commanded = await k.at(host, '/notes/api/command', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'note', args: { title: 'Command note' } }),
    })
    assertEquals(commanded.status, 200)
    let answer = await commanded.json()
    let commandRow = (await row(page, answer.value.aliases.$note))!
    assertEquals(idOf(commandRow.created?.by), undefined)
    assertEquals(idOf(commandRow.created?.via), via)

    await page.applied([{ entity: { eid }, $delete: true }])
    assertEquals(await row(page, eid), undefined)

    // A current session lacking the new via still authenticates and is renewed
    // as that same person. The original credential keeps answering too.
    let old = `${COOKIE}=${await sign({
      person: owner.person,
      space: null,
      exp: Math.floor(Date.now() / 1000) + SESSION,
    }, k.secret)}`
    for (let i = 0; i < 2; i++) {
      let read = await k.at(host, '/notes/api/me', { headers: { cookie: old } })
      assertEquals(read.status, 200)
      let me = await read.json()
      assertEquals(me.person, owner.person)
      let claims = await verify(kept(read).slice(COOKIE.length + 1), k.secret)
      assertEquals(claims?.person, owner.person)
      assert(claims?.via)
    }
  } finally {
    await k.stop()
  }
})

test('sign-in fills only missing stamps from that browser in every store it wrote to', async () => {
  let k = await kernel()
  try {
    let { owner, host } = await setup(k, ['first', 'second'])
    let opening = await k.at(host, '/first/api/query?.doc')
    assertEquals(opening.status, 200)
    let cookie = kept(opening)
    await opening.body?.cancel()
    let via = await instrument(k, cookie)
    let other = await k.at(host, '/first/api/query?.doc')
    let otherCookie = kept(other)
    await other.body?.cancel()
    let rows: {
      page: ReturnType<typeof client>
      eid: string
      before: Row
    }[] = []
    for (let app of ['first', 'second']) {
      let page = client(k, host, app, cookie)
      let eid = crypto.randomUUID()
      await page.applied([{ entity: { eid }, doc: { title: app } }])
      await page.applied([{ entity: { eid }, doc: { body: 'Guest edit' } }])
      rows.push({ page, eid, before: (await row(page, eid))! })
    }
    let first = rows[0].page
    let untouched = crypto.randomUUID()
    await client(k, host, 'first', otherCookie).applied([{
      entity: { eid: untouched },
      doc: { title: 'Another browser' },
    }])
    let otherBefore = await row(first, untouched)

    // Matching via never overwrites a by that was already supplied. Both stamps
    // on this row have an author, even though they name the guest instrument.
    let authored = crypto.randomUUID()
    let authoredCookie = `${COOKIE}=${await sign({
      person: owner.person,
      space: null,
      via,
      exp: Math.floor(Date.now() / 1000) + SESSION,
    }, k.secret)}`
    let author = client(k, host, 'first', authoredCookie)
    await author.applied([{
      entity: { eid: authored },
      doc: { title: 'Authored' },
    }])
    await author.applied([{
      entity: { eid: authored },
      doc: { body: 'Authored edit' },
    }])
    let authoredBefore = await row(first, authored)
    assertEquals(idOf(authoredBefore?.created?.by), owner.person)

    // One row can retain another person's last edit while its guest creation
    // acquires the signing-in person's author.
    let shared = crypto.randomUUID()
    await first.applied([{
      entity: { eid: shared },
      doc: { title: 'Guest creation' },
    }])
    await author.applied([{
      entity: { eid: shared },
      doc: { body: 'Owner edit' },
    }])
    let sharedBefore = (await row(first, shared))!

    let person = await signedIn(k, cookie)
    assertEquals(await instrument(k, person.cookie), via)
    await until(async () => {
      let current = await Promise.all(
        rows.map(({ page, eid }) => row(page, eid)),
      )
      return current.every((r) =>
        idOf(r?.created?.by) == person.person &&
        idOf(r?.updated?.by) == person.person
      )
    }, { timeout: 5000, label: 'guest stamps adopted in both app stores' })
    for (let { page, eid, before } of rows) {
      let adopted = (await row(page, eid))!
      for (let stamp of ['created', 'updated']) {
        assertEquals(idOf(adopted[stamp]?.by), person.person)
        assertEquals(adopted[stamp]?.at, before[stamp]?.at)
        assertEquals(idOf(adopted[stamp]?.via), via)
      }
      await client(k, host, page == first ? 'first' : 'second', person.cookie)
        .applied([{ entity: { eid }, doc: { body: 'Signed-in edit' } }])
    }
    assertEquals(await row(first, untouched), otherBefore)
    assertEquals(await row(first, authored), authoredBefore)
    let sharedAfter = (await row(first, shared))!
    assertEquals(idOf(sharedAfter.created?.by), person.person)
    assertEquals(sharedAfter.created?.at, sharedBefore.created?.at)
    assertEquals(sharedAfter.created?.via, sharedBefore.created?.via)
    assertEquals(sharedAfter.updated, sharedBefore.updated)

    // Taking a signed-in cookie does not revoke the prior guest seal. It can
    // still add, but its via no longer owns the now-authored rows.
    assertEquals(await instrument(k, cookie), via)
    let no = await first.post([{
      entity: { eid: rows[0].eid },
      doc: { title: 'Guest again' },
    }])
    assert(no.status == 400 || no.status == 403, await no.text())
    let another = await k.at(host, '/first/api/command', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ name: 'note', args: { title: 'After sign-in' } }),
    })
    assertEquals(another.status, 200, await another.clone().text())
    let made = await another.json()
    await until(
      async () =>
        idOf((await row(first, made.value.aliases.$note))?.created?.by) ==
          person.person,
      { timeout: 5000, label: 'later guest command attributed' },
    )
  } finally {
    await k.stop()
  }
})
