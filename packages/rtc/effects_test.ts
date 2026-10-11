// Lease cleanup through the declared effect: only fired SFU rows reach the
// provider, and an unsuccessful close keeps the row for another attempt.

import { equal, test } from '@yaks/testing'
import { effects as registry } from '@yaks/effects'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { wakeDoc } from '@yaks/wake/vocab'
import type { Realtime } from './door.ts'
import { effects, type Options } from './effects.ts'
import { rtcDoc } from './vocab.ts'

let vocab = loadVocab([wakeDoc, rtcDoc])
let rig = (options: Options = {}) => {
  let reports: unknown[] = []
  let fx = registry(vocab, {
    report: (error) => reports.push(error),
    write: (bundles) => g.apply(bundles, { trusted: true }),
  })
  fx.handle(effects(null, options))
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx] })
  return {
    g,
    fx,
    reports,
    write: (bundles: Parameters<typeof g.apply>[0]) =>
      g.apply(bundles, { trusted: true }),
  }
}

let fired = { at: '2026-10-11T12:00:00Z' }
let sfu = { session: 's1', key: 'hashed-key' }
let cloud = (
  status = 200,
  closing = 200,
  tracks = [{ mid: '1', status: 'active' }, { mid: '2', status: 'inactive' }],
) => {
  let sent: { path: string; method: string; body: unknown }[] = []
  let realtime: Realtime = {
    app: 'app1',
    token: 'test-token',
    fetch: (url, init) => {
      sent.push({
        path: new URL(String(url)).pathname,
        method: init!.method!,
        body: init!.body ? JSON.parse(String(init!.body)) : null,
      })
      return Promise.resolve(Response.json({
        tracks,
      }, { status: init!.method == 'GET' ? status : closing }))
    },
  }
  return { realtime, sent }
}

// A session already held by the door; the behavior under test is its wake
// firing, not opening the graph or creating the lease.
let c = cloud()
let a = rig(c)
await a.write([{ entity: { eid: 'lease' }, sfu }])

test('a fired SFU lease closes its active tracks and deletes its row', async () => {
  await a.write([{ entity: { eid: 'lease' }, fired }])
  await a.fx.idle()
  equal(c.sent, [{
    path: '/v1/apps/app1/sessions/s1',
    method: 'GET',
    body: null,
  }, {
    path: '/v1/apps/app1/sessions/s1/tracks/close',
    method: 'PUT',
    body: { tracks: [{ mid: '1' }], force: true },
  }])
  equal((await a.g.get(['lease'], ['sfu']))[0]?.sfu, undefined)
  equal(a.reports, [])
})

test('other wakes and unfired SFU leases make no Realtime calls', async () => {
  let c = cloud()
  let a = rig(c)
  await a.write([
    { entity: { eid: 'lease' }, sfu },
    { entity: { eid: 'other' }, fired },
  ])
  await a.fx.idle()
  equal(c.sent, [])
  equal((await a.g.get(['lease'], ['sfu']))[0]?.sfu, sfu)
  equal(a.reports, [])
})

for (let [status, closing] of [[500, 200], [200, 503]]) {
  test(`Realtime failure (${status}, ${closing}) keeps the lease and reports`, async () => {
    let c = cloud(status, closing)
    let a = rig(c)
    await a.write([{ entity: { eid: 'lease' }, sfu, fired }])
    await a.fx.idle()
    equal((await a.g.get(['lease'], ['sfu']))[0]?.sfu, sfu)
    equal(a.reports.length, 1)
  })
}

test('a session Realtime no longer knows is forgotten', async () => {
  let c = cloud(404)
  let a = rig(c)
  await a.write([{ entity: { eid: 'lease' }, sfu, fired }])
  await a.fx.idle()
  equal(c.sent.length, 1)
  equal((await a.g.get(['lease'], ['sfu']))[0]?.sfu, undefined)
  equal(a.reports, [])
})

test('missing credentials report and leave the lease for a later attempt', async () => {
  let a = rig()
  await a.write([{ entity: { eid: 'lease' }, sfu, fired }])
  await a.fx.idle()
  equal((await a.g.get(['lease'], ['sfu']))[0]?.sfu, sfu)
  equal(a.reports.length, 1)
})
