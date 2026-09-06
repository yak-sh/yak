// The identity part, held in workerd (probe.ts boots the kernel): a person
// signs in by receiving mail, the browser carries the platform cookie into an
// app, the first person ever owns the meta space, a mistyped code is refused
// softly — and an agent walks the whole OAuth 2.1 flow, from a client that
// registers itself to a bearer token that resolves to the same person.
//
// The dev mail adapter prints each letter on the Worker's log (mail.ts
// `printed`), which is where the test reads its own code; no store anywhere
// holds one. Nothing here knows the code before the kernel mails it. The
// directory itself is read back through the MCP graph tier as the owner of
// `yak` — the one door into the meta store (probe.ts `meta`, T-32585).
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import { slow, until } from '../../src/testing.ts'
import {
  connector,
  type Kernel,
  kernel,
  letter,
  letters,
  mailed,
  meta,
  signIn,
} from './probe.ts'
import { SENDS } from './signin.ts'

let form = (
  k: Kernel,
  path: string,
  fields: Record<string, string>,
  cookie?: string,
) =>
  k.at('yaks.app', path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams(fields).toString(),
  })

let b64u = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

slow('a person signs in by mail, and an agent by OAuth', async () => {
  let k = await kernel()
  try {
    // The card asks for an address, and nothing else.
    let card = await k.at('yaks.app', '/login')
    assertEquals(card.status, 200)
    assertMatch(await card.text(), /<input name="email" type="email" required/)

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
    assertMatch(await wrong.text(), /expired or was mistyped/)

    // The code itself: a session cookie for the whole platform. See Other,
    // because the form is not what to do next.
    let inn = await form(k, '/login/code', { email, code })
    assertEquals(inn.status, 303)
    // Sent from nowhere, they land on their own space — the signed-in home of
    // the platform, where attaching an assistant is one link away (T-34233).
    assertEquals(
      inn.headers.get('location'),
      `https://${email.split('@')[0]}.yaks.app/`,
    )
    let set = inn.headers.get('set-cookie') ?? ''
    assertMatch(set, /^yak_session=/)
    assertMatch(set, /Domain=yaks\.app/)
    assertMatch(set, /HttpOnly/)
    assertMatch(set, /SameSite=Lax/)
    let cookie = set.split(';')[0]
    // The first person ever to sign in owns the meta space, and the graph
    // tier is their door into it.
    let dir = meta(k, cookie)

    // Signing in IS having a space (T-32482): one named for their address,
    // with them as its owner, so nothing ever asks them for a name.
    let [them] = await dir.query(
      `.person!&.email.address=${encodeURIComponent(email)}&.doc?`,
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
    let anew = await form(k, '/login', { email })
    assertEquals(anew.status, 200)
    await anew.body?.cancel()
    let opened = await form(k, '/login/code', {
      email,
      code: await mailed(k, email),
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
        home: `https://${addr.split('@')[0]}.yaks.app/`,
      }
    }
    let notes = 'https://someone.yaks.app/notes/'
    assertEquals((await comeback(notes)).to, notes)
    let off = await comeback('https://elsewhere.example/notes/')
    assertEquals(off.to, off.home)

    // Spent: the same code opens nothing twice.
    assertEquals((await form(k, '/login/code', { email, code })).status, 400)

    // The person the address minted, and their ownership of the meta space —
    // the first sign-in ever is the platform's owner.
    let [person] = await dir.query(
      `.person!&.email.address=${encodeURIComponent(email)}`,
    )
    assert(person, 'a person for ' + email)
    let me = person.entity.eid
    let [yak] = await dir.query('.space.slug=yak')
    let [owner] = await dir.query(
      `.member.person=${me}&.member.space=${yak.entity.eid}`,
    )
    // The person a member row names answers with their name beside the eid
    // (T-32733); the space it names is not a person, so it stays an eid.
    assertEquals(owner.member, {
      space: yak.entity.eid,
      person: { eid: me, name: email.split('@')[0] },
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
    // And there is nowhere for it to be written down: the directory's
    // vocabulary has no `mail` at all (vocab.ts `platformDoc`), so the
    // question itself has no answer.
    assertStringIncludes(
      await dir.query(`.mail.to_addr=${waiting}`).then(
        () => '',
        (e: Error) => e.message,
      ),
      'unknown prop: .mail',
    )

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
    // response that sent it, so a letter to a FRESH address is the barrier:
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
    await dir.apply([
      {
        entity: { eid: '$s' },
        doc: { title: 'probe' },
        space: {
          slug: 'probe',
        },
      },
      { doc: { title: 'box' }, app: { slug: 'box', space: '$s' } },
      { member: { space: '$s', person: me, role: 'owner' } },
    ])
    let who = await (await k.at('probe.yaks.app', '/box/api/graph', {
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

    // Their space page, before any agent has ever been let in as them: the
    // connect block stands OPEN, because attaching one is the whole of what is
    // left to do here (T-34236).
    let theirPage = () =>
      k.at(`${email.split('@')[0]}.yaks.app`, '/', { headers: { cookie } })
        .then((r) => r.text())
    let fresh = await theirPage()
    assertMatch(fresh, /<details class="Attach" open>/)
    // What they are called leads the connect block.
    assert(
      fresh.indexOf('name="name"') < fresh.indexOf('<details class="Attach"'),
      fresh,
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
      code_challenge: b64u(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(verifier),
        ),
      ),
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
    let granted = await form(k, '/oauth/allow', { q }, cookie)
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

    // And the token IS the person: what withAuth answers for a bearer is
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
    // one of them is a token the provider cannot find — is REFUSED there, not
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

    // And with one let in, the block on their space page shuts: the steps are
    // still there — a SECOND assistant is added the same way — but they are
    // one line to open rather than the page (T-34236).
    let working = await theirPage()
    assertMatch(working, /<details class="Attach">/)
    assertMatch(working, /class="Copy_Go"/)

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
      `https://${email.split('@')[0]}.yaks.app/`,
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
          body: '{"jsonrpc":"2.0","id":1,"method":"prompts/list"}',
        }),
      ]
    ) {
      assertEquals(anon.status, 401)
      assertMatch(
        anon.headers.get('www-authenticate') ?? '',
        /resource_metadata=/,
      )
    }
  } finally {
    await k.stop()
  }
})

// A connection stays connected (T-34416). The owner: "the oauth should never
// expire" — so a connector holds its door until the person closes it, and the
// two ways it used to be closed for them are shut: a refresh token with an
// expiry, and a public client's refresh refused for carrying a `client_secret`
// it was never issued, which is what ChatGPT sends and what a person reads as
// "your connection has expired, reconnect it".
slow('a connector keeps its door until the person closes it', async () => {
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
    // And beside it one that DID take a secret, so the leniency below can be
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
      code_challenge: b64u(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(verifier),
        ),
      ),
      code_challenge_method: 'S256',
    }).toString()
    let granted = await form(k, '/oauth/allow', { q }, cookie)
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

// The sign-in box is for somebody signed OUT (T-34209). A browser carrying a
// session is never asked again: `GET /login` reads the cookie first and sends
// them on — to the page they were headed for when it is ours to send them to,
// and to where a fresh sign-in lands when it is nowhere or a stranger's, which
// is the same guard closing the same open redirect.
slow('/login never draws the box for a browser already signed in', async () => {
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
    let { cookie, email } = await signIn(k)
    let home = `https://${email.split('@')[0]}.yaks.app/`

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
    // Aimed at nothing, it is their first — the one their address spells —
    // and never the newest (T-34233).
    let other = `garden-${crypto.randomUUID().slice(0, 8)}`
    await connector(k, cookie).tool('space_new', {
      slug: other,
      title: 'Garden',
    })
    let garden = `https://${other}.yaks.app/`
    assertEquals(await sent(aimed(garden), cookie), garden)
    assertEquals(await sent('/login', cookie), home)

    // Signed out, the card is what it always was.
    let card = await get('/login')
    assertEquals(card.status, 200)
    assertMatch(await card.text(), /<input name="email" type="email" required/)
  } finally {
    await k.stop()
  }
})

// A space in the trash is still THEIR space (erase.ts, T-34431): signing in
// mints nothing beside it, and where the code lands them is the one page that
// space serves — the owner's, with the button that brings it back. This is the
// half of the trash a person meets without ever being told about it.
slow(
  'the code lands on the trash page when the only space is there',
  async () => {
    let k = await kernel()
    try {
      let them = await signIn(k)
      let slug = them.email.split('@')[0]
      // Straight off the web with no letter in hand: typing the name back is
      // the other way to confirm, and what it confirms is the TRASH — the erase
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
      let asked = await form(k, '/login', { email: them.email })
      assertEquals(asked.status, 200)
      await asked.body?.cancel()
      let inn = await form(k, '/login/code', {
        email: them.email,
        code: await mailed(k, them.email),
      })
      assertEquals(inn.status, 303)
      assertEquals(inn.headers.get('location'), `https://${slug}.yaks.app/`)
      let cookie = (inn.headers.get('set-cookie') ?? '').split(';')[0]

      // And that page says where their space went, with the days it has left.
      let there = await k.at(`${slug}.yaks.app`, '/', { headers: { cookie } })
      assertEquals(there.status, 404)
      let said = await there.text()
      assertStringIncludes(said, `${slug} is in the trash`)
      assertStringIncludes(said, '30 more days')

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
// page a sign-in now lands on instead: what to call them, and the address
// their apps live at. One form, one POST to the space's own address, and the
// answer is a redirect — a changed address MOVES this hostname, so where they
// land is wherever the space now is.
slow("the space page's owner block names them and their address", async () => {
  let k = await kernel()
  let uniq = () => crypto.randomUUID().slice(0, 8)
  let post = (host: string, fields: Record<string, string>, cookie?: string) =>
    k.at(host, '/', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(cookie ? { cookie } : {}),
      },
      body: new URLSearchParams(fields).toString(),
    })
  try {
    let { cookie, email, person } = await signIn(k)
    let slug = email.split('@')[0]
    let dir = meta(k, cookie)

    // The block, as its owner reads it: their address and the name signing in
    // derived for them, both filled in and both theirs to change.
    let page = await (await k.at(`${slug}.yaks.app`, '/', {
      headers: { cookie },
    })).text()
    assertMatch(page, new RegExp(`name="space"[^>]*value="${slug}"`))
    assertMatch(page, new RegExp(`name="name"[^>]*value="${slug}"`))

    // A stranger sees none of it, and nor does somebody signed in who is
    // nobody here.
    let out = await (await k.at(`${slug}.yaks.app`, '/')).text()
    assertEquals(/name="space"/.test(out), false)

    // Naming themselves: written on their own person row, so every byline an
    // app writes says it (T-32654).
    let named = await post(`${slug}.yaks.app`, { name: 'Dana' }, cookie)
    assertEquals(named.status, 303)
    await named.body?.cancel()
    assertEquals(
      named.headers.get('location'),
      `https://${slug}.yaks.app/`,
    )
    let [them] = await dir.query(`.eid=${person}&.doc?`)
    assertEquals((them.doc as { title: string }).title, 'Dana')

    // Cleared, the front of their address comes back: a person is always
    // called something, or a member row reads back as an eid (T-32733).
    await (await post(`${slug}.yaks.app`, { name: '  ' }, cookie)).body
      ?.cancel()
    let [quiet] = await dir.query(`.eid=${person}&.doc?`)
    assertEquals((quiet.doc as { title: string }).title, slug)

    // A taken address is refused in the sentence `/connect` says, and the page
    // comes back around it — nothing has moved.
    let theirs = await signIn(k, `rex-${uniq()}@yaks.app`)
    let taken = await post(
      `${slug}.yaks.app`,
      { space: theirs.email.split('@')[0] },
      cookie,
    )
    assertEquals(taken.status, 400)
    assertMatch(await taken.text(), /is taken/)

    // A badly shaped one says what an address is.
    let bad = await post(
      `${slug}.yaks.app`,
      { space: 'Not An Address' },
      cookie,
    )
    assertEquals(bad.status, 400)
    assertMatch(await bad.text(), /lowercase letters, numbers and dashes/)

    // And a free one moves the space — which is to say it moves this page, so
    // the answer is the address it now lives at.
    let want = `dana-${uniq()}`
    let moved = await post(`${slug}.yaks.app`, { space: want }, cookie)
    assertEquals(moved.status, 303)
    await moved.body?.cancel()
    assertEquals(moved.headers.get('location'), `https://${want}.yaks.app/`)
    assert(
      (await dir.query(`.space.slug=${want}`)).length,
      `a space at ${want}`,
    )
    assertEquals(await dir.query(`.space.slug=${slug}`), [])

    // Nobody but the owner may write it: a stranger's POST is told what a
    // wrong address is told, and nothing moves.
    let no = await post(`${want}.yaks.app`, { space: `nope-${uniq()}` })
    assertEquals(no.status, 404)
    await no.body?.cancel()
    assert((await dir.query(`.space.slug=${want}`)).length, 'still theirs')

    // And nor may their own cookie, carried by somebody else's page. Sibling
    // spaces are SAME-SITE, so `SameSite=Lax` lets the session ride a form one
    // space's page posts at another's — the origin check is what does not
    // (route.ts `sameOrigin`).
    let forged = await k.at(`${want}.yaks.app`, '/', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://elsewhere.yaks.app',
        cookie,
      },
      body: new URLSearchParams({ space: `taken-${uniq()}` }).toString(),
    })
    assertEquals(forged.status, 404)
    await forged.body?.cancel()
    assert((await dir.query(`.space.slug=${want}`)).length, 'still theirs')
  } finally {
    await k.stop()
  }
})

// The connector page, signed in: how to hand this platform to the assistant a
// person already talks to (T-32972), and beside it the address their apps will
// live at, theirs to change inline while nothing is built there (T-32967). A
// stranger asking for it is sent to sign in (T-34408). Its own kernel, because
// the first sign-in on one owns the meta space, which is the door every
// directory read below goes through.
slow('the connector page, and the address chosen on it', async () => {
  let k = await kernel()
  let uniq = () => crypto.randomUUID().slice(0, 8)
  let post = (fields: Record<string, string>, cookie?: string) =>
    form(k, '/connect', fields, cookie)
  let asJson = async (fields: Record<string, string>, cookie: string) => {
    let r = await k.at('yaks.app', '/connect', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        cookie,
      },
      body: new URLSearchParams(fields).toString(),
    })
    return [r.status, await r.json()] as [number, Record<string, string>]
  }
  try {
    // Signed out, there is nothing to read here: attaching an assistant is
    // the second step, so a stranger is sent to sign in and the steps meet
    // them on the space they land on (T-34408). No `return` rides along —
    // the point is to land them on their space, not back in front of it.
    let open = await k.at('yaks.app', '/connect', { redirect: 'manual' })
    assertEquals(open.status, 303)
    assertEquals(open.headers.get('location'), '/login')
    await open.body?.cancel()

    // A first sign-in lands on their own space, and the owner block there is
    // what carries them here (T-34233).
    let email = `probe-${uniq()}@yaks.app`
    await (await form(k, '/login', { email })).body?.cancel()
    let inn = await form(k, '/login/code', {
      email,
      code: await mailed(k, email),
      name: 'Dana',
    })
    assertEquals(inn.status, 303)
    assertEquals(
      inn.headers.get('location'),
      `https://${email.split('@')[0]}.yaks.app/`,
    )
    await inn.body?.cancel()
    let cookie = (inn.headers.get('set-cookie') ?? '').split(';')[0]
    let dir = meta(k, cookie)

    // Signed in, the whole page: the instructions, and the card saying where
    // they are, filled with the address signing in derived for them — theirs
    // to keep by doing nothing at all.
    let derived = email.split('@')[0]
    let whole = await k.at('yaks.app', '/connect', {
      redirect: 'manual',
      headers: { cookie },
    })
    assertEquals(whole.status, 200)
    let card = await whole.text()
    assertMatch(card, /https:\/\/yaks\.app\/mcp/)
    assertMatch(card, /claude mcp add --transport http yaks/)
    assertMatch(card, new RegExp(`${derived}.yaks.app`))
    assertMatch(card, new RegExp(`name="space"[^>]*value="${derived}"`))

    // Choosing one answers in place — the address, for the page to show —
    // and the space they own wears it.
    let want = `dana-${uniq()}`
    assertEquals(await asJson({ space: want }, cookie), [
      200,
      { address: `${want}.yaks.app`, slug: want },
    ])
    let [theirs] = await dir.query(`.space.slug=${want}&.doc?`)
    assert(theirs, `a space at ${want}`)
    assertEquals((theirs.doc as { title: string }).title, want)
    assertEquals(await dir.query(`.space.slug=${derived}`), [])

    // Badly shaped, and taken: a sentence a person can act on, and nothing
    // moves. Neither answer says a word about anybody's account.
    let [bad, why] = await asJson({ space: 'Not An Address' }, cookie)
    assertEquals(bad, 400)
    assertMatch(why.error, /lowercase letters, numbers and dashes/)

    let them = `probe-${uniq()}@yaks.app`
    await (await form(k, '/login', { email: them })).body?.cancel()
    let two = await form(k, '/login/code', {
      email: them,
      code: await mailed(k, them),
      name: 'Rex',
    })
    let theirCookie = (two.headers.get('set-cookie') ?? '').split(';')[0]
    await two.body?.cancel()
    let [no, taken] = await asJson({ space: want }, theirCookie)
    assertEquals(no, 400)
    assertMatch(taken.error, new RegExp(`${want}.yaks.app is taken`))

    // With no script, the same post answers with the page around it.
    let plain = await post({ space: want }, theirCookie)
    assertEquals(plain.status, 400)
    let again = await plain.text()
    assertMatch(again, new RegExp(`${want}.yaks.app is taken`))
    assertMatch(again, new RegExp(`name="space"[^>]*value="${want}"`))

    // Once something is built there, the address stays put: moving an app's
    // URL is a bigger job than this page does (T-32576).
    let [mine] = await dir.query(`.space.slug=${want}`)
    await dir.apply([
      { doc: { title: 'box' }, app: { slug: 'box', space: mine.entity.eid } },
    ])
    let [fixed, stays] = await asJson({ space: `dana-${uniq()}` }, cookie)
    assertEquals(fixed, 400)
    assertMatch(stays.error, /stays put/)
    let built = await (await k.at('yaks.app', '/connect', {
      headers: { cookie },
    })).text()
    assertEquals(/name="space"/.test(built), false)

    // A stranger who posts one is sent to sign in, and nothing is answered
    // about the address they asked for.
    let out = await post({ space: 'whoever' })
    assertEquals(out.status, 302)
    assertMatch(out.headers.get('location') ?? '', /^\/login\?return=/)
    await out.body?.cancel()
  } finally {
    await k.stop()
  }
})

// The CIMD claim is a lever, not a constant. The suite above rides the ON
// default — the metadata claims support, and a URL client_id is a document we
// go and fetch — so this holds the other side: a kernel wearing `CIMD=off`
// says it does not support CIMD, still offers dynamic registration, and reads
// a URL client_id out of the store like any other name, where it is simply
// not registered (T-33027).
slow(
  'CIMD is a flag, and dropped it leaves registration standing',
  async () => {
    let k = await kernel({ CIMD: 'off' })
    try {
      let as = await (await k.at(
        'yaks.app',
        '/.well-known/oauth-authorization-server',
      )).json()
      assertEquals(as.client_id_metadata_document_supported, false)
      assertMatch(as.registration_endpoint, /\/oauth\/register$/)
      assertMatch(as.authorization_endpoint, /\/oauth\/authorize$/)

      // No document is fetched: the id is looked up, found nowhere, and the
      // client is refused as the stranger it is — not as an outage of ours.
      let doc = 'https://probe.invalid/client_metadata.json'
      let bare = await k.at(
        'yaks.app',
        `/oauth/authorize?response_type=code&client_id=${
          encodeURIComponent(doc)
        }&redirect_uri=https%3A%2F%2Fprobe.invalid%2Fcb`,
      )
      assertEquals(bare.status, 400)
      assertEquals(/client metadata document/.test(await bare.text()), false)
    } finally {
      await k.stop()
    }
  },
)

// The OAuth settings the connect page teaches (T-34414), against the two
// documents the authorization server actually serves. The page tells a person
// what to put in a connector form; if it ever named an address the door does
// not answer, the person would be stuck with no way to tell which of the two
// was lying. So both are read here from one kernel and compared. It lives
// beside the identity part rather than in site_test.ts because the connect
// page is the kernel's own (pages.ts), not one of the static ones.
slow(
  'the connect page teaches the OAuth settings the door serves',
  async () => {
    let k = await kernel()
    try {
      let { cookie } = await signIn(k)
      let page = await (await k.at('yaks.app', '/connect', {
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
      // And the address for a client that cannot do optional authentication
      // is still written down (T-34416), as the sentence it now is: everybody
      // is handed the plain door, which does mixed auth (T-34465).
      assertStringIncludes(page, 'https://yaks.app/mcp?auth=required')
    } finally {
      await k.stop()
    }
  },
)

// The clamp on how long signing in may take (T-34138). A first sign-in on
// 2026-09-04 took 32.4 seconds of wall time against 28.7ms of CPU — an
// unbounded wait on something, not work — and the person who was doing it
// thought the platform had broken. Nothing about the flow's shape stops that
// from happening again quietly, so this times it and fails rather than
// letting a regression arrive as somebody's spinner.
//
// The budget is deliberately loose. The measured cold flow on this stand-in
// is ~320ms — the whole of it, on a store that does not exist yet: the
// Durable Object is created, its schema and search index are planted, the
// directory is seeded, the person and their space are minted. Ten times that
// is not a microbenchmark anyone has to keep green, and it still catches both
// a hang and an order-of-magnitude regression. The kernel's own boot is
// outside the span: wrangler starting workerd is the test harness, not the
// product.
//
// The letter is not timed either — `mailed` polls the log at 100ms, so its
// span would measure the poll and not the platform. What is timed is exactly
// the four requests a browser makes.
let BUDGET = 3_000

slow('a cold sign-in stays well under the budget', async () => {
  let k = await kernel()
  try {
    let email = 'cold@yaks.app'
    let took = 0
    let span = async <T>(go: () => Promise<T>): Promise<T> => {
      let at = performance.now()
      let out = await go()
      took += performance.now() - at
      return out
    }
    let card = await span(() => k.at('yaks.app', '/login'))
    assertEquals(card.status, 200)
    await card.body?.cancel()

    let asked = await span(() => form(k, '/login', { email }))
    assertEquals(asked.status, 200)
    await asked.body?.cancel()

    let code = await mailed(k, email)
    let inn = await span(() =>
      form(k, '/login/code', { email, code, name: 'Cold' })
    )
    assertEquals(inn.status, 303)
    await inn.body?.cancel()
    let cookie = (inn.headers.get('set-cookie') ?? '').split(';')[0]

    // Where the 303 sends them: the flow is not over until that page is in
    // front of them, and it reads the directory the sign-in just wrote. That
    // is their own space's hostname now, which the probe spells in a header.
    let to = new URL(inn.headers.get('location') ?? '/', 'https://yaks.app')
    let page = await span(() =>
      k.at(to.hostname, to.pathname + to.search, { headers: { cookie } })
    )
    assertEquals(page.status, 200)
    await page.body?.cancel()

    assert(
      took < BUDGET,
      `signing in cold took ${took.toFixed(0)}ms, over the ${BUDGET}ms budget`,
    )
  } finally {
    await k.stop()
  }
})

// One click instead of six digits (link.ts, T-34351), and the standing link an
// app directory's reviewer is given instead of a mailbox — OpenAI's review
// refuses any credential that needs one. Both are the same door and the same
// landing a typed code reaches; what tells them apart is how they die.
slow('a link signs a person in, once or until it is revoked', async () => {
  let k = await kernel()
  try {
    // THE LETTER'S ONE CLICK. The same code, said as a link.
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

    // It lands exactly where the code lands: their own space, with the
    // platform cookie — and it says nothing about where it came from, so the
    // pass never rides on to the next page in a Referer.
    let inn = await click(one)
    assertEquals(inn.status, 303)
    await inn.body?.cancel()
    assertEquals(
      inn.headers.get('location'),
      `https://${email.split('@')[0]}.yaks.app/`,
    )
    assertEquals(inn.headers.get('referrer-policy'), 'no-referrer')
    let cookie = (inn.headers.get('set-cookie') ?? '').split(';')[0]
    assertMatch(cookie, /^yak_session=/)

    // SINGLE USE: the link WAS the code, and the code is spent. The card
    // again, and no session with it.
    let twice = await click(one)
    assertEquals(twice.status, 400)
    assertEquals(twice.headers.get('set-cookie'), null)
    assertStringIncludes(await twice.text(), 'That link has expired')

    // And the person wears the mark of how they last got in, which is what
    // says whether a standing link was ever used at all.
    let dir = meta(k, cookie)
    let [them] = await dir.query(
      `.person!&.email.address=${encodeURIComponent(email)}&.signed_in?`,
    )
    assertEquals((them.signed_in as { via: string }).via, 'link')

    // A CONNECTION IN FLIGHT is finished by the link, because the authorize
    // request rides inside the seal rather than on the URL.
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
      code_challenge: b64u(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode('v')),
      ),
      code_challenge_method: 'S256',
    }).toString()
    let asked = await form(k, '/login', { email, q })
    assertEquals(asked.status, 200)
    await asked.body?.cancel()
    let linking = await click(
      where((await letter(k, email, 'sign in with one click')).body),
    )
    assertEquals(linking.status, 302)
    await linking.body?.cancel()
    let to = new URL(linking.headers.get('location') ?? '')
    assertEquals(to.origin + to.pathname, back)
    assertEquals(to.searchParams.get('state'), 'a-probe-state')
    assert(to.searchParams.get('code'), 'the connector got its code')

    // THE STANDING LINK: minted by whoever is signed in, for themselves, and
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
      let r = await click(standing)
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
