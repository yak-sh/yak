// Pure graph/vault and HTTP seams: no host boot, filesystem, live graph or mail.
import { equal, ok, test } from '@yaks/testing'
import { assertThrows } from '@std/assert'
import { type Bundle, type Graph, graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { personaDoc } from '@yaks/persona/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { provisionalDoc } from '@yaks/effects'
import { ramVault, sealed, secretEid, secrets, secretsDoc } from '@yaks/secrets'
import {
  authorize,
  connectionsDoc,
  credential,
  integrationEid,
} from '@yaks/connections'
import { yaksApp } from '@yaks/connections/yaks-app'
import { registration } from '../packages/connections/clients.ts'
import {
  migrateAdminSessions,
  migrationArgs,
  type MigrationHost,
  type MigrationOptions,
} from './migrate-admin-sessions.ts'

const ORIGIN = 'https://example.test'
const ADDRESS = 'person@example.test'
const COOKIE = 'held-cookie-private'
const BEARER = 'oauth-bearer-private'
const SOURCE = `yaks.app session ${ADDRESS}`

let setup = async () => {
  let vocab = loadVocab(
    [
      kernelDoc,
      personaDoc,
      toolsDoc,
      edgeDoc,
      secretsDoc,
      provisionalDoc,
      connectionsDoc,
    ],
    [edgeKeywords],
  )
  let vault = ramVault(), owner = mint()
  let g: Graph = graph({
    storage: ram(vocab),
    vocab,
    plugins: [secrets(vault, (batch) => g.apply(batch, { trusted: true }))],
  })
  await g.apply([
    { entity: { eid: owner }, person: {} },
    sealed(SOURCE, COOKIE),
    {
      entity: { eid: integrationEid('yaks.app') },
      integration: {
        name: 'yaks.app',
        title: 'yaks.app',
        client: `mcp ${ORIGIN}/mcp`,
        authorize: `${ORIGIN}/oauth/authorize`,
        token: `${ORIGIN}/oauth/token`,
        userinfo: `${ORIGIN}/oauth/userinfo`,
        hosts: ['example.test'],
      },
    },
    registration(`mcp ${ORIGIN}/mcp`, { id: 'test-client' }),
  ])
  let clears = 0
  let h: MigrationHost = {
    graph: g,
    vault,
    owner,
    clearCurrent: () => {
      clears++
      return true
    },
  }
  return { g, vault, owner, h, clears: () => clears }
}

let connection = (
  owner: string,
  record: unknown,
  more: Bundle = { entity: { eid: mint() } },
): Bundle => {
  let name = `connection:${more.entity.eid}`
  return {
    ...sealed(name, JSON.stringify(record)),
    connection: {
      owner,
      integration: 'yaks.app',
      account: ADDRESS,
      status: 'connected',
    },
  }
}
let record = (extra = {}) => ({
  access_token: BEARER,
  website_session: COOKIE,
  ...extra,
})

let network = (returned = ADDRESS) => {
  let calls: string[] = []
  let go: typeof fetch = (input, init) => {
    let url = new URL(input instanceof Request ? input.url : String(input))
    calls.push(url.pathname)
    let headers = new Headers(init?.headers)
    equal(init?.redirect, 'manual')
    let form = new URLSearchParams(String(init?.body))
    if (url.pathname == '/oauth/authorize') {
      equal(headers.get('cookie'), `yak_session=${COOKIE}`)
      return Promise.resolve(
        new Response(
          `<input name="q" value="${
            url.search.slice(1).replaceAll('&', '&amp;')
          }"><input name="consent" value="consent">`,
        ),
      )
    }
    if (url.pathname == '/oauth/allow') {
      equal(headers.get('cookie'), `yak_session=${COOKIE}`)
      equal(form.get('consent'), 'consent')
      let q = new URLSearchParams(form.get('q')!)
      return Promise.resolve(
        new Response(null, {
          status: 303,
          headers: {
            location: `http://localhost:8765/oauth/callback?state=${
              q.get('state')
            }&code=private-code`,
          },
        }),
      )
    }
    if (url.pathname == '/oauth/token') {
      return Promise.resolve(
        Response.json({
          access_token: BEARER,
          refresh_token: 'private-refresh',
          expires_in: 3600,
        }),
      )
    }
    if (url.pathname == '/oauth/userinfo') {
      equal(headers.get('authorization'), `Bearer ${BEARER}`)
      return Promise.resolve(
        Response.json({ sub: 'remote-id', email: returned }),
      )
    }
    throw new Error('unexpected HTTP request')
  }
  return { go, calls }
}
let authSeam = (h: MigrationHost, go: typeof fetch): MigrationOptions => ({
  authorization: (session) =>
    authorize(
      h,
      yaksApp(h, {
        origin: ORIGIN,
        fetch: go,
        session,
        code: () => {
          throw new Error('migration must not read mail')
        },
      }),
    ),
  bearer: (id) => credential({ ...h, fetch: go }, id),
})
let failAuth =
  (count: () => void): MigrationOptions['authorization'] => () => ({
    run: () => {
      count()
      throw new Error(`failure containing ${COOKIE}`)
    },
    close: () => Promise.resolve(),
  })

test('admin session migration preserves the cookie, verifies OAuth identity and sealing, then removes source and current', async () => {
  let { h, g, vault, clears } = await setup(), { go, calls } = network()
  let was = globalThis.fetch
  globalThis.fetch = go
  try {
    let report = await migrateAdminSessions(h, authSeam(h, go))
    equal(report, {
      found: 1,
      authorized: 1,
      reused: 0,
      deleted: 1,
      failed: 0,
      remaining: 0,
      currentRemoved: true,
    })
    equal(calls, [
      '/oauth/authorize',
      '/oauth/allow',
      '/oauth/token',
      '/oauth/userinfo',
    ])
    equal(await vault.read(secretEid(SOURCE)), undefined)
    equal((await g.get([secretEid(SOURCE)]))[0]?.secret, undefined)
    equal(clears(), 1)
    let [b] = await g.read('.connection&*')
    let saved = JSON.parse(vault.read(b.entity.eid)!.value!)
    equal(saved.website_session, COOKIE)
    equal(saved.access_token, BEARER)
    ok(!JSON.stringify(await g.read('.secret&*')).includes(COOKIE))
    ok(!JSON.stringify(await g.read('.secret&*')).includes(BEARER))
    ok(!JSON.stringify(report).includes(COOKIE))
    let again = await migrateAdminSessions(h, authSeam(h, go))
    equal(again.found, 0)
    equal(again.authorized, 0)
    equal(calls.length, 4)
  } finally {
    globalThis.fetch = was
  }
})

test('admin session migration refuses another returned account and retains source/current', async () => {
  let { h, vault, clears } = await setup(),
    { go } = network('other@example.test')
  let was = globalThis.fetch
  globalThis.fetch = go
  try {
    let report = await migrateAdminSessions(h, authSeam(h, go))
    equal(report.failed, 1)
    equal(report.deleted, 0)
    equal(report.remaining, 1)
    equal(clears(), 0)
    equal(vault.read(secretEid(SOURCE))?.value, COOKIE)
  } finally {
    globalThis.fetch = was
  }
})

test('interruption after connection sealing retries source deletion without reauthorization', async () => {
  let { h, g, vault } = await setup(), { go, calls } = network()
  let rejectDelete = true, was = globalThis.fetch
  h.graph = {
    ...g,
    apply: (batch, opts) => {
      if (
        rejectDelete &&
        batch.some((b) =>
          b.entity.eid == secretEid(SOURCE) && b.secret === null
        )
      ) {
        throw new Error(`interrupted ${COOKIE}`)
      }
      return g.apply(batch, opts)
    },
  }
  globalThis.fetch = go
  try {
    let first = await migrateAdminSessions(h, authSeam(h, go))
    equal(first.failed, 1)
    equal(first.currentRemoved, false)
    equal(vault.read(secretEid(SOURCE))?.value, COOKIE)
    rejectDelete = false
    let retry = await migrateAdminSessions(h, authSeam(h, go))
    equal(retry.reused, 1)
    equal(retry.authorized, 0)
    equal(retry.deleted, 1)
    equal(retry.failed, 0)
    equal(calls.length, 4)
  } finally {
    globalThis.fetch = was
  }
})

test('reuse requires a matching owner, identity, status, sealed handle, access token and website session', async () => {
  for (
    let variant of [
      'owner',
      'integration',
      'account',
      'broken',
      'cookie',
      'token',
      'malformed',
      'missing',
      'handle',
      'provisional',
      'exception',
      'invalid-bearer',
    ]
  ) {
    let { h, g, vault, clears } = await setup()
    let b = connection(h.owner, record())
    let c = b.connection as Record<string, unknown>
    if (variant == 'owner') c.owner = mint()
    if (variant == 'integration') c.integration = 'another'
    if (variant == 'account') c.account = 'another@example.test'
    if (variant == 'broken') c.status = 'broken'
    if (variant == 'cookie') {
      b = connection(h.owner, record({ website_session: 'another-cookie' }))
    }
    if (variant == 'token') b = connection(h.owner, { website_session: COOKIE })
    if (variant == 'malformed') b = connection(h.owner, ['not', 'a record'])
    await g.apply([b])
    let saved = vault.read(b.entity.eid)!
    if (variant == 'missing') vault.drop(b.entity.eid)
    if (variant == 'handle') {
      vault.seal(b.entity.eid, { ...saved, handle: 'wrong-handle' })
    }
    if (variant == 'provisional') {
      await g.apply([{ entity: b.entity, provisional: { note: 'saving' } }])
    }
    if (variant == 'exception') {
      await g.apply([{ entity: b.entity, exception: {} }])
    }
    let begins = 0
    let report = await migrateAdminSessions(h, {
      authorization: failAuth(() => begins++),
      bearer: () =>
        Promise.resolve(variant == 'invalid-bearer' ? undefined : BEARER),
    })
    equal(begins, 1, variant)
    equal(report.failed, 1, variant)
    equal(report.deleted, 0, variant)
    equal(clears(), 0, variant)
    equal(vault.read(secretEid(SOURCE))?.value, COOKIE, variant)
    ok(!JSON.stringify(report).includes(COOKIE))
  }
})

test('valid existing grant with the same cookie refreshes without another authorization', async () => {
  let { h, g, vault } = await setup(), { go, calls } = network()
  let b = connection(
    h.owner,
    record({ expires_at: 1, refresh_token: 'refresh' }),
  )
  await g.apply([b])
  let report = await migrateAdminSessions(h, {
    authorization: () => {
      throw new Error('no reauthorization')
    },
    bearer: (id) => credential({ ...h, fetch: go }, id),
  })
  equal(report.reused, 1)
  equal(report.failed, 0)
  equal(calls, ['/oauth/token'])
  equal(JSON.parse(vault.read(b.entity.eid)!.value!).website_session, COOKIE)
})

test('partial success keeps current, retries only failures, and leaves other zones untouched', async () => {
  let { h, g, vault, clears } = await setup()
  let second = 'yaks.app session second@example.test',
    other = 'yaks.fyi session staging@example.test'
  await g.apply([
    sealed(second, 'second-cookie'),
    sealed(other, 'staging-cookie'),
    connection(h.owner, record()),
  ])
  let first = await migrateAdminSessions(h, {
    authorization: failAuth(() => {}),
    bearer: () => Promise.resolve(BEARER),
  })
  equal(first.found, 2)
  equal(first.deleted, 1)
  equal(first.failed, 1)
  equal(first.remaining, 1)
  equal(clears(), 0)
  let b = connection(h.owner, record({ website_session: 'second-cookie' }))
  ;(b.connection as Record<string, unknown>).account = 'second@example.test'
  await g.apply([b])
  let retry = await migrateAdminSessions(h, {
    authorization: () => {
      throw new Error('no auth')
    },
    bearer: () => Promise.resolve(BEARER),
  })
  equal(retry.found, 1)
  equal(retry.reused, 1)
  equal(retry.failed, 0)
  equal(clears(), 1)
  equal(vault.read(secretEid(other))?.value, 'staging-cookie')
})

test('missing source value and orphaned vault source fail closed; current removal itself is retriable', async () => {
  let { h, vault, clears } = await setup()
  vault.drop(secretEid(SOURCE))
  let missing = await migrateAdminSessions(h)
  equal(missing.failed, 1)
  equal(missing.remaining, 1)
  equal(clears(), 0)
  let fresh = await setup()
  // A value with no graph source is never silently forgotten.
  fresh.vault.seal(mint(), {
    name: `${SOURCE}.orphan`,
    handle: 'handle',
    value: 'private',
  })
  let orphan = await migrateAdminSessions(fresh.h, {
    authorization: failAuth(() => {}),
  })
  equal(orphan.failed, 2)
  equal(fresh.clears(), 0)
  let ready = await setup()
  await ready.g.apply([connection(ready.owner, record())])
  ready.h.clearCurrent = () => {
    throw new Error(COOKIE)
  }
  let removed = await migrateAdminSessions(ready.h, {
    bearer: () => Promise.resolve(BEARER),
  })
  equal(removed.deleted, 1)
  equal(removed.failed, 1)
  equal(removed.currentRemoved, false)
  ready.h.clearCurrent = () => true
  let retry = await migrateAdminSessions(ready.h)
  equal(retry.found, 0)
  equal(retry.failed, 0)
  equal(retry.currentRemoved, true)
})

test('migration requires explicit config and state instead of discovering live defaults', () => {
  equal(migrationArgs(['--config', 'copy.json', '--state', 'copy-state']), {
    config: 'copy.json',
    state: 'copy-state',
  })
  for (
    let args of [
      [],
      ['--state', 'copy-state'],
      ['--config', 'copy.json'],
      ['--config'],
      ['--config', '--state'],
      ['--config', 'one', '--config', 'two'],
      ['--unknown', 'value'],
    ]
  ) {
    assertThrows(() => migrationArgs(args), Error, 'both required')
  }
})
