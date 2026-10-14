// An assistant that lost its sign-in, through the whole kernel (lapsed.ts):
// the refresh it comes back with is refused, and its person is written to
// once with how to connect it again, never while it is connected, and never
// for one they disconnected themselves.
import { equal, ok, test } from '@yaks/testing'
import { allowed, kernel, letter, letters, meta, signIn } from './probe.ts'

let b64u = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

test('an assistant that lost its sign-in has its person told once', async () => {
  let k = await kernel()
  try {
    let me = await signIn(k)
    let you = await signIn(k)
    let back = 'https://claude.ai/api/mcp/auth_callback'
    let reg = await k.at('yaks.app', '/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude',
        redirect_uris: [back],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    })
    let client_id = (await reg.json()).client_id
    let post = (path: string, fields: Record<string, string>, cookie = '') =>
      k.at('yaks.app', path, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          ...(cookie ? { cookie } : {}),
        },
        body: new URLSearchParams(fields).toString(),
      })
    let refresh = async (refresh_token: string) => {
      let r = await post('/oauth/token', {
        grant_type: 'refresh_token',
        client_id,
        refresh_token,
      })
      await r.body?.cancel()
      return r.status
    }
    // What an assistant whose grant is gone sends: its person's refresh
    // token for a grant yaks.app no longer holds.
    let lapsed = (person: string) =>
      refresh(`${person}:${crypto.randomUUID()}:secret`)
    let connect = async (cookie: string) => {
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
      let granted = await allowed(k, q, cookie)
      let code = new URL(granted.headers.get('location') ?? '')
        .searchParams.get('code') ?? ''
      let r = await post('/oauth/token', {
        grant_type: 'authorization_code',
        code,
        client_id,
        redirect_uri: back,
        code_verifier: verifier,
      })
      equal(r.status, 200)
      return (await r.json()).refresh_token as string
    }
    let told = async (email: string) => {
      await k.settled?.()
      return letters(k, email).filter((l) => l.subject.startsWith('Reconnect'))
    }

    equal(await lapsed(me.person), 400)
    let first = await letter(k, me.email, 'Reconnect Claude')
    ok(first.body.includes('claude.ai'))
    equal(await lapsed(me.person), 400)
    equal((await told(me.email)).length, 1)

    // Connected again, the lapse is over, and a refusal while connected is
    // no news.
    let held = await connect(me.cookie)
    await k.settled?.()
    equal(await meta(k).query(`.lapsed.person=${me.person}`), [])
    equal(await lapsed(me.person), 400)
    equal((await told(me.email)).length, 1)

    // Disconnected by the person themselves: their assistant's next refresh
    // is refused, and they already know.
    let off = await post(
      '/oauth/agents/disconnect',
      { agent: 'claude', return: '/connect' },
      me.cookie,
    )
    await off.body?.cancel()
    equal(off.status, 303)
    equal(await refresh(held), 400)
    equal((await told(me.email)).length, 1)

    // A lapse whose assistant nobody knows, as the platform's admin records
    // it, names Claude and ChatGPT both, and stands for every assistant.
    await meta(k).apply([{
      entity: { eid: '$lapse' },
      lapsed: { person: you.person, agent: 'any' },
    }])
    let either = await letter(k, you.email, 'Reconnect your assistant')
    ok(either.body.includes('claude.ai') && either.body.includes('chatgpt.com'))
    equal(await lapsed(you.person), 400)
    equal((await told(you.email)).length, 1)
  } finally {
    await k.stop()
  }
})
