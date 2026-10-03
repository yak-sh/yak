// Terminal authorization works without a harness and keeps bot callbacks in the vault.
import { compose } from '@yaks/cli/host'
import { type Comp, mint } from '@yaks/graph'
import { reveal } from '@yaks/secrets'
import { equal, ok, test } from '@yaks/testing'
import { authorize, integrationEid, pick, signins } from './mod.ts'
import { authorizeCLI } from './cli.ts'

let open = () =>
  compose({
    db: ':memory:',
    plugins: [
      '@yaks/kernel',
      '@yaks/id',
      '@yaks/doc',
      '@yaks/effects',
      '@yaks/secrets',
      '@yaks/connections',
    ],
  }, ['graph'])
test('auth starts OpenAI without a harness or provider owner', async () => {
  let host = await open(), owner = mint()
  let auth = authorize({ graph: host.graph, vault: host.vault, owner })
  try {
    ok((await auth.run('list')).servers?.includes('OpenAI'))
    let begun = await auth.run('begin', 'openai')
    let url = new URL(begun.url!)
    equal(url.origin, 'https://auth.openai.com')
    equal(
      url.searchParams.get('redirect_uri'),
      'http://127.0.0.1:1455/auth/callback',
    )
    equal(url.searchParams.get('code_challenge_method'), 'S256')
    let rows = await host.graph.read('.connection')
    equal(rows.length, 1)
    equal((rows[0].connection as Comp)?.owner, owner)
  } finally {
    await auth.close()
    await host.close()
  }
})

test('auth extension discovers an integration and holds bot session through account renewal', async () => {
  let host = await open(), owner = mint()
  let original = globalThis.fetch
  globalThis.fetch = (() =>
    Promise.resolve(Response.json({
      access_token: 'bearer',
      refresh_token: 'refresh',
      id_token: 'header.' + btoa(JSON.stringify({ email: 'bot@example.org' })) +
        '.sig',
    }))) as typeof fetch
  let prepared: string[] = []
  let auth = authorize({ graph: host.graph, vault: host.vault, owner }, {
    prepare: async (name, as) => {
      prepared.push(`${name}:${as}`)
      await host.graph.apply([{
        entity: { eid: integrationEid(name) },
        integration: {
          name,
          hosts: ['example.org'],
          authorize: 'https://example.org/authorize',
          token: 'https://example.org/token',
          client_id: 'client',
        },
      }])
      return { integration: name }
    },
    callback: (_target, url) => {
      let state = new URL(url).searchParams.get('state')!
      return Promise.resolve({
        callback: 'http://localhost:8765/oauth/callback?code=code&state=' +
          state,
        session: 'private-website-session',
      })
    },
  })
  try {
    let io = {
      say: () => {},
      hidden: () => {
        throw new Error('bot should not need a paste')
      },
    }
    equal(
      await authorizeCLI(auth, 'site', io, 'bot@example.org'),
      'site connected.',
    )
    equal(prepared, ['site:bot@example.org'])
    let b = await pick(host.graph.read, owner, 'site')
    if (!b) throw new Error('connection missing')
    equal((b.connection as Comp)?.account, 'bot@example.org')
    let raw = await reveal(host.vault, String((b.secret as Comp)?.name))
    equal(JSON.parse(raw!).website_session, 'private-website-session')
    equal(
      await signins({ g: host.graph, vault: host.vault }).key(owner, 'site'),
      'bearer',
    )
    ok(
      !JSON.stringify(await host.graph.read('.connection&*')).includes(
        'private-website-session',
      ),
    )
  } finally {
    globalThis.fetch = original
    await auth.close()
    await host.close()
  }
})
