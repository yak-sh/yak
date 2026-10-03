// Account discovery and admin HTTP doors through the kernel: an OAuth token
// names the same account that consented, opens only its live seats, and never
// falls back to a cookie when invalid. Website sessions and pasted grants keep
// their existing standing; app uploads use the same verified OAuth caller.
import { equal, ok, test } from '@yaks/testing'
import { bearerFor, connector, fresh, seed, signIn } from './probe.ts'

test('OAuth names the account and opens admin doors without a website cookie', async () => {
  let k = await fresh()
  try {
    let ownerToken = await bearerFor(k, k.owner.cookie)
    let them = await seed(k, [{ slug: 'oauth-doors', apps: ['files'] }])
    let token = await bearerFor(k, them.cookie)
    let other = await signIn(k)
    let otherToken = await bearerFor(k, other.cookie)
    let bearer = (token: string) => ({ authorization: `Bearer ${token}` })
    let get = (path: string, headers: Record<string, string> = {}) =>
      k.at(k.host, path, { headers })
    let status = async (
      path: string,
      headers: Record<string, string>,
      want: number,
    ) => {
      let res = await get(path, headers)
      equal(res.status, want)
      await res.body?.cancel()
    }
    let metadata = await (await get('/.well-known/oauth-authorization-server'))
      .json()
    equal(metadata.userinfo_endpoint, `https://${k.host}/oauth/userinfo`)
    for (
      let [credential, person] of [[ownerToken, k.owner], [
        token,
        them,
      ]] as const
    ) {
      let res = await get('/oauth/userinfo', bearer(credential))
      equal(res.status, 200)
      equal(res.headers.get('cache-control'), 'private, no-store')
      equal(await res.json(), { sub: person.person, email: person.email })
    }
    await status('/oauth/userinfo', {}, 401)
    await status('/oauth/userinfo', { cookie: k.owner.cookie }, 401)
    await status('/oauth/userinfo', {
      ...bearer('invalid'),
      cookie: k.owner.cookie,
    }, 401)
    let challenge = await get('/oauth/userinfo', bearer('invalid'))
    ok(challenge.headers.get('www-authenticate')?.includes('Bearer'))
    await challenge.body?.cancel()
    let post = await k.at(k.host, '/oauth/userinfo', {
      method: 'POST',
      headers: bearer(token),
    })
    equal(post.status, 405)
    await post.body?.cancel()

    for (let path of ['/api/fee', '/api/move']) {
      await status(path, bearer(ownerToken), 200)
      await status(path, { cookie: k.owner.cookie }, 200)
      await status(path, bearer(token), 403)
      await status(path, {}, 403)
      await status(path, { ...bearer('invalid'), cookie: k.owner.cookie }, 403)
      await status(path, {
        authorization: 'Basic invalid',
        cookie: k.owner.cookie,
      }, 403)
    }
    let fee = await k.at(k.host, '/api/fee', {
      method: 'POST',
      headers: {
        ...bearer(ownerToken),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'bps=321',
    })
    equal(fee.status, 200)
    equal((await fee.json()).bps, 321)
    let readFee = await get('/api/fee', { cookie: k.owner.cookie })
    equal((await readFee.json()).bps, 321)
    let move = await k.at(k.host, '/api/move?store=yak%2Fplatform&rehearse=1', {
      method: 'POST',
      headers: bearer(ownerToken),
    })
    equal(move.status, 200)
    await move.body?.cancel()

    let tunnel = '/api/tunnel?space=oauth-doors'
    await status(tunnel, bearer(token), 200)
    await status(tunnel, bearer(ownerToken), 200)
    await status(tunnel, { cookie: them.cookie }, 200)
    await status(tunnel, bearer(otherToken), 403)
    await status(tunnel, { ...bearer('invalid'), cookie: them.cookie }, 403)
    let change = await k.at(k.host, '/api/tunnel', {
      method: 'POST',
      headers: {
        ...bearer(token),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'space=oauth-doors&do=disconnect',
    })
    equal(change.status, 404)
    equal((await change.json()).error.code, 'no_tunnel')

    // A pasted grant remains a connector/app credential, not an admin door.
    let grant = await connector(k, k.owner.cookie).answer('grant', {})
    let held = ok(/^yak login (\S+)/.exec(grant.text)?.[1])
    for (let path of ['/api/fee', '/api/move', tunnel]) {
      await status(path, { ...bearer(held), cookie: k.owner.cookie }, 403)
    }
    await status('/oauth/userinfo', bearer(held), 401)

    let agent = connector(k, them.cookie)
    await agent.answer('app_set', {
      space: 'oauth-doors',
      app: 'files',
      access: 'private',
    })
    let bytes = new TextEncoder().encode('OAuth-uploaded bytes')
    let upload = await k.at('oauth-doors.yaks.app', '/files/api/blob', {
      method: 'POST',
      headers: { ...bearer(token), 'content-type': 'text/plain' },
      body: bytes,
    })
    equal(upload.status, 200)
    let file = await upload.json()
    let download = await k.at('oauth-doors.yaks.app', file.url, {
      headers: bearer(token),
    })
    equal(download.status, 200)
    equal(new Uint8Array(await download.arrayBuffer()), bytes)
    for (let credential of [otherToken, 'invalid']) {
      let res = await k.at('oauth-doors.yaks.app', '/files/api/blob', {
        method: 'POST',
        headers: {
          ...bearer(credential),
          cookie: them.cookie,
          'content-type': 'text/plain',
        },
        body: bytes,
      })
      equal(res.status, credential == 'invalid' ? 401 : 403)
      await res.body?.cancel()
    }
  } finally {
    await k.stop()
  }
})
