// The identity part, through the whole kernel (probe.ts `kernel`): a person
// signs in by receiving mail, the browser carries the platform cookie into an
// app, the first person ever owns the meta space, a mistyped code is refused
// softly — and an agent walks the whole OAuth 2.1 flow, from a client that
// registers itself to a bearer token that resolves to the same person.
//
// The stand-in mail provider writes each letter the directory's pool sends on
// the Worker's log (probe.ts `letters`), which is where the test reads its own
// code. Nothing here knows the code before the kernel mails it. The
// directory itself is read back through the MCP graph tier as the owner of
// `yak` — the one door into the meta store (probe.ts `meta`, T-32585).
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import { parseHTML } from 'linkedom'
import { equal, ok, test, until } from '@yaks/testing'
import { challenge } from '@yaks/oauth'
import {
  agentsAt,
  allowed,
  connector,
  disconnectAgent,
  fresh,
  type Kernel,
  kernel,
  letter,
  letters,
  mailed,
  meta,
  owned,
  saveAccount,
  signIn,
  spaceAct,
  unique,
} from './probe.ts'
import { COOKIE, cookieValue, sign, verify } from './lib/token.ts'
import { SENDS } from './signin.ts'
import { NO_MAILBOX, NOT_EMAIL } from './identity.ts'
import { ours } from './asking.ts'
import { managePath, REACH, TAB_PERSON } from '@yaks/platform/routes'
import { settingsEid as spaceEid } from '@yaks/platform/space-pages'
import { type Agent, AGENTS, agentsOf } from '@yaks/platform/agents'

// Styling and attribute order do not change the sign-in form's contract.
let emailCard = async (r: Response) => {
  assertEquals(r.status, 200)
  let { document } = parseHTML(await r.text())
  assert(
    document.querySelector(
      'form[method="post"][action="/login"] input[name="address"][type="email"][required]',
    ),
  )
}

let browsers = new WeakMap<Kernel, Map<string, string>>()
let form = async (
  k: Kernel,
  path: string,
  fields: Record<string, string>,
  cookie?: string,
) => {
  let jar = browsers.get(k) ?? new Map<string, string>()
  browsers.set(k, jar)
  let address = fields.address || fields.email
  let signing = path == '/login' || path == '/login/code'
  let on = cookie ?? (signing ? jar.get(address) : undefined)
  let res = await k.at('yaks.app', path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...on ? { cookie: on } : {},
    },
    body: new URLSearchParams(fields).toString(),
  })
  if (path == '/login' && cookie === undefined) {
    let kept = res.headers.getSetCookie().find((c) =>
      c.startsWith(`${COOKIE}=`)
    )
    if (kept) jar.set(address, kept.split(';')[0])
  }
  return res
}

// The agent case owns real OAuth grants seeded before timing reads and revocation.
let agentGrants = await (async () => {
  let k = await kernel()
  let owner = await signIn(k)
  let at = (
    host: string,
    path: string,
    headers: Record<string, string> = {},
  ) => k.at(host, path, { headers })
  let snapshots = async (): Promise<Agent[]> => (await agentsAt(k, owner))!
  assertEquals(await snapshots(), [])

  let authorize = async (back: string, name: string) => {
    let registered = await k.at('yaks.app', '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: name,
        redirect_uris: [back],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    assertEquals(registered.status, 201)
    let client_id = (await registered.json()).client_id
    let verifier = crypto.randomUUID() + crypto.randomUUID()
    let q = new URLSearchParams({
      response_type: 'code',
      client_id,
      redirect_uri: back,
      scope: 'graph',
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
    }).toString()
    let allow = await allowed(k, q, owner.cookie)
    assertEquals(allow.status, 302)
    await allow.body?.cancel()
    let code = new URL(allow.headers.get('location')!).searchParams.get(
      'code',
    )!
    let token = await form(k, '/oauth/token', {
      grant_type: 'authorization_code',
      client_id,
      redirect_uri: back,
      code,
      code_verifier: verifier,
    })
    assertEquals(token.status, 200)
    let tokens: { access_token: string; refresh_token: string } = await token
      .json()
    // An app's worker is never handed one (dispatch.ts `uncredited`).
    ok(ours(`Bearer ${tokens.access_token}`))
    ok(ours(`Bearer ${tokens.refresh_token}`))
    return { client_id, ...tokens }
  }
  let chatgpt = await authorize(
    'https://chatgpt.com/callback',
    'A web client',
  )
  let claude = await authorize(
    'https://claude.ai/callback',
    'Another web client',
  )
  let another = await authorize(
    'https://chatgpt.com/other-callback',
    'A second installation',
  )
  return { k, owner, at, snapshots, authorize, chatgpt, claude, another }
})()

test(
  'agents identify existing grants and belong to the signed-in browser',
  async () => {
    let { k, owner, at, snapshots, authorize, chatgpt, claude, another } =
      agentGrants
    try {
      assertEquals(await snapshots(), [
        { id: 'chatgpt', name: 'ChatGPT', brand: 'chatgpt' },
        { id: 'claude', name: 'Claude', brand: 'claude' },
      ])

      // Only a signed-in browser reads them, never an agent's bearer.
      let credentials: Record<string, string>[] = [
        {},
        { authorization: `Bearer ${chatgpt.access_token}` },
      ]
      for (let headers of credentials) {
        let res = await at(k.host, `${REACH}/query?q=${AGENTS}`, headers)
        await res.body?.cancel()
        assertEquals(res.status, 401)
      }
      let other = await signIn(k)
      assertEquals(await agentsAt(k, other), [])

      // Revoking one installation leaves another; removing its last grant
      // removes the agent on the next read, with no cache of agents.
      for (
        let [client, remaining] of [
          [chatgpt, ['chatgpt', 'claude']],
          [another, ['claude']],
          [claude, []],
        ] as const
      ) {
        let revoked = await form(k, '/oauth/token', {
          client_id: client.client_id,
          token: client.refresh_token,
          token_type_hint: 'refresh_token',
        })
        assertEquals(revoked.status, 200)
        await revoked.body?.cancel()
        assertEquals((await snapshots()).map((c) => c.id), [...remaining])
      }

      // Disconnecting is the signed-in person's: a bearer is refused and
      // another person's press reaches only their own grants. The one chosen
      // loses every installation, its tokens with them; the other agent keeps
      // its own.
      let web = await authorize('https://claude.ai/cb', 'Claude on the web')
      let com = await authorize('https://claude.com/cb', 'Claude again')
      let kept = await authorize('https://chatgpt.com/cb', 'ChatGPT')
      let disconnect = async (who: { person: string; cookie: string }) => {
        let res = await disconnectAgent(k, who, 'claude')
        assertEquals(res.status, 200)
        let [said, ...rows] = await res.json()
        return [said.disconnectAgent.said, agentsOf(rows)?.map((a) => a.id)]
      }
      let holds = async (token: string) => {
        let res = await at('yaks.app', '/oauth/me', {
          authorization: `Bearer ${token}`,
        })
        await res.body?.cancel()
        return res.status == 200
      }
      let bearer = await k.at(k.host, `${REACH}/apply`, {
        method: 'POST',
        headers: { authorization: `Bearer ${web.access_token}` },
        body: JSON.stringify([{ disconnectAgent: { agent: 'claude' } }]),
      })
      await bearer.body?.cancel()
      equal(bearer.status, 401)
      equal(await disconnect(other), ['Disconnected.', []])
      equal((await snapshots()).map((c) => c.id), ['chatgpt', 'claude'])
      equal(await disconnect(owner), ['Disconnected.', ['chatgpt']])
      equal((await snapshots()).map((c) => c.id), ['chatgpt'])
      equal(
        await Promise.all([web, com, kept].map((c) => holds(c.access_token))),
        [false, false, true],
      )
    } finally {
      await k.stop()
    }
  },
)

// A custom-domain login through the same kernel: visiting asks, clicking
// opens only that space, and a copied cookie cannot become account authority.
let customHandoff = async (k: Kernel, person: string, full: string) => {
  let slug = unique('handoff'), other = unique('outside')
  let them = {
    person,
    cookie: full,
    eids: { [slug]: crypto.randomUUID(), [other]: crypto.randomUUID() },
  }
  await meta(k).apply([slug, other].flatMap((name) => [
    {
      entity: { eid: them.eids[name] },
      space: { slug: name, store: name },
      doc: { title: name },
    },
    { member: { space: them.eids[name], person, role: 'owner' } },
    { app: { space: them.eids[name], slug: 'notes', access: 'private' } },
  ]))
  let host = `${slug}.example.com`
  await meta(k).apply([{
    hostname: {
      name: host,
      serves: them.eids[slug],
      stage: 'active',
      at: new Date().toISOString(),
    },
  }])
  let next = '/notes/?mode=preview#new/00000000-0000-4000-8000-000000000001'
  let back = `https://${host}${next}`
  let asked = await k.at(
    k.host,
    `/login?return=${encodeURIComponent(back)}`,
    {
      redirect: 'manual',
      headers: { cookie: them.cookie },
    },
  )
  equal(asked.status, 200)
  equal(asked.headers.get('location'), null)
  let { document } = parseHTML(await asked.text())
  let form = ok(
    document.querySelector('form[method="post"][action="/login/handoff"]'),
  )
  let fields = Object.fromEntries([...form.querySelectorAll('input[name]')]
    .map((
      input,
    ) => [input.getAttribute('name')!, input.getAttribute('value')!]))
  let click = (cookie: string, values = fields) =>
    k.at(k.host, '/login/handoff', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(values).toString(),
    })
  let forged = await click(them.cookie, { ...fields, consent: '' })
  equal(forged.status, 403)
  await forged.body?.cancel()
  let moved = await click(them.cookie, {
    ...fields,
    return: `https://${host}/other`,
  })
  equal(moved.status, 403)
  await moved.body?.cancel()
  let allowed = await click(them.cookie)
  equal(allowed.status, 303)
  let to = new URL(ok(allowed.headers.get('location')))
  await allowed.body?.cancel()
  // The token spent twice at once opens one session: the other is sent to
  // sign in again.
  let spends = await Promise.all(
    [0, 1].map(() =>
      k.at(host, to.pathname + to.search, { redirect: 'manual' })
    ),
  )
  let hand = ok(spends.find((r) => r.headers.get('set-cookie')))
  let lost = ok(spends.find((r) => r != hand))
  equal(lost.headers.get('set-cookie'), null)
  ok(ok(lost.headers.get('location')).includes('/login?return='))
  await lost.body?.cancel()
  equal(hand.status, 303)
  equal(hand.headers.get('location'), next)
  let set = ok(hand.headers.get('set-cookie'))
  ok(!set.includes('Domain='))
  let cookie = set.split(';')[0]
  equal(
    (await verify(ok(cookieValue(cookie)), k.secret))?.space,
    them.eids[slug],
  )
  await hand.body?.cancel()
  let status = async (
    host: string,
    path: string,
    cookie: string,
    want: number,
  ) => {
    let res = await k.at(host, path, {
      redirect: 'manual',
      headers: { cookie },
    })
    equal(
      res.status,
      want,
      path + ': ' + (await res.clone().text()).slice(0, 100),
    )
    await res.body?.cancel()
  }
  let identity = async (host: string, cookie: string) => {
    let res = await k.at(host, '/notes/api/who', { headers: { cookie } })
    let who = await res.json()
    return [who.person, who.role]
  }
  equal(await identity(host, cookie), [person, 'owner'])
  equal(await identity(`${slug}.yaks.app`, cookie), [person, 'owner'])
  let outside = await k.at(`${other}.yaks.app`, '/notes/api/who', {
    headers: { cookie },
  })
  equal((await outside.json()).person, null)
  await status(k.host, `${REACH}/query?q=${AGENTS}`, cookie, 401)
  await status(k.host, '/manage', cookie, 303)
  let denied = await connector(k, cookie).call('tools/call', {
    name: 'grant',
    arguments: {},
  })
  ok(denied.isError)
  let outsideRead = await connector(k, cookie).call('tools/call', {
    name: 'graph_query',
    arguments: { space: other, app: 'notes', query: '.doc' },
  })
  ok(outsideRead.isError)
  // Held full-account sessions retain the account and every existing seat.
  equal(await identity(`${other}.yaks.app`, them.cookie), [person, 'owner'])
  await status(k.host, `${REACH}/query?q=${AGENTS}`, them.cookie, 200)
}

test('a person signs in by mail, and an agent by OAuth', async () => {
  let k = await kernel()
  try {
    // The card asks for an address, and nothing else.
    let card = await k.at('yaks.app', '/login')
    await emailCard(card)

    // A code, asked for and mailed. The page says where it went and asks for
    // the code — and nothing else, of anybody, ever: signing up is the address
    // and then the code, and both other questions moved to the space page
    // (T-34236).
    let email = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`
    let sent = await form(k, '/login', { email })
    assertEquals(sent.status, 200)
    let asking = await sent.text()
    assertEquals(/what should we call you/i.test(asking), false)
    assertEquals(/name="space"/.test(asking), false)
    let code = await mailed(k, email)
    assertMatch(code, /^\d{6}$/)

    // A mistyped code is refused softly — a page in the same voice, and the
    // code it was guessing at still stands.
    let miss = String((Number(code) + 1) % 1_000_000).padStart(6, '0')
    let wrong = await form(k, '/login/code', { email, code: miss })
    assertEquals(wrong.status, 400)
    let refused = await wrong.text()
    assertMatch(refused, /expired or was mistyped/)

    // Nor is it a dead end: the page's other form asks again for the same
    // address, and a new code arrives without it being typed again.
    let again = [
      ...parseHTML(refused).document.querySelectorAll(
        'form[action="/login"] input[type="hidden"]',
      ),
    ].map((i) => [i.getAttribute('name')!, i.getAttribute('value')!])
    let before = letters(k, email).length
    let resent = await form(k, '/login', Object.fromEntries(again))
    assertEquals(resent.status, 200)
    code = await mailed(k, email, before)

    // The code itself: a session cookie for the whole platform. See Other,
    // because the form is not what to do next.
    let inn = await form(k, '/login/code', { email, code })
    assertEquals(inn.status, 303)
    // Sent from nowhere, they land on their own space — the signed-in home of
    // the platform, where attaching an assistant is one link away (T-34233) —
    // straight, with no /manage between to find it again (T-149706).
    assertEquals(
      inn.headers.get('location'),
      `https://yaks.app/${email.split('@')[0]}`,
    )
    let set = inn.headers.get('set-cookie') ?? ''
    assertMatch(set, /^yak_session=/)
    assertMatch(set, /Domain=yaks\.app/)
    assertMatch(set, /HttpOnly/)
    assertMatch(set, /SameSite=Lax/)
    let cookie = set.split(';')[0]
    // The first person ever to sign in owns the meta space, and the graph
    // tier is their door into it.
    let dir = meta(k)

    // Signing in is having a space (T-32482): one named for their address,
    // with them as its owner, so nothing ever asks them for a name.
    let [them] = await dir.query(
      `.person&.email.address=${encodeURIComponent(email)}&?doc`,
    )
    // And nothing asked what to call them, so the front of their address is
    // what they are called — written, so a member row names a person and not
    // an eid, and theirs to change on their own space page (T-34236).
    assertEquals(
      (them.doc as { title: string }).title,
      email.split('@')[0],
    )

    // And they sign in again on it. Asking while a code still stands leaves
    // that one standing (signin.ts mint), and spending any of them buries every
    // row the address has — the DELETE path the sign-in door takes, which a
    // store raised from an older schema refused for everyone who had ever asked
    // (T-32826).
    let received = letters(k, email).length
    let anew = await form(k, '/login', { email })
    assertEquals(anew.status, 200)
    await anew.body?.cancel()
    let opened = await form(k, '/login/code', {
      email,
      code: await mailed(k, email, received),
    })
    assertEquals(opened.status, 303)
    await opened.body?.cancel()

    let [theirs] = await dir.query(`.space.slug=${email.split('@')[0]}`)
    assert(theirs, `a space named for ${email}`)
    let [seat] = await dir.query(
      `.member.space=${theirs.entity.eid}&.member.person=${them.entity.eid}`,
    )
    assertEquals((seat.member as { role: string }).role, 'owner')

    // Somebody sent here from a page they could not use comes back to it
    // (T-32593). The address rides both cards as a hidden field, and only an
    // address on our own zone is followed — a stranger's is ignored.
    let comeback = async (back: string) => {
      let addr = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`
      let card = await k.at(
        'yaks.app',
        `/login?return=${encodeURIComponent(back)}`,
      )
      assertMatch(
        await card.text(),
        new RegExp(`name="return" value="${back}"`),
      )
      let asked = await form(k, '/login', { email: addr, return: back })
      let returning = await asked.text()
      assertMatch(
        returning,
        new RegExp(`name="return" value="${back}"`),
      )
      let r = await form(k, '/login/code', {
        email: addr,
        code: await mailed(k, addr),
        return: back,
      })
      assertMatch(r.headers.get('set-cookie') ?? '', /^yak_session=/)
      assertEquals(r.status, 303)
      return {
        to: r.headers.get('location'),
        home: `https://yaks.app/${addr.split('@')[0]}`,
      }
    }
    let notes = 'https://someone.yaks.app/notes/'
    assertEquals((await comeback(notes)).to, notes)
    let off = await comeback('https://elsewhere.example/notes/')
    assertEquals(off.to, off.home)

    // Spent: the same code opens nothing twice.
    assertEquals((await form(k, '/login/code', { email, code })).status, 400)

    // The person the address minted. The first sign-in ever owns the meta
    // space, which on this kernel was the run's own, before any test's.
    let [person] = await dir.query(
      `.person&.email.address=${encodeURIComponent(email)}`,
    )
    assert(person, 'a person for ' + email)
    let me = person.entity.eid
    let first = k.owner
    let [yak] = await dir.query('.space.slug=yak')
    let [ownership] = await dir.query(
      `.member.person=${first.person}&.member.space=${yak.entity.eid}`,
    )
    // The person a member row names answers with their name beside the eid
    // (T-32733); the space it names is not a person, so it stays an eid.
    assertEquals(ownership.member, {
      space: yak.entity.eid,
      person: { eid: first.person, name: first.name },
      role: 'owner',
    })

    // A code that is standing right now, as the store holds it: a mac, never
    // the digits (signin.ts). Reading the row — by any door there is — mints
    // nothing, and the mac itself opens nothing without the secret.
    let waiting = `waiting-${crypto.randomUUID().slice(0, 8)}@yaks.app`
    assertEquals((await form(k, '/login', { email: waiting })).status, 200)
    let live = await mailed(k, waiting)
    let [row] = await dir.query(
      `.signin.email=${encodeURIComponent(waiting)}`,
    )
    let held = (row.signin as { code: string; email: string }).code
    assertMatch(held, /^[0-9a-f]{64}$/)
    assert(!held.includes(live), 'the digits are nowhere in the row')
    // Its letter is the directory's row, as every platform letter is
    // (mail.ts), which its pool sent; the meta space's door is the only one
    // into it, so no app and nobody else who signs in reads the code there.
    let letter = `.mail.to=${encodeURIComponent(waiting)}`
    assertEquals((await dir.query(letter)).length, 1)
    let stranger = await signIn(k)
    let seen = await meta(k, stranger.cookie).query(letter).then(
      (rows) => rows?.length ?? 0,
      () => 0,
    )
    assertEquals(seen, 0)
    // What the stranger's ask reported is this test's, not a later one's.
    await k.flushReports()

    // The ceiling on letters (T-33020). Asking is unauthenticated, so an
    // address gets SENDS letters an hour and no more — and the ask over the
    // ceiling answers what an accepted one answers, to the byte, mailing
    // nothing. A refusal that showed would say somebody had been asking about
    // this address, which is more than this door ever tells.
    let bombed = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`
    let cards: string[] = []
    for (let i = 0; i <= SENDS; i++) {
      let r = await form(k, '/login', { email: bombed })
      cards.push(`${r.status}\n${await r.text()}`)
    }
    assertEquals(new Set(cards).size, 1, 'the refusal is the acceptance')
    // The log is the only witness that a letter went out, and it lags the
    // response that sent it, so a letter to a fresh address is the barrier:
    // one line per letter in the order they were sent, so once this one shows,
    // a fourth to `bombed` would have shown before it.
    let barrier = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`
    await (await form(k, '/login', { email: barrier })).body?.cancel()
    await mailed(k, barrier)
    let posted = letters(k, bombed)
    assertEquals(posted.length, SENDS)

    // And nobody is locked out by their own retrying: every code that went out
    // still opens the door, so a letter that arrived late is still worth
    // typing. Signing in ends the address's story, count and all — the next
    // ask mails again.
    let firstCode = /\b(\d{6})\b/.exec(posted[0].subject)?.[1] ?? ''
    let late = await form(k, '/login/code', { email: bombed, code: firstCode })
    assertEquals(late.status, 303)
    await late.body?.cancel()
    await (await form(k, '/login', { email: bombed })).body?.cancel()
    await until(() => letters(k, bombed).length > SENDS, {
      label: 'a letter after signing in cleared the count',
    })

    // The cookie is that person everywhere: an app route vouches for them.
    let space = unique('probe')
    await dir.apply([
      {
        entity: { eid: '$s' },
        doc: { title: 'probe' },
        space: {
          slug: space,
        },
      },
      { doc: { title: 'box' }, app: { slug: 'box', space: '$s' } },
      { member: { space: '$s', person: me, role: 'owner' } },
    ])
    let who = await (await k.at(`${space}.yaks.app`, '/box/api/graph', {
      headers: { cookie },
    })).json()
    assertEquals([who.person, who.role], [me, 'owner'])

    // The agent's door. Discovery first: the two metadata documents, and the
    // protected resource is /mcp.
    let as = await (await k.at(
      'yaks.app',
      '/.well-known/oauth-authorization-server',
    )).json()
    assertMatch(as.authorization_endpoint, /\/oauth\/authorize$/)
    assertMatch(as.token_endpoint, /\/oauth\/token$/)
    assertMatch(as.registration_endpoint, /\/oauth\/register$/)
    // Both ways to name a client are open, and the provider says so only
    // when the option and the `global_fetch_strictly_public` flag agree.
    assert(as.client_id_metadata_document_supported, 'CIMD advertised')
    let prm = await (await k.at(
      'yaks.app',
      '/.well-known/oauth-protected-resource/mcp',
    )).json()
    assertMatch(prm.resource, /\/mcp$/)
    assertEquals(prm.scopes_supported, ['graph'])

    // A client that names itself with a URL (CIMD) is looked up by fetching
    // that URL, not by looking in KV: a client_id nobody registered is no
    // longer refused out of hand, it is a document we went and asked for.
    // The document itself must be https, so no local server can stand in
    // for one — `.invalid` never resolves, which is the failure we can see.
    let doc = 'https://probe.invalid/client_metadata.json'
    let bare = await k.at(
      'yaks.app',
      `/oauth/authorize?response_type=code&client_id=${
        encodeURIComponent(doc)
      }&redirect_uri=https%3A%2F%2Fprobe.invalid%2Fcb`,
    )
    assertEquals(bare.status, 400)
    assertEquals(
      await bare.text(),
      `Could not read the client metadata document at ${doc}`,
    )

    // A client registers itself (RFC 7591) — what the Claude and ChatGPT
    // connectors do today.
    let back = 'https://probe.invalid/cb'
    let reg = await k.at('yaks.app', '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'A probing connector',
        redirect_uris: [back],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    assertEquals(reg.status, 201)
    let client_id = (await reg.json()).client_id
    assert(client_id, 'a registered client')

    // The consent page is the sign-in page: the browser already signed in
    // sees the client's name, its own address, and one button.
    let verifier = crypto.randomUUID() + crypto.randomUUID()
    let q = new URLSearchParams({
      response_type: 'code',
      client_id,
      redirect_uri: back,
      state: 'a-probe-state',
      scope: 'graph',
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
    }).toString()
    let linking = await form(k, '/login', { email, q, return: notes })
    assertEquals(linking.status, 200)
    await linking.body?.cancel()
    let consent = await k.at('yaks.app', `/oauth/authorize?${q}`, {
      headers: { cookie },
    })
    assertEquals(consent.status, 200)
    let page = await consent.text()
    assertMatch(page, /A probing connector/)
    assertMatch(page, new RegExp(email))

    // Allowing it hands the client its code, on the redirect it registered.
    let granted = await allowed(k, q, cookie)
    assertEquals(granted.status, 302)
    let to = new URL(granted.headers.get('location') ?? '')
    assertEquals(to.origin + to.pathname, back)
    assertEquals(to.searchParams.get('state'), 'a-probe-state')
    let auth = to.searchParams.get('code') ?? ''
    assert(auth, 'an authorization code')

    // The code becomes a bearer token, PKCE and all.
    let tok = await k.at('yaks.app', '/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: auth,
        client_id,
        redirect_uri: back,
        code_verifier: verifier,
      }).toString(),
    })
    assertEquals(tok.status, 200)
    let bearer = (await tok.json()).access_token
    assert(bearer, 'an access token')

    // And the token is the person: what withAuth answers for a bearer is
    // what it answers for the cookie.
    let mine = await k.at('yaks.app', '/oauth/me', {
      headers: { authorization: `Bearer ${bearer}` },
    })
    assertEquals(mine.status, 200)
    let said = await mine.json()
    assertEquals({ person: said.person, via: said.via }, {
      person: me,
      via: 'oauth',
    })
    // And until when: every credential says when it dies now (T-34385), so a
    // caller holding one can ask how long it has rather than finding out by
    // being refused.
    assert(said.until > Math.floor(Date.now() / 1000), 'the token expires')

    // And the connector door takes it: the bearer is the same person there,
    // which is the whole point of the OAuth half (mcp.ts `withAuth`).
    let rpc = await k.at('yaks.app', '/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'probe', version: '0' },
        },
      }),
    })
    assertEquals(rpc.status, 200)
    assert((await rpc.json()).result, 'the connector answered the bearer')

    // And the same token once it no longer verifies — one character of it
    // changed is what an expired, revoked or foreign one reads as, since every
    // one of them is a token the provider cannot find — is refused there, not
    // quietly handed the surface a stranger gets: 401, with the challenge that
    // sends the connector back through this flow (T-34344).
    let stale = await k.at('yaks.app', '/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bearer.slice(0, -1)}${
          bearer.endsWith('a') ? 'b' : 'a'
        }`,
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    })
    assertEquals(stale.status, 401)
    assertMatch(
      stale.headers.get('www-authenticate') ?? '',
      /resource_metadata=/,
    )
    await stale.body?.cancel()

    // And signing in lands where it landed before it: their own space is the
    // signed-in home either way, and attaching an assistant is something on
    // that page rather than a page in front of it (T-34233).
    await (await form(k, '/login', { email })).body?.cancel()
    let over = await form(k, '/login/code', {
      email,
      code: await mailed(k, email),
    })
    assertEquals(over.status, 303)
    assertEquals(
      over.headers.get('location'),
      `https://yaks.app/${email.split('@')[0]}`,
    )
    await over.body?.cancel()

    // Nobody gets the challenge that tells them where to sign in. The
    // connector answers a stranger some things now (preauth.ts, T-33030), so
    // this asks it for one of the person's own.
    for (
      let anon of [
        await k.at('yaks.app', '/oauth/me'),
        await k.at('yaks.app', '/mcp', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{"jsonrpc":"2.0","id":1,"method":"prompts/get",' +
            '"params":{"name":"make"}}',
        }),
      ]
    ) {
      assertEquals(anon.status, 401)
      assertMatch(
        anon.headers.get('www-authenticate') ?? '',
        /resource_metadata=/,
      )
    }
    await customHandoff(k, me, cookie)
  } finally {
    await k.stop()
  }
})

// An agent stays connected (T-34416). The owner: "the oauth should never
// expire" — so a connector holds its door until the person closes it, and the
// two ways it used to be closed for them are shut: a refresh token with an
// expiry, and a public client's refresh refused for carrying a `client_secret`
// it was never issued, which is what ChatGPT sends and what a person reads as
// "your connection has expired, reconnect it".
test('a connector keeps its door until the person closes it', async () => {
  let k = await kernel()
  try {
    let { cookie } = await signIn(k)
    let back = 'https://probe.invalid/cb'
    // Exactly what ChatGPT registers: a public client, no secret to hold.
    let open = await k.at('yaks.app', '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'A probing connector',
        redirect_uris: [back],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    let client_id = (await open.json()).client_id
    // And beside it one that did take a secret, so the leniency below can be
    // shown to be the public client's alone.
    let shut = await k.at('yaks.app', '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'A connector with a secret',
        redirect_uris: [back],
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    let closed = await shut.json()
    assert(closed.client_secret, 'the confidential client got a secret')

    let verifier = crypto.randomUUID() + crypto.randomUUID()
    let q = new URLSearchParams({
      response_type: 'code',
      client_id,
      redirect_uri: back,
      state: 's',
      scope: 'graph',
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
    }).toString()
    let granted = await allowed(k, q, cookie)
    let code = new URL(granted.headers.get('location') ?? '')
      .searchParams.get('code') ?? ''
    let token = (fields: Record<string, string>, auth?: string) =>
      k.at('yaks.app', '/oauth/token', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(auth ? { authorization: auth } : {}),
        },
        body: new URLSearchParams(fields).toString(),
      })
    let first = await token({
      grant_type: 'authorization_code',
      code,
      client_id,
      redirect_uri: back,
      code_verifier: verifier,
    })
    assertEquals(first.status, 200)
    let got = await first.json()
    assert(got.refresh_token, 'a refresh token to keep the door with')
    // A year, the nearest thing to never the library's integer TTL has: it
    // takes no value under a minute and has no word for forever. The ceiling
    // is written down here so a change to it is a change to this line.
    assertEquals(got.expires_in, 365 * 24 * 60 * 60)

    // Every way ChatGPT has been seen to spell the refresh, all one answer.
    // The bare one is the spec's; the other two carry a secret this client was
    // never issued, in the body and in the header, and are the same request.
    let again = async (fields: Record<string, string>, auth?: string) => {
      let r = await token({
        grant_type: 'refresh_token',
        refresh_token: got.refresh_token,
        ...fields,
      }, auth)
      assertEquals(r.status, 200, await r.clone().text())
      let next = await r.json()
      assert(next.access_token)
      // And the token it hands back is the person, at the door: the whole
      // point of refreshing is that the connector keeps working.
      let mine = await k.at('yaks.app', '/oauth/me', {
        headers: { authorization: `Bearer ${next.access_token}` },
      })
      assertEquals(mine.status, 200)
      return next.refresh_token as string
    }
    got.refresh_token = await again({ client_id })
    got.refresh_token = await again({ client_id, client_secret: '' })
    got.refresh_token = await again({ client_id, client_secret: 'invented' })
    got.refresh_token = await again(
      {},
      `Basic ${btoa(`${client_id}:invented`)}`,
    )

    // The leniency is the public client's and nobody else's: a client that
    // registered a secret still has to present the right one.
    let wrong = await token({
      grant_type: 'refresh_token',
      refresh_token: got.refresh_token,
      client_id: closed.client_id,
      client_secret: 'invented',
    })
    assertEquals(wrong.status, 401)
    assertEquals((await wrong.json()).error, 'invalid_client')
  } finally {
    await k.stop()
  }
})

// The card says the same whether or not a code was kept, so asking for one
// waits on no store: the code is kept and mailed behind the answer.
test('asking for a code waits on no store, and its letter still comes', async () => {
  let k = await kernel()
  let email = `${unique('ask')}@yaks.app`
  let card = await form(k, '/login', { email })
  await card.body?.cancel()
  equal(
    [card.status, /\bhops;dur=0\b/.test(card.headers.get('server-timing')!)],
    [200, true],
  )
  assertMatch(await mailed(k, email), /^\d{6}$/)
})

// The card answers before its letter goes, so a letter that never leaves is
// said at the card's own end, once known (M-16612), and reported: the
// directory's pool, which sent it, reports the failure (@yaks/mail
// `sending`), and the card says we were told. Nothing above it waits: the
// card's code box comes before its letter has gone.
test('a letter that never leaves is said on its own card, and reported', async () => {
  let k = await kernel()
  let email = `${unique('unsent')}@refused.invalid`
  let card = await form(k, '/login', { email })
  equal(card.status, 200)
  let page = card.body!.pipeThrough(new TextDecoderStream()).getReader()
  let first = (await page.read()).value!
  let rest = ''
  for (let part; !(part = await page.read()).done;) rest += part.value
  let never = /never left: .*the destination address is not allowed.*told/
  equal(
    [/name="code"/.test(first), never.test(first), never.test(rest)],
    [true, false, true],
  )
  let fine = await form(k, '/login', { email: `${unique('sent')}@yaks.app` })
  ok(!/never left/.test(await fine.text()), 'a letter that left says nothing')
})

// An address no provider takes a letter for is the person's typo: the card
// refuses it before any code is minted or letter sent, and nobody is told.
test('an address that is not one is refused on the card, before any send', async () => {
  let k = await kernel()
  // What earlier tests on the shared kernel reported is theirs.
  await k.flushReports()
  let before = k.reported.length
  for (let email of ['ana@books', 'ana@@x.example', 'Ana <ana@x.example>']) {
    let card = await form(k, '/login', { email })
    equal([card.status, (await card.text()).includes(NOT_EMAIL)], [400, true])
  }
  await k.flushReports()
  equal(k.reported.slice(before), [])
})

// Resend refusing the recipient of a code's letter (HTTP 422) is the
// person's address to fix: said on the card, and never a break reported.
test("a provider's refusal of the address is said on the card, not reported", async () => {
  let refusing = (url: string, init: RequestInit) =>
    new URL(url).pathname == '/emails'
      ? JSON.parse(String(init.body)).to.some((t: string) =>
          t.endsWith('@nomail.example')
        )
        ? Response.json({
          statusCode: 422,
          name: 'validation_error',
          message: 'Invalid `to` field. The email address needs to follow ' +
            'the `email@example.com` or `Name <email@example.com>` format.',
        }, { status: 422 })
        : Response.json({ id: crypto.randomUUID() })
      : Response.json({}, { status: 404 })
  // Its owner signs in through the stand-in mail first; then the deploy's
  // platform letters go through Resend, as production's do.
  let env: Record<string, unknown> = {}
  let k = await fresh({}, (e) => env = e as never)
  Object.assign(env, {
    MAIL_VIA: 'resend',
    RESEND_PLATFORM_TOKEN: 'a-token',
    RESEND_API: 'https://resend.test',
    MAIL_FETCH: (url: string, init: RequestInit) =>
      Promise.resolve(refusing(url, init)),
  })
  try {
    let card = await form(k, '/login', {
      email: `${unique('no')}@nomail.example`,
    })
    let page = await card.text()
    equal(
      [card.status, page.includes(NO_MAILBOX), /We have been told/.test(page)],
      [200, true, false],
    )
    await k.flushReports()
    equal(
      k.reported.filter((r) => JSON.stringify(r).includes('Undeliverable')),
      [],
    )
  } finally {
    await k.stop()
  }
})

// Every code comes in the Operator's letter, answered at the sign-up address,
// whether asked for on yaks.app or from yak.sh (D-138669), whose page the door
// takes with no cookie; any other page is still a stranger. Someone who has
// signed in before is greeted as met.
test("every code letter is the Operator's, and greets who is back", async () => {
  let k = await kernel()
  try {
    let ask = (origin: string, email: string) =>
      k.at('yaks.app', '/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          origin,
        },
        body: new URLSearchParams({ email }).toString(),
      })
    let email = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`
    let sent = await ask('https://yak.sh', email)
    assertEquals(sent.status, 200)
    assertEquals(sent.headers.get('access-control-allow-origin'), '*')
    await sent.body?.cancel()
    let got = await letter(k, email, 'just reply to this email')
    assertEquals(
      [got.name, got.replyTo, got.from],
      ['yaks.app Operator', 'signup@yaks.app', 'hello@bot.yak.sh'],
    )
    let forged = await ask('https://evil.example', email)
    assertEquals(forged.status, 403)
    await forged.body?.cancel()
    let first = letters(k, email).length
    await signIn(k, email)
    await signIn(k, email)
    let [mine, back] = letters(k, email).slice(first)
    for (let l of [mine, back]) {
      assertEquals([l.name, l.replyTo], [
        'yaks.app Operator',
        'signup@yaks.app',
      ])
    }
    assertMatch(mine.body, /^Hi, I'm your Operator/)
    assertMatch(back.body, /Welcome back/)
  } finally {
    await k.stop()
  }
})

// The sign-in box is for somebody signed out (T-34209). A browser carrying a
// session is never asked again: `GET /login` reads the cookie first and sends
// them on — to the page they were headed for when it is ours to send them to,
// and to where a fresh sign-in lands when it is nowhere or a stranger's, which
// is the same guard closing the same open redirect.
test('/login never draws the box for a browser already signed in', async () => {
  let k = await kernel()
  try {
    let get = (path: string, cookie?: string) =>
      k.at('yaks.app', path, {
        redirect: 'manual',
        headers: cookie ? { cookie } : {},
      })
    let sent = async (path: string, cookie: string) => {
      let r = await get(path, cookie)
      await r.body?.cancel()
      assertEquals(r.status, 303, path)
      return r.headers.get('location')
    }
    let aimed = (back: string) => `/login?return=${encodeURIComponent(back)}`
    let { cookie, person, name } = await signIn(k)
    let home = `https://yaks.app/${name}`

    // Aimed nowhere: their own space, which is where a fresh sign-in with no
    // return goes too.
    assertEquals(await sent('/login', cookie), home)

    // Aimed at a page of ours, spelled either way it is ever spelled: the
    // platform's own returns are bare paths, a card's may be an address.
    assertEquals(await sent(aimed('/recipes/'), cookie), '/recipes/')
    let notes = 'https://someone.yaks.app/notes/'
    assertEquals(await sent(aimed(notes), cookie), notes)

    // A stranger's address is nowhere we send anyone, however it is spelled.
    assertEquals(await sent(aimed('https://evil.example/'), cookie), home)
    assertEquals(await sent(aimed('//evil.example/'), cookie), home)

    // Several spaces, and the one they came in on wins: a space's own index
    // sends them here carrying its address, which is on our zone and followed.
    // Aimed at nothing, it is their first — the one their address names —
    // and never the newest (T-34233).
    let other = `garden-${crypto.randomUUID().slice(0, 8)}`
    await owned(k, person, other, 'Garden')
    let garden = `https://${other}.yaks.app/`
    assertEquals(await sent(aimed(garden), cookie), garden)
    assertEquals(await sent('/login', cookie), home)

    // Signed out, the card is what it always was.
    let card = await get('/login')
    await emailCard(card)
  } finally {
    await k.stop()
  }
})

// A space in the trash is still their space (erase.ts, T-34431): signing in
// mints nothing beside it, and where the code lands them is the one page that
// space serves — the owner's, with the button that brings it back. This is the
// half of the trash a person meets without ever being told about it.
test(
  'the code lands on the trash page when the only space is there',
  async () => {
    let k = await kernel()
    try {
      let them = await signIn(k)
      let slug = them.email.split('@')[0]
      // Straight off the web with no letter in hand: typing the name back is
      // the other way to confirm, and what it confirms is the trash — the erase
      // rides in a ticket the platform signed and nothing else (erase.ts).
      let shut = await form(
        k,
        `/space/${slug}/delete`,
        { confirm: slug },
        them.cookie,
      )
      assertEquals(shut.status, 200)
      assertStringIncludes(
        await shut.text(),
        `${slug}.yaks.app is in the trash`,
      )

      // The code again, and it sends them where it always sends them.
      let received = letters(k, them.email).length
      let asked = await form(k, '/login', { email: them.email })
      assertEquals(asked.status, 200)
      await asked.body?.cancel()
      let inn = await form(k, '/login/code', {
        email: them.email,
        code: await mailed(k, them.email, received),
      })
      assertEquals(inn.status, 303)
      assertEquals(
        inn.headers.get('location'),
        `https://yaks.app/${slug}`,
      )
      let cookie = (inn.headers.get('set-cookie') ?? '').split(';')[0]

      // That page identifies the retained space and offers its restore form.
      let there = await k.at(`${slug}.yaks.app`, '/', { headers: { cookie } })
      assertEquals(there.status, 404)
      let said = await there.text()
      assertStringIncludes(said, `${slug} is in the trash`)
      let { document } = parseHTML(said)
      let restore = document.querySelector('input[name=restore-space]')
      assertEquals(restore?.getAttribute('value'), slug)
      assertEquals(restore?.closest('form')?.getAttribute('method'), 'post')

      // One POST off that page and it is theirs again — no assistant, no script.
      let back = await k.at(`${slug}.yaks.app`, '/', {
        method: 'POST',
        redirect: 'manual',
        headers: {
          cookie,
          origin: `https://${slug}.yaks.app`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ 'restore-space': slug }).toString(),
      })
      assertEquals(back.status, 303)
      await back.body?.cancel()
      let now = await k.at(`${slug}.yaks.app`, '/', { headers: { cookie } })
      assertEquals(now.status, 200)
      await now.body?.cancel()
    } finally {
      await k.stop()
    }
  },
)

// The two questions the sign-in card stopped asking (T-34236), asked on the
// pages a sign-in now lands on instead: what to call them, and the address
// their apps live at. Both are written through the page graph's door
// (reach-door.ts), as Profile's and Settings' Save bars write them.
test('Profile saves the name, and Settings the address', async () => {
  let k = await kernel()
  let uniq = () => crypto.randomUUID().slice(0, 8)
  let read = async (path: string, cookie: string) =>
    await (await k.at('yaks.app', path, { headers: { cookie } })).text()
  try {
    let { cookie, email, person } = await signIn(k)
    let slug = email.split('@')[0]
    let dir = meta(k)

    // The pages, as their owner reads them: the address on the space's
    // Settings and the name signing in derived for them on their Profile,
    // both filled in and both theirs to change.
    assertMatch(
      await read(managePath('settings', slug), cookie),
      new RegExp(`name="space"[^>]*value="${slug}"`),
    )
    assertMatch(
      await read(managePath('profile'), cookie),
      new RegExp(`name="name"[^>]*value="${slug}"`),
    )

    // A stranger sees none of it, and nor does somebody signed in who is
    // nobody here.
    let out = await (await k.at(`${slug}.yaks.app`, '/')).text()
    assertEquals(/name="space"/.test(out), false)

    // Naming themselves: written on their own person row, so every byline an
    // app writes says it (T-32654).
    let named = await saveAccount(k, { person, cookie }, { name: 'Dana' })
    assertEquals(named.status, 200, await named.text())
    let [them] = await dir.query(`.entity.eid=${person}&?doc`)
    assertEquals((them.doc as { title: string }).title, 'Dana')

    // Cleared, the front of their address comes back: a person is always
    // called something, or a member row reads back as an eid (T-32733).
    await (await saveAccount(k, { person, cookie }, { name: '  ' })).body
      ?.cancel()
    let [quiet] = await dir.query(`.entity.eid=${person}&?doc`)
    assertEquals((quiet.doc as { title: string }).title, slug)

    // A taken address is refused in a sentence, and nothing has moved.
    let space = (await dir.query(`.space.slug=${slug}`))[0].entity.eid
    let move = (to: string, who = { person, cookie }) =>
      spaceAct(k, who, space, { spaceSettings: { slug: to } })
    let theirs = await signIn(k, `rex-${uniq()}@yaks.app`)
    let other = theirs.email.split('@')[0]
    let taken = await move(other)
    assertEquals(taken.status, 400)
    assertMatch((await taken.json()).message, /is taken/)

    // A badly shaped one says what an address is.
    let bad = await move('Not An Address')
    assertEquals(bad.status, 400)
    assertMatch(
      (await bad.json()).message,
      /lowercase letters, numbers and dashes/,
    )

    // And a free one moves the space, and its Settings answer at the new
    // address.
    let want = `dana-${uniq()}`
    let moved = await move(want)
    assertEquals(moved.status, 200, await moved.text())
    assert(
      (await dir.query(`.space.slug=${want}`)).length,
      `a space at ${want}`,
    )
    assertEquals(await dir.query(`.space.slug=${slug}`), [])
    assertMatch(
      await read(managePath('settings', want), cookie),
      new RegExp(`name="space"[^>]*value="${want}"`),
    )

    // Nobody but the owner may write it: a stranger is asked to sign in,
    // somebody else is refused, and nothing moves.
    let no = await move(`nope-${uniq()}`, { person, cookie: '' })
    assertEquals(no.status, 401)
    await no.body?.cancel()
    let rex = await signIn(k, `rex-${uniq()}@yaks.app`)
    let nobody = await move(`nope-${uniq()}`, rex)
    assertEquals(nobody.status, 403)
    await nobody.body?.cancel()
    assert((await dir.query(`.space.slug=${want}`)).length, 'still theirs')

    // And nor may their own cookie, carried by somebody else's page. Every
    // space is same-site with the apex, so `SameSite=Lax` lets the session
    // ride a write a space's page aims at the door; the origin check is what
    // does not (@yaks/platform/routes `guarded`).
    let forged = await k.at('yaks.app', `${REACH}/apply`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        origin: 'https://elsewhere.yaks.app',
        [TAB_PERSON]: person,
        cookie,
      },
      body: JSON.stringify([{
        entity: { eid: spaceEid(space) },
        spaceSettings: { space, slug: `taken-${uniq()}` },
      }]),
    })
    assertEquals(forged.status, 403)
    await forged.body?.cancel()
    assert((await dir.query(`.space.slug=${want}`)).length, 'still theirs')
  } finally {
    await k.stop()
  }
})

// `/connect` is the dashboard's Agents page, where a person hands this
// platform to the assistant they already talk to (T-32972). A stranger
// following a link to it is sent to sign in and lands there (T-34408).
test('/connect lands on the Agents page, after sign-in for a stranger', async () => {
  let k = await kernel()
  try {
    let hops = async (cookie = '') => {
      let seen: string[] = []
      let to = '/connect'
      for (;;) {
        seen.push(to)
        let r = await k.at('yaks.app', to, {
          redirect: 'manual',
          headers: { cookie },
        })
        let next = r.headers.get('location')
        if (!next) return { seen, page: await r.text() }
        await r.body?.cancel()
        let at = new URL(next, 'https://yaks.app')
        to = at.pathname + at.search
      }
    }
    let stranger = await hops()
    assertEquals(stranger.seen.slice(0, 2), ['/connect', managePath('agents')])
    let login = stranger.seen.at(-1)!
    assertEquals(new URL(login, 'https://x').pathname, '/login')
    assertStringIncludes(
      new URL(login, 'https://x').searchParams.get('return')!,
      managePath('agents'),
    )
    let { cookie } = await signIn(k)
    let { seen, page } = await hops(cookie)
    assertEquals(seen, ['/connect', managePath('agents')])
    assertMatch(page, /https:\/\/yaks\.app\/mcp/)
    assertMatch(page, /claude mcp add --transport http yaks/)
  } finally {
    await k.stop()
  }
})

// The OAuth settings the connect page teaches (T-34414), against the two
// documents the authorization server actually serves. The page tells a person
// what to put in a connector form; if it ever named an address the door does
// not answer, the person would be stuck with no way to tell which of the two
// was lying. So both are read here from one kernel and compared. It lives
// beside the identity part rather than in site_test.ts because the connect
// page is the kernel's own (pages.ts), not one of the static ones.
test(
  'the connect page teaches the OAuth settings the door serves',
  async () => {
    let k = await kernel()
    try {
      let { cookie } = await signIn(k)
      let page = await (await k.at('yaks.app', managePath('agents'), {
        headers: { cookie },
      })).text()
      let as = await (await k.at(
        'yaks.app',
        '/.well-known/oauth-authorization-server',
      )).json()
      // Every endpoint the page names is the one the metadata names — compared
      // by path, since the probe kernel is not at the platform's hostname.
      for (
        let [said, at] of [
          ['authorize', as.authorization_endpoint],
          ['token', as.token_endpoint],
          ['register', as.registration_endpoint],
        ] as const
      ) {
        assertEquals(new URL(at).pathname, `/oauth/${said}`)
        assertStringIncludes(
          page,
          `<code>https://yaks.app/oauth/${said}</code>`,
        )
      }
      assertEquals(as.scopes_supported, ['graph'])
      assertStringIncludes(page, '<code>graph</code>')
      assertStringIncludes(page, 'https://yaks.app/mcp?auth=mixed')
      assertStringIncludes(page, 'https://yaks.app/mcp?auth=required')
    } finally {
      await k.stop()
    }
  },
)

// A new person's space is found or minted before the code's answer, which
// sends them straight to it (identity.ts `landed`, T-149706), and the rest of
// settling them goes on behind it: the page works right after the code, and
// they hold the one space.
test("a new person's first page works right after the code", async () => {
  let k = await kernel()
  try {
    let email = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`
    await (await form(k, '/login', { email })).body?.cancel()
    let inn = await form(k, '/login/code', {
      email,
      code: await mailed(k, email),
    })
    await inn.body?.cancel()
    let cookie = (inn.headers.get('set-cookie') ?? '').split(';')[0]
    let at = `https://yaks.app/${email.split('@')[0]}`
    let page = await k.at('yaks.app', new URL(at).pathname, {
      redirect: 'manual',
      headers: { cookie },
    })
    await page.body?.cancel()
    assertEquals([inn.headers.get('location'), page.status], [at, 200])
    await k.settled()
    let [them] = await meta(k).query(`.person&.email.address=${email}`)
    let seats = await meta(k).query(`.member.person=${them.entity.eid}`)
    assertEquals(seats.length, 1)
  } finally {
    await k.stop()
  }
})

// Somebody lands on their own space by the code's one trip: the write that
// spends it says where (facets/signin-graph.ts `landing`), new, back, or
// renamed, minting a new person theirs.
test('a code lands somebody on their own space in one trip', async () => {
  let k = await kernel()
  let email = `${unique('back')}@yaks.app`
  let code = async () => {
    await (await form(k, '/login', { email })).body?.cancel()
    let inn = await form(k, '/login/code', {
      email,
      code: await mailed(k, email),
    })
    await inn.body?.cancel()
    await k.settled()
    return [
      inn.headers.get('location'),
      inn.headers.get('server-timing')!.match(/\bhops;dur=(\d+)/)?.[1],
    ]
  }
  equal(await code(), [`https://yaks.app/${email.split('@')[0]}`, '1'])
  let [them] = await meta(k).query(`.person&.email.address=${email}`)
  let [space] = await k.dir.spaces(them.entity.eid)
  let renamed = unique('renamed')
  await k.dir.rename(space, { slug: renamed }, {
    'x-yak-person': them.entity.eid,
    'x-yak-role': 'owner',
  })
  equal(await code(), [`https://yaks.app/${renamed}`, '1'])
})

// One click instead of six digits (link.ts, T-34351), and the standing link an
// app directory's reviewer is given instead of a mailbox — OpenAI's review
// refuses any credential that needs one. Both are the same door and the same
// landing a typed code reaches; what tells them apart is how they die.
test('a link signs a person in, once or until it is revoked', async () => {
  let k = await kernel()
  try {
    // The letter's one click. The same code, said as a link.
    let email = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`
    let sent = await form(k, '/login', { email })
    assertEquals(sent.status, 200)
    await sent.body?.cancel()
    let click = (path: string) => k.at('yaks.app', path, { redirect: 'manual' })
    let where = (body: string) => {
      let url = /https:\/\/yaks\.app(\/login\/link\?t=\S+)/.exec(body)?.[1]
      assert(url, `a sign-in link in: ${body}`)
      return url
    }
    let one = where((await letter(k, email, 'sign in with one click')).body)

    // Opening it spends nothing (T-142867): a messaging app fetching it for a
    // preview, then the person, each get one button that carries the pass on.
    let press = ''
    for (let _ of [1, 2]) {
      let opened = await click(one)
      assertEquals(opened.status, 200)
      assertEquals(opened.headers.get('set-cookie'), null)
      press = /name="t" value="([^"]+)"/.exec(await opened.text())?.[1] ?? ''
    }
    assertEquals(press, new URL(one, 'https://yaks.app').searchParams.get('t'))
    let pressed = () => form(k, '/login/link', { t: press })

    // The press lands exactly where the code lands: their own space, with the
    // platform cookie — and it says nothing about where it came from, so the
    // pass never rides on to the next page in a Referer.
    let inn = await pressed()
    assertEquals(inn.status, 303)
    await inn.body?.cancel()
    assertEquals(
      inn.headers.get('location'),
      `https://yaks.app/${email.split('@')[0]}`,
    )
    assertEquals(inn.headers.get('referrer-policy'), 'no-referrer')
    let cookie = (inn.headers.get('set-cookie') ?? '').split(';')[0]
    assertMatch(cookie, /^yak_session=/)

    // Single use: the link was the code, and the code is spent. The card
    // again, and no session with it.
    let twice = await pressed()
    assertEquals(twice.status, 400)
    assertEquals(twice.headers.get('set-cookie'), null)
    assertStringIncludes(await twice.text(), 'That link has expired')

    // And the person wears the mark of how they last got in, which is what
    // says whether a standing link was ever used at all.
    let dir = meta(k)
    let [them] = await dir.query(
      `.person&.email.address=${encodeURIComponent(email)}&?signed_in`,
    )
    assertEquals((them.signed_in as { via: string }).via, 'link')

    // A link signs in and grants nothing (T-777). Anybody can ask for a
    // letter to somebody else's address with their own authorize request
    // sealed in it, so a press carrying one lands, signed in, on the consent
    // card, which names the client and the host it reports to; only its
    // Allow grants.
    let back = 'https://probe.invalid/cb'
    let reg = await k.at('yaks.app', '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'A probing connector',
        redirect_uris: [back],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
    })
    let client_id = (await reg.json()).client_id
    let q = new URLSearchParams({
      response_type: 'code',
      client_id,
      redirect_uri: back,
      state: 'a-probe-state',
      scope: 'graph',
      code_challenge: await challenge('v'),
      code_challenge_method: 'S256',
    }).toString()
    let sealed = async (fields: Record<string, string>) => {
      let received = letters(k, email).length
      let asked = await form(k, '/login', { email, ...fields })
      assertEquals(asked.status, 200)
      await asked.body?.cancel()
      return new URL(
        where(
          (await letter(k, email, 'sign in with one click', received)).body,
        ),
        'https://yaks.app',
      )
    }
    let link = await sealed({ q })
    let linking = await form(k, '/login/link', {
      t: link.searchParams.get('t') ?? '',
    })
    await linking.body?.cancel()
    assertEquals(
      [linking.status, linking.headers.get('location')],
      [303, `/oauth/authorize?${q}`],
    )
    let signed = (linking.headers.get('set-cookie') ?? '').split(';')[0]
    let card = await (await k.at('yaks.app', `/oauth/authorize?${q}`, {
      headers: { cookie: signed },
    })).text()
    assertStringIncludes(card, 'A probing connector (probe.invalid)')
    let consent = /name="consent" value="([^"]+)"/.exec(card)?.[1] ?? ''
    let allowed = await form(k, '/oauth/allow', { q, consent }, signed)
    await allowed.body?.cancel()
    let to = new URL(allowed.headers.get('location') ?? '')
    assertEquals(to.origin + to.pathname, back)
    assertEquals(to.searchParams.get('state'), 'a-probe-state')
    assert(to.searchParams.get('code'), 'the connector got its code')

    // Where a link goes on to was chosen by whoever asked for the letter, so
    // a page on a space is named before the press.
    let onward = await sealed({ return: 'https://elsewhere.yaks.app/app' })
    assertStringIncludes(
      await (await click(onward.pathname + onward.search)).text(),
      'continue to elsewhere.yaks.app/app',
    )

    // The standing link: minted by whoever is signed in, for themselves, and
    // worth a session and nothing more.
    let minted = await form(k, '/login/link', { days: '90' }, cookie)
    assertEquals(minted.status, 200)
    let got = await minted.json()
    assertMatch(got.id, /^[0-9a-f]{12}$/)
    assert(Date.parse(got.expires) > Date.now() + 89 * 86_400_000)
    let at = new URL(got.url)
    let standing = at.pathname + at.search

    // Twice, which is the whole point: a reviewer signs in as often as they
    // need to, with no mailbox anywhere in it.
    for (let _ of [1, 2]) {
      let card = await click(standing)
      assertEquals(card.status, 200)
      assertStringIncludes(await card.text(), email)
      let r = await form(k, '/login/link', { t: at.searchParams.get('t')! })
      assertEquals(r.status, 303)
      await r.body?.cancel()
      assertMatch(r.headers.get('set-cookie') ?? '', /^yak_session=/)
    }

    // Nobody but the signed-in browser mints one: a stranger is refused, and
    // an agent's bearer must not become a session it could mail anywhere.
    let stranger = await form(k, '/login/link', {})
    assertEquals(stranger.status, 401)
    await stranger.body?.cancel()

    // And it is revocable by name, which a cookie is not.
    let gone = await form(k, '/login/link', { revoke: got.id }, cookie)
    assertEquals(gone.status, 200)
    assertEquals((await gone.json()).revoked, [got.id])
    let dead = await click(standing)
    assertEquals(dead.status, 400)
    assertEquals(dead.headers.get('set-cookie'), null)
    await dead.body?.cancel()
  } finally {
    await k.stop()
  }
})

// A server a person connects can name yaks.app as where it signs in, and
// would be sent a token for their whole account (T-803). yaks.app grants
// access to itself and nothing else: an authorize request or a token request
// naming another resource is refused `invalid_target` (a token minted for one
// before is nobody: identity-consent_test.ts).
test('a token is only ever for yaks.app', async () => {
  let k = await kernel()
  try {
    let { cookie } = await signIn(k)
    let back = 'https://probe.invalid/cb'
    let reg = await k.at('yaks.app', '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'A remote server',
        redirect_uris: [back],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
    })
    let client_id = (await reg.json()).client_id
    let verifier = crypto.randomUUID() + crypto.randomUUID()
    let ask = async (resource: string) =>
      new URLSearchParams({
        response_type: 'code',
        client_id,
        redirect_uri: back,
        state: 's',
        scope: 'graph',
        code_challenge: await challenge(verifier),
        code_challenge_method: 'S256',
        resource,
      }).toString()
    let token = (code: string, more: Record<string, string> = {}) =>
      form(k, '/oauth/token', {
        grant_type: 'authorization_code',
        code,
        client_id,
        redirect_uri: back,
        code_verifier: verifier,
        ...more,
      })
    let me = async (bearer: string) => {
      let r = await k.at('yaks.app', '/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bearer}`,
        },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      })
      await r.body?.cancel()
      return r.status
    }
    let remote = 'https://remote.invalid/mcp'

    let card = await k.at('yaks.app', `/oauth/authorize?${await ask(remote)}`, {
      headers: { cookie },
      redirect: 'manual',
    })
    await card.body?.cancel()
    let refused = new URL(card.headers.get('location') ?? '')
    equal(
      [
        card.status,
        refused.origin + refused.pathname,
        refused.searchParams.get('error'),
        refused.searchParams.get('state'),
      ],
      [302, back, 'invalid_target', 's'],
    )

    let ours = await allowed(k, await ask('https://yaks.app/mcp'), cookie)
    await ours.body?.cancel()
    let code = new URL(ours.headers.get('location')!).searchParams.get('code')!
    let other = await token(code, { resource: remote })
    equal([other.status, (await other.json()).error], [400, 'invalid_target'])
    let got = await (await token(code)).json()
    equal(await me(got.access_token), 200)
  } finally {
    await k.stop()
  }
})

// The renewal, wired (session.ts `slid`, T-35380): every answer leaves the
// router past it, so a cookie past half its life comes back fresh from a door
// that knows nothing about sessions — here the apex's own home page.
test(
  'an answer to a request past half a session renews the cookie',
  async () => {
    let k = await kernel()
    try {
      let aged = async (days: number) =>
        `${COOKIE}=${await sign(
          {
            person: k.owner.person,
            space: null,
            exp: Math.floor(Date.now() / 1000) + (90 - days) * 24 * 60 * 60,
          },
          k.secret,
        )}`
      let home = async (cookie: string) => {
        let r = await k.at('yaks.app', '/', {
          headers: { cookie },
        })
        await r.body?.cancel()
        return r.headers.getSetCookie()
          .find((c) => c.startsWith(`${COOKIE}=`)) ?? null
      }
      assertMatch((await home(await aged(46))) ?? '', /^yak_session=/)
      assertEquals(await home(await aged(30)), null)
      assertEquals(await home(await aged(91)), null)
    } finally {
      await k.stop()
    }
  },
)

// The site's island (signed.ts) asks whether this browser is signed in, and
// the answer is the browser's alone: never cached, true only with a session.
test('/login/who answers whether the cookie signs somebody in', async () => {
  let k = await kernel()
  try {
    let who = async (cookie?: string) => {
      let r = await k.at('yaks.app', '/login/who', {
        headers: cookie ? { cookie } : {},
      })
      assertEquals(r.headers.get('cache-control'), 'private, no-store')
      let answer = await r.json()
      // No deploy is named where the runtime names none (public/deploy.js).
      assertEquals(answer.deploy, null)
      return answer.signedIn
    }
    assertEquals(await who(), false)
    assertEquals(await who(`${COOKIE}=forged`), false)
    assertEquals(await who((await signIn(k)).cookie), true)
  } finally {
    await k.stop()
  }
})
