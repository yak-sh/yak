// A host's report hook writes outside its watched graph. Intake opens the
// independent tracker and preserves the failing call's attribution.

import { equal, test } from '@yaks/testing'
import { reporter } from './report.ts'
import { files } from '@yaks/tracker/file'
import { compose } from './host.ts'
import { read } from './config.ts'
import { mint } from '@yaks/graph'
import { service } from '../tracker/service.ts'
import { comp } from '../tracker/model.ts'
import { delivery } from '@yaks/tracker/remote'
import { ram } from '@yaks/ram'
import { door } from '../../workers/tracker/door.ts'
import { options, platform, store, vocab } from '../../workers/tracker/core.ts'

export let trackerConfig = (dir: string) => ({
  db: `${dir}/tracker.db`,
  tracker: { spool: `${dir}/spool` },
  plugins: [
    '@yaks/kernel',
    '@yaks/provenance',
    '@yaks/doc',
    '@yaks/tools',
    '@yaks/api',
    '@yaks/mail',
    '@yaks/wake',
    '@yaks/process',
    '@yaks/effects',
    '@yaks/tracker',
    '@yaks/timing',
  ],
})

// Reopen the composed spool and exercise both remote outcomes once at load;
// the case inspects their receipts without timing real fsyncs or composition.
let composed = await (async () => {
  let dir = await Deno.makeTempDir()
  let config = { ...trackerConfig(dir), db: ':memory:' }
  let host = await compose(config, ['graph', '@yaks/tracker'], undefined, {})
  try {
    let actor = { by: mint(), via: mint() }
    let entity = mint(), process = mint()
    let trace = () => {
      let eid = mint()
      return [{
        entity: { eid },
        trace: {
          op: 'request',
          name: 'box request',
          at: new Date().toISOString(),
        },
      }, {
        entity: { eid: mint() },
        span: { trace: eid, op: 'query', name: 'box query' },
        elapsed: { start: 0, ms: 1 },
        rows_read: { n: 5 },
      }]
    }
    let traced = trace(), mixed = trace()
    await files(config.tracker.spool).append(`${JSON.stringify(traced)}\n`)
    let resolve!: (commit: string) => void
    let commit = new Promise<string>((done) => resolve = done)
    let report = reporter(config, actor, commit, {
      command: 'yak graph query',
      roles: 'graph',
    })
    let pending = report(new Error('failure'), {
      during: { entity, process },
      tags: { handler: 'mail_post' },
    })
    let closing = report.close()
    let beforeCommit =
      (await Array.fromAsync(files(config.tracker.spool).source())).length
    resolve('a'.repeat(40))
    await pending
    await closing
    let records = await Array.fromAsync(files(config.tracker.spool).source())
    let original = records.find((record) =>
      record.rows.some((row) => row.error)
    )!
    await files(config.tracker.spool).append(
      `${JSON.stringify([...original.rows, ...mixed])}\n`,
    )
    await original.ack()
    let remote = { url: 'https://tracker.test', secret: 'test-only' }
    let tracker = store(ram(vocab, options), { sink: () => {} })
    let route = door(tracker, platform, remote.secret)
    let go = ((input, init) => route(new Request(input, init))) as typeof fetch
    let failed = (() =>
      Promise.resolve(new Response(null, { status: 503 }))) as typeof fetch
    let refused = false
    try {
      await service(host, { remote, fetch: failed })
    } catch {
      refused = true
    }
    let [record] = await Array.fromAsync(files(config.tracker.spool).source())
    let retainedRows = record.rows.length
    let outageTraces = (await host.graph.read('.trace *')).length
    await delivery(remote, go)(record.rows.filter((row) =>
      row.error
    ))
    await service(host, { remote, fetch: go })
    let remoteRows = await tracker.graph.read('.error ?created ?during *')
    let local = await host.graph.read('.error ?created ?during *')
    let eid = original.rows.find((row) => row.error)!.entity.eid
    let rows = local.filter((row) => row.entity.eid == eid)
    let notices = local.filter((row) => row.entity.eid != eid)
    return {
      actor,
      entity,
      beforeCommit,
      refused,
      retainedRows,
      outageTraces,
      remoteRows,
      rows,
      notices,
      remoteTraces: await tracker.graph.read('.trace *'),
      traces: (await host.graph.read('.trace *')).length,
      spans: (await host.graph.read('.span *')).length,
      left: await Array.fromAsync(files(config.tracker.spool).source()),
    }
  } finally {
    await host.close()
    await Deno.remove(dir, { recursive: true })
  }
})()
test('a composed tracker drains a separate spool, preserving error attribution', () => {
  let { actor, entity, remoteRows, rows } = composed
  equal(composed.beforeCommit, 1)
  equal(composed.refused, true)
  equal(composed.retainedRows, 3)
  // Both pure and mixed traces are admitted locally during the remote outage.
  equal(composed.outageTraces, 2)
  equal(remoteRows.length, 1)
  equal(remoteRows[0].entity.eid, rows[0].entity.eid)
  let { source, handler, command } = comp(remoteRows[0], 'error')
    .tags as Record<string, string>
  equal([source, handler, command], ['box', 'mail_post', 'yak graph query'])
  equal(comp(remoteRows[0], 'created').by, actor.by)
  equal(comp(remoteRows[0], 'during').entity, entity)
  equal(composed.remoteTraces, [])
  equal([composed.traces, composed.spans], [2, 2])
  // The outage admits its own local health notice, not another delivery.
  equal(composed.notices.length, 1)
  equal(comp(composed.notices[0], 'error').fault, 'tracker_sync:delivery')
  equal(rows.length, 1)
  equal(comp(rows[0], 'created').by, actor.by)
  equal(comp(rows[0], 'created').via, actor.via)
  equal(comp(rows[0], 'during').entity, entity)
  equal(composed.left, [])
})

test('a reporter leaves the caller untouched when its spool cannot open', async () => {
  let blocked = Deno.makeTempFileSync()
  let log = console.error
  let errors: unknown[][] = []
  console.error = (...args) => {
    errors.push(args)
  }
  try {
    await reporter({ tracker: { spool: `${blocked}/spool` } })(Error('broken'))
    // The record the spool refused is written where an operator still sees it.
    equal(errors.length, 2)
    equal(errors[1].some((part) => String(part).includes('broken')), true)
  } finally {
    console.error = log
    Deno.removeSync(blocked)
  }
})

test('relative reporter spool resolves with its config, not process cwd', async () => {
  let dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(
      `${dir}/yak.json`,
      JSON.stringify({
        db: 'tracker.db',
        tracker: { spool: 'spool' },
      }),
    )
    equal(read(`${dir}/yak.json`).tracker?.spool, `${dir}/spool`)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
