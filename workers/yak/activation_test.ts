import { equal, test } from '@yaks/testing'
import {
  activation,
  current,
  fetchActivation,
  type Storage,
} from './activation.ts'
import { type State, Store } from './graph.ts'
import type { Env } from './env.ts'

let OLD = 'a'.repeat(40), NEW = 'b'.repeat(40)
let PATH = '/accounts/account/workers/scripts/yak'
let request = (commit = NEW, deployment = 'before', path = PATH) =>
  new Request('https://yaks.app/_activate', {
    method: path.split('?')[0].endsWith('/deployments') ? 'POST' : 'PUT',
    headers: {
      authorization: 'Bearer build-token',
      'content-type': 'multipart/form-data; boundary=build',
      'x-yak-activation-path': path,
      'x-yak-deployment': deployment,
      'x-yak-commit': commit,
    },
    body: path.split('?')[0].endsWith('/deployments')
      ? JSON.stringify({
        strategy: 'percentage',
        versions: [{ version_id: 'historical', percentage: 100 }],
      })
      : 'uploaded worker',
  })
let storage = (): Storage => {
  let data = new Map<string, unknown>()
  return {
    get: <T>(key: string) => Promise.resolve(data.get(key) as T | undefined),
    put: (key, value) => {
      data.set(key, structuredClone(value))
      return Promise.resolve()
    },
  }
}
let response = (result: unknown, status = 200) =>
  Response.json({ success: status < 400, result }, { status })
let serving = (id = 'before', commit = OLD, version = id) =>
  response({
    deployments: [{
      id,
      created_on: '2026-10-12T12:00:00Z',
      versions: [{ version_id: version, percentage: 100 }],
      annotations: { 'workers/message': commit },
    }],
  })
let deferred = () => {
  let resolve!: () => void
  let promise = new Promise<void>((done) => resolve = done)
  return { promise, resolve }
}
let fetcher = (
  read: (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => Response | Promise<Response>,
): typeof fetch =>
(input, init) => Promise.resolve().then(() => read(input, init))

test('activation serializes a newer deployment before refusing its waiting ancestor', async () => {
  let entered = deferred(), release = deferred()
  let id = 'before', commit = OLD, writes = 0
  let gate = activation(storage(), 'account', async (_input, init) => {
    if (init?.method == null) return serving(id, commit)
    writes++
    entered.resolve()
    await release.promise
    id = 'after'
    commit = NEW
    return response({ id })
  })
  let newer = gate(request())
  await entered.promise
  let older = gate(request(OLD))
  release.resolve()
  equal((await newer).status, 200)
  let refused = await older
  equal(refused.status, 409)
  equal(refused.headers.get('x-yak-activation-conflict'), '1')
  equal(writes, 1)
})

test('activation refuses foreign paths and verifies the supplied credential', async () => {
  let calls = 0
  let gate = activation(
    storage(),
    'account',
    fetcher((_input, init) => {
      calls++
      equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer build-token',
      )
      return response(null, 403)
    }),
  )
  for (
    let path of [
      '/accounts/other/workers/scripts/yak',
      `${PATH}-foreign`,
      `${PATH}/secrets`,
      `${PATH}/deployments/another`,
    ]
  ) equal((await gate(request(NEW, 'before', path))).status, 400)
  equal(calls, 0)
  let missing = request()
  missing.headers.delete('authorization')
  equal((await gate(missing)).status, 401)
  equal(calls, 0)
  let denied = await gate(request())
  equal(denied.status, 403)
  equal((await denied.json()).success, false)
  equal(calls, 1)
})

test('activation keeps an uncertain result across restart until its commit is serving', async () => {
  let kept = storage(), writes = 0, arrived = false
  let ask = fetcher((input, init) => {
    if (init?.method) {
      writes++
      throw new Error('connection lost after sending the upload')
    }
    if (String(input).endsWith('/versions/after')) {
      return response({
        annotations: { 'workers/message': `inputs:digest\n${NEW}` },
      })
    }
    return arrived ? serving('after', 'inputs:digest') : serving()
  })
  equal((await activation(kept, 'account', ask)(request())).status, 502)
  let restarted = activation(kept, 'account', ask)
  equal((await restarted(request(OLD))).status, 503)
  equal(writes, 1)
  arrived = true
  let refused = await restarted(request(OLD))
  equal(refused.status, 409)
  equal(refused.headers.get('x-yak-activation-conflict'), '1')
  equal(writes, 1)
  equal(await kept.get('activation'), null)
})

test('activation holds a pending response body and retains broken or server failure outcomes', async () => {
  for (let status of [200, 500]) {
    let kept = storage(), writes = 0
    let gate = activation(
      kept,
      'account',
      fetcher((_input, init) => {
        if (!init?.method) return serving()
        writes++
        return status == 500 ? response(null, 500) : new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('response body lost'))
            },
          }),
        )
      }),
    )
    equal((await gate(request())).status, status == 200 ? 502 : 500)
    equal((await gate(request(OLD))).status, 503)
    equal(writes, 1)
  }
})

test('a definite Cloudflare refusal releases activation for the next request', async () => {
  let writes = 0
  let gate = activation(
    storage(),
    'account',
    fetcher((_input, init) => {
      if (!init?.method) return serving()
      writes++
      equal(
        new Headers(init.headers).get('content-type'),
        'multipart/form-data; boundary=build',
      )
      equal(new Headers(init.headers).get('x-yak-commit'), null)
      return response(null, writes == 1 ? 400 : 200)
    }),
  )
  equal((await gate(request())).status, 400)
  equal((await gate(request())).status, 200)
  equal(writes, 2)
})

test('first activation requires an authenticated empty deployment history', async () => {
  let writes = 0
  let ask = fetcher((_input, init) => {
    if (!init?.method) return response({ deployments: [] })
    writes++
    return response({ id: 'first' })
  })
  let gate = activation(storage(), 'account', ask)
  equal((await gate(request(NEW, 'before'))).status, 409)
  equal((await gate(request(NEW, '', `${PATH}/deployments`))).status, 200)
  equal(writes, 1)
  equal(await current(PATH, new Headers(), ask), {
    id: '',
    commits: [],
    versions: [],
  })
})

test('an uncertain historical version activation reconciles its exact version identity', async () => {
  let kept = storage(), id = 'before', version = 'historical', writes = 0
  let ask = fetcher((_input, init) => {
    if (!init?.method) return serving(id, OLD, version)
    writes++
    throw new Error('response lost after deploying a kept version')
  })
  let path = `${PATH}/deployments`
  equal(
    (await activation(kept, 'account', ask)(request(NEW, 'before', path)))
      .status,
    502,
  )
  let restarted = activation(kept, 'account', ask)
  equal((await restarted(request(NEW, 'before', path))).status, 503)
  id = 'after'
  version = 'different'
  equal((await restarted(request(NEW, 'before', path))).status, 503)
  version = 'historical'
  equal((await restarted(request(NEW, 'before', path))).status, 409)
  equal(await kept.get('activation'), null)
  equal(writes, 1)
})

test('activation preserves upload query parameters while inspecting its Worker', async () => {
  let path = `${PATH}?excludeScript=true&bindings_inherit=strict`
  let gate = activation(
    storage(),
    'account',
    fetcher((input, init) => {
      equal(
        String(input),
        `https://api.cloudflare.com/client/v4${
          init?.method ? path : `${PATH}/deployments`
        }`,
      )
      return init?.method ? response({ id: 'after' }) : serving()
    }),
  )
  equal((await gate(request(NEW, 'before', path))).status, 200)
})

test('the activation route names one Worker object and answers before graph boot', async () => {
  let name = '', writes = 0, sql = 0
  let kept = storage()
  let store = new Store({
    storage: {
      ...kept,
      put: (key: string, value: unknown) => {
        writes++
        return kept.put(key, value)
      },
      sql: {
        exec() {
          sql++
          throw new Error('activation must not open the graph')
        },
      },
    },
  } as unknown as State, { CF_ACCOUNT: 'account' })
  let env = {
    CF_ACCOUNT: 'account',
    STORE: {
      idFromName: (id: string) => name = id,
      get: () => store,
    },
  } as unknown as Env
  equal((await store.fetch(request())).status, 403)
  let asked = request(NEW, 'before', `${PATH}-staging`)
  asked.headers.delete('authorization')
  equal((await fetchActivation(asked, env)).status, 401)
  equal(name, 'yak/activation/yak-staging')
  equal(sql, 0)
  equal(writes, 0)
  name = ''
  equal(
    (await fetchActivation(request(NEW, 'before', `${PATH}-foreign`), env))
      .status,
    400,
  )
  equal(name, '')
})
