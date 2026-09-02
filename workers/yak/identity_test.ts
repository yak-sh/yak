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
import { assert, assertEquals, assertMatch } from '@std/assert'
import { slow } from '../../src/testing.ts'
import { type Kernel, kernel, mailed, meta } from './probe.ts'

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
    assertMatch(await card.text(), /Send me a code/)

    // A code, asked for and mailed. The page says where it went.
    let email = `probe-${crypto.randomUUID().slice(0, 8)}@yaks.app`
    let sent = await form(k, '/login', { email })
    assertEquals(sent.status, 200)
    assertMatch(await sent.text(), new RegExp(email))
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
    assertEquals(inn.headers.get('location'), '/')
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
      `.person!&.email.address=${encodeURIComponent(email)}`,
    )
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
      assertMatch(
        await asked.text(),
        new RegExp(`name="return" value="${back}"`),
      )
      let r = await form(k, '/login/code', {
        email: addr,
        code: await mailed(k, addr),
        return: back,
      })
      assertMatch(r.headers.get('set-cookie') ?? '', /^yak_session=/)
      assertEquals(r.status, 303)
      return r.headers.get('location')
    }
    let notes = 'https://someone.yaks.app/notes/'
    assertEquals(await comeback(notes), notes)
    assertEquals(await comeback('https://elsewhere.example/notes/'), '/')

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
    assertEquals(owner.member, {
      space: yak.entity.eid,
      person: me,
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
    assertEquals(await dir.query(`.mail.to_addr=${waiting}`), [])

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
    assertEquals(await mine.json(), { person: me, via: 'oauth' })

    // And the connector door takes it: the bearer is the same person there,
    // which is the whole point of the OAuth half (mcp.ts `withAuth`).
    let rpc = await k.at('yaks.app', '/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    })
    assertEquals(rpc.status, 200)
    assert((await rpc.json()).result, 'the connector answered the bearer')

    // Nobody gets the challenge that tells them where to sign in.
    for (
      let anon of [
        await k.at('yaks.app', '/oauth/me'),
        await k.at('yaks.app', '/mcp', { method: 'POST', body: '{}' }),
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
