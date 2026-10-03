import { test } from '@yaks/testing'
import { assert, assertEquals, assertMatch } from '@std/assert'
import { bearerFor, connector, kernel, meta, signIn } from './probe.ts'
import { browserOf } from './session.ts'
import { HELLO } from './mcp-probe.ts'
import { granting } from './dispatch.ts'

let eid = (value: unknown) =>
  typeof value == 'string' ? value : (value as { eid?: string })?.eid

test('MCP sessions have vouched instruments, while old and forged ids keep their credential instrument', async () => {
  let k = await kernel()
  try {
    let owner = await signIn(k)
    let agent = connector(k, owner.cookie)
    await agent.tool('app_new', { slug: 'notes', title: 'Notes' })
    let host = `${owner.email.split('@')[0]}.${k.host}`
    let rpc = (
      method: string,
      params: unknown,
      session = '',
      cookie = owner.cookie,
      bearer?: string,
    ) =>
      k.at(k.host, '/mcp', {
        method: 'POST',
        headers: {
          cookie,
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          'content-type': 'application/json',
          'mcp-session-id': session,
          'x-via': 'forged',
          'x-yak-via': 'forged',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
    let initialized = async (cookie = owner.cookie) => {
      let res = await rpc('initialize', HELLO, '', cookie)
      assertEquals(res.status, 200)
      await res.body?.cancel()
      return res.headers.get('mcp-session-id')!
    }
    let read = async (id: string) => {
      let res = await k.at(
        host,
        `/notes/api/query?.entity.eid=${id}&?doc&?created`,
        { headers: { cookie: owner.cookie } },
      )
      assertEquals(res.status, 200)
      let [row] = await res.json()
      assert(row?.created, JSON.stringify(row))
      return eid(row.created.via)
    }
    let wrote = async (session: string, bearer?: string) => {
      let id = crypto.randomUUID()
      let res = await rpc(
        'tools/call',
        {
          name: 'graph_apply',
          arguments: {
            app: 'notes',
            entities: [{ entity: { eid: id }, doc: { title: 'A note' } }],
          },
        },
        session,
        bearer ? '' : owner.cookie,
        bearer,
      )
      assertEquals(res.status, 200)
      let out = await res.json()
      assert(!out.error && !out.result.isError, JSON.stringify(out))
      return await read(id)
    }
    let first = await initialized()
    let second = await initialized()
    assertMatch(first, /^probe~/)
    assert(first != second)
    let a = await wrote(first)
    let b = await wrote(second)
    assert(a && b && a != b)
    assertEquals(await wrote(first), a)
    let browser = await browserOf(
      new Request('https://yaks.app', {
        headers: { cookie: owner.cookie },
      }),
      k.secret,
    )
    assert(browser)
    for (let old of ['probe~an-old-id', `${first}tampered`, '']) {
      assertEquals(await wrote(old), browser.via)
    }
    let other = await signIn(k)
    assertEquals(await wrote(await initialized(other.cookie)), browser.via)
    let anonymous = await rpc(
      'tools/call',
      {
        name: 'graph_apply',
        arguments: { app: 'notes', entities: [] },
      },
      first,
      '',
    )
    assertEquals(anonymous.status, 401)
    await anonymous.body?.cancel()

    // A verified machine credential keeps one instrument at the app API,
    // and the same instrument when a legacy MCP caller names no session.
    let oauth = await bearerFor(k, owner.cookie)
    let grant = /yak login (\S+)/.exec(await agent.tool('grant'))![1]
    for (let token of [oauth, grant]) {
      let who = await k.at(host, '/notes/api/me', {
        headers: { authorization: `Bearer ${token}` },
      })
      assertEquals(who.status, 200)
      let caller = await who.json()
      assert(caller.via)
      assertEquals(await wrote('', token), caller.via)
      let id = crypto.randomUUID()
      let posted = await k.at(host, '/notes/api/apply', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-via': 'forged',
          'x-yak-via': 'forged',
        },
        body: JSON.stringify([{
          entity: { eid: id },
          doc: { title: 'Machine' },
        }]),
      })
      assertEquals(posted.status, 200, await posted.clone().text())
      await posted.body?.cancel()
      assertEquals(await read(id), caller.via)
    }
  } finally {
    await k.stop()
  }
})

test('a forged worker grant cannot make an unsigned guest write, and valid callbacks never replace a browser cookie', async () => {
  let k = await kernel()
  try {
    let owner = await signIn(k)
    let agent = connector(k, owner.cookie)
    let made = await agent.answer('app_new', {
      slug: 'notes',
      title: 'Notes',
      access: 'open',
    })
    let space = owner.email.split('@')[0]
    let host = `${space}.${k.host}`
    let id = crypto.randomUUID()
    let post = (headers: Record<string, string>) =>
      k.at(host, '/notes/api/apply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-via': 'forged',
          'x-yak-via': 'forged',
          ...headers,
        },
        body: JSON.stringify([{
          entity: { eid: id },
          doc: { title: 'Guest' },
        }]),
      })
    let forged = await post({ 'x-yak-grant': 'garbage' })
    assertEquals(forged.status, 401)
    await forged.body?.cancel()
    let guest = await post({})
    assertEquals(guest.status, 200)
    await guest.body?.cancel()
    let cookie = guest.headers.get('set-cookie')!.split(';')[0]
    let browser = await browserOf(
      new Request('https://yaks.app', {
        headers: { cookie },
      }),
      k.secret,
    )
    assert(browser && browser.via != 'forged')
    let read = await k.at(
      host,
      `/notes/api/query?.entity.eid=${id}&?doc&?created`,
      { headers: { cookie } },
    )
    assertEquals(read.status, 200)
    let [row] = await read.json()
    assertEquals(eid(row.created.via), browser.via)
    assert(!row.created.by)
    let [app] = await meta(k).query(
      `.entity.eid=${(made.value as { eid: string }).eid}&?app`,
    )
    let store = (app.app as { store?: string } | undefined)?.store
    assert(typeof store == 'string')
    let token = await granting(k.secret, store, {
      person: null,
      role: null,
      via: browser.via,
    })
    let callback = await post({ 'x-yak-grant': token })
    assertEquals(callback.status, 200)
    assertEquals(callback.headers.get('set-cookie'), null)
    await callback.body?.cancel()
  } finally {
    await k.stop()
  }
})
