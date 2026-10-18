// Lifecycle contracts use independent RAM graphs allocated before case timing.
import { equal, test, throws } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { machineDoc } from '@yaks/machine/vocab'
import { homeDoc } from '@yaks/harness/vocab'
import { sandboxDoc } from './vocab.ts'
import { sandboxConnect, sandboxDispose, sandboxNew } from './lifecycle.ts'
import { provisioning } from './effects.ts'
import { effects } from '@yaks/effects'
import type { SandboxProvider } from './provider.ts'
import type { Workspace } from '@yaks/machine'

let vocab = loadVocab([kernelDoc, machineDoc, homeDoc, sandboxDoc])
let fixture = async () => {
  let g = graph({ storage: ram(vocab), vocab })
  let machine = 'b3bc6db8-d998-4cde-b14e-c56ef2af59ab'
  await g.apply([{ entity: { eid: machine }, machine: {} }])
  let requested: string[] = []
  let disposed: string[] = []
  let fail = false
  let workspace = {} as Workspace
  let provider: SandboxProvider = {
    request: async (ref) => {
      let row = (await g.get([ref.id]))[0]
      if (!row?.pending || !row.sandbox || !row.workspace) {
        throw new Error('request before intention')
      }
      requested.push(ref.id)
      if (fail) throw new Error('provider failed')
      return { workspace, root: '/work', address: 'box-' + ref.id }
    },
    connect: () => Promise.resolve({ workspace, root: '/work' }),
    dispose: (ref) => {
      if (fail) return Promise.reject(new Error('provider failed'))
      disposed.push(ref.id)
      return Promise.resolve()
    },
    export: async function* () {},
  }
  let providers = { fixture: { machine, provider } }
  let run = async (row: Bundle) =>
    await provisioning({ providers })(
      { entity: row.entity } as Parameters<ReturnType<typeof provisioning>>[0],
      g,
      (b) => g.apply(b),
    )
  return {
    g,
    machine,
    providers,
    requested,
    disposed,
    run,
    fail: () => {
      fail = true
    },
  }
}
let create = await fixture()
let provision = await fixture()
let pendingConnect = await fixture()
let repeat = await fixture()
let retry = await fixture()
let racing = await fixture()
let failed = await fixture()
let disposal = await fixture()
let disposalFailed = await fixture()
let placement = await fixture()
let replay = await fixture()
let home = await fixture()
let id = '3425d08e-7b55-40da-a55c-9acde6096816'
let seed = async (f: Awaited<ReturnType<typeof fixture>>) =>
  await sandboxNew(f.g, f.providers, {
    id,
    machine: f.machine,
    provider: 'fixture',
  })
let provisionRow = await seed(provision)
await seed(pendingConnect)
let repeatRow = await seed(repeat)
await repeat.run(repeatRow)
let failedRow = await seed(failed)
let retryRow = await seed(retry)
let racingRow = await seed(racing)
let disposalRow = await seed(disposal)
let disposalFailedRow = await seed(disposalFailed)
let replayRow = await seed(replay)
let homeRow = await seed(home)
await home.run(homeRow)
await disposal.run(disposalRow)
await disposalFailed.run(disposalFailedRow)

test('sandbox creation persists identity and intention before provisioning', async () => {
  let row = await seed(create)
  equal(create.requested, [])
  equal(!!row.pending, true)
})
test('provisioning settles a recorded sandbox workspace', async () => {
  await provision.run(provisionRow)
  equal(provision.requested, [id])
  let recorded = (await provision.g.get([id]))[0]
  equal(recorded.pending, undefined)
  equal(recorded.workspace, { machine: provision.machine, root: '/work' })
})
test('sandbox pending blocks reconnect', async () => {
  await throws(
    () => sandboxConnect(pendingConnect.g, pendingConnect.providers, id),
    'not ready',
  )
})
test('successful sandbox provisioning does not run twice', async () => {
  await repeat.run(repeatRow)
  equal(repeat.requested.length, 1)
})
test('ready sandbox reconnect uses its existing resource', async () => {
  equal((await sandboxConnect(repeat.g, repeat.providers, id)).root, '/work')
})
test('failed provisioning records failure and cannot silently request again', async () => {
  failed.fail()
  await throws(() => failed.run(failedRow), 'provider failed')
  await failed.run(failedRow)
  let row = (await failed.g.get([id]))[0]
  equal(row.pending, undefined)
  equal(!!row.failed, true)
  equal(failed.requested.length, 1)
})
test('explicit disposal confirms release once and forbids identity reuse', async () => {
  await sandboxDispose(disposal.g, disposal.providers, id)
  await sandboxDispose(disposal.g, disposal.providers, id)
  equal(disposal.disposed, [id])
  equal(!!(await disposal.g.get([id]))[0].released, true)
  await throws(() => seed(disposal), 'cannot be reused')
  await throws(
    () => sandboxConnect(disposal.g, disposal.providers, id),
    'not ready',
  )
})
test('failed disposal never records released', async () => {
  disposalFailed.fail()
  await throws(
    () => sandboxDispose(disposalFailed.g, disposalFailed.providers, id),
    'provider failed',
  )
  equal((await disposalFailed.g.get([id]))[0].released, undefined)
})
test('sandbox placement never falls back to the host computer', async () => {
  await throws(
    () =>
      sandboxNew(placement.g, placement.providers, { id, provider: 'fixture' }),
    'recorded computer',
  )
  equal(placement.requested, [])
  equal((await placement.g.get([id])).length, 0)
})

test('replaying an identical sandbox intention preserves pending or ready state', async () => {
  equal(!!(await seed(replay)).pending, true)
  await replay.run(replayRow)
  equal((await seed(replay)).pending, undefined)
  equal(replay.requested, [id])
})
test('a sandbox id cannot be rebound to different provenance or placement', async () => {
  for (
    let change of [{ provider: 'different' }, { machine: undefined }, {
      from: 'different',
    }, { image: 'different' }]
  ) {
    await throws(
      () =>
        sandboxNew(home.g, home.providers, {
          id,
          machine: home.machine,
          provider: 'fixture',
          ...change,
        }),
      'request changed',
    )
  }
  equal(home.requested, [id])
})
test('selecting another home does not dispose a sandbox', async () => {
  await home.g.apply([{
    entity: { eid: '2281a5d0-af83-491a-8b76-9d8644b99513' },
    home: { workspace: id },
  }])
  await home.g.apply([{
    entity: { eid: '2281a5d0-af83-491a-8b76-9d8644b99513' },
    home: { workspace: null },
  }])
  equal(home.disposed, [])
  equal((await home.g.get([id]))[0].released, undefined)
})

test('a retryable provisioning failure retains its durable pending intention', async () => {
  retry.fail()
  await throws(() =>
    provisioning({ providers: retry.providers })(
      { entity: retryRow.entity } as Parameters<
        ReturnType<typeof provisioning>
      >[0],
      retry.g,
      (b) => retry.g.apply(b),
      { last: () => false, progressed: () => Promise.resolve() },
    ), 'provider failed')
  let row = (await retry.g.get([id]))[0]
  equal(!!row.pending, true)
  equal(row.failed, undefined)
})
let provider = racing.providers.fixture.provider
let initialRequest = provider.request!
provider.request = async (ref) => {
  let connection = await initialRequest(ref)
  await racing.g.apply([{ entity: racingRow.entity, released: {} }])
  return connection
}
let raceError = ''
try {
  await racing.run(racingRow)
} catch (e) {
  raceError = String(e)
}
test('late provisioning cannot overwrite a confirmed release', async () => {
  equal(/stale|changed/i.test(raceError), true)
  let row = (await racing.g.get([id]))[0]
  equal(!!row.released, true)
  equal((row.workspace as { root?: string }).root, undefined)
})
let triggered = await fixture()
let fx = effects(vocab, { write: (b) => effectGraph.apply(b) })
let effectGraph = graph({ storage: ram(vocab), vocab, plugins: [fx] })
await effectGraph.apply([{ entity: { eid: triggered.machine }, machine: {} }])
fx.handle({
  sandbox_provision: provisioning({
    providers: {
      fixture: {
        machine: triggered.machine,
        provider: {
          ...triggered.providers.fixture.provider,
          request: () =>
            Promise.resolve({ workspace: {} as Workspace, root: '/triggered' }),
        },
      },
    },
  }),
})
await sandboxNew(effectGraph, triggered.providers, {
  id,
  machine: triggered.machine,
  provider: 'fixture',
})
let triggeredRow = (await effectGraph.get([id]))[0]
test('the declared provisioning effect settles a committed sandbox intention', () => {
  equal(triggeredRow.pending, undefined)
  equal((triggeredRow.workspace as { root: string }).root, '/triggered')
})
