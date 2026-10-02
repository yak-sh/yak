// A host's report hook writes outside its watched graph. Intake opens the
// independent tracker and preserves the failing call's attribution.

import { equal, test } from '@yaks/testing'
import { reporter } from './report.ts'
import { files } from '@yaks/tracker/file'
import { compose } from './host.ts'
import { read } from './config.ts'

export let trackerConfig = (dir: string) => ({
  db: `${dir}/tracker.db`,
  tracker: { spool: `${dir}/spool` },
  plugins: [
    '@yaks/kernel',
    '@yaks/doc',
    '@yaks/tools',
    '@yaks/api',
    '@yaks/mail',
    '@yaks/wake',
    '@yaks/process',
    '@yaks/effects',
    '@yaks/tracker',
  ],
})

test('a composed tracker drains a separate spool, preserving error attribution', async () => {
  let dir = await Deno.makeTempDir()
  let config = trackerConfig(dir)
  let host = await compose(config, ['graph', '@yaks/tracker'])
  try {
    let report = reporter(
      config,
      { by: 'actor', via: 'session' },
      'abc',
      () => Promise.resolve(),
    )
    await report(new Error('failure'), {
      during: { entity: 'call-in-another-store', process: 'source-process' },
    })
    await host.duties(AbortSignal.abort())
    let rows = await host.graph.read('.error ?created ?during *')
    equal(rows.length, 1)
    let row = rows[0]
    if (!row.created || typeof row.created != 'object') throw Error('no stamp')
    equal('by' in row.created && row.created.by, 'actor')
    equal('via' in row.created && row.created.via, 'session')
    if (!row.during || typeof row.during != 'object') throw Error('no context')
    equal('entity' in row.during && row.during.entity, 'call-in-another-store')
    let again = await Array.fromAsync(files(config.tracker.spool).source())
    equal(again, [])
  } finally {
    await host.close()
    await Deno.remove(dir, { recursive: true })
  }
})

test('a reporter leaves the caller untouched when its spool cannot open', async () => {
  let dir = await Deno.makeTempDir()
  try {
    await Deno.writeTextFile(`${dir}/file`, '')
    await reporter({ tracker: { spool: `${dir}/file/spool` } })(Error('broken'))
  } finally {
    await Deno.remove(dir, { recursive: true })
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

test('a caught mail failure reaches Sentry with its handler and letter, alongside the durable spool', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let events: import('@yaks/tracker/sentry').SentryEvent[] = []
    let report = reporter(
      { tracker: { spool: `${dir}/spool` } },
      undefined,
      'sha',
      (event) => {
        events.push(event)
        return Promise.resolve()
      },
    )
    await report(new Error('waiting for mail credentials'), {
      tags: { handler: 'mail_post' },
      during: { entity: 'letter', process: 'worker' },
    })
    equal(events.length, 1)
    equal(events[0].tags, {
      handler: 'mail_post',
      entity: 'letter',
      process: 'worker',
    })
    equal(events[0].exception.values[0].value, 'waiting for mail credentials')
    let rows = await Array.fromAsync(files(`${dir}/spool`).source())
    equal(rows.length, 1)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('Sentry failure is isolated and retained without recursively sending it', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let calls = 0
    let report = reporter(
      { tracker: { spool: `${dir}/spool` } },
      undefined,
      undefined,
      () => {
        calls++
        return Promise.reject(new Error('ingest down'))
      },
    )
    await report(new Error('mail down'))
    equal(calls, 1)
    let records = await Array.fromAsync(files(`${dir}/spool`).source())
    equal(records.length, 2)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

test('caught mail failures use the shared real Sentry request builder', async () => {
  let { sentryReporter } = await import('@yaks/tracker/sentry')
  let calls = 0
  let send = sentryReporter({
    token: () => Promise.resolve(undefined),
    dsn: () => Promise.resolve('https://ingest-key@sentry.test/42'),
    fetch: (input, init) =>
      new Request(input, init).json().then((event) => {
        calls++
        equal(String(input), 'https://sentry.test/api/42/store/')
        equal(
          new Headers(init?.headers).get('x-sentry-auth'),
          'Sentry sentry_version=7, sentry_key=ingest-key',
        )
        equal(event.tags.handler, 'mail_post')
        equal(event.tags.entity, 'letter')
        equal(event.exception.values[0].value, 'waiting for credentials')
        return Response.json({ id: event.event_id })
      }),
  })
  await reporter({}, undefined, undefined, send)(
    new Error('waiting for credentials'),
    {
      tags: { handler: 'mail_post' },
      during: { entity: 'letter' },
    },
  )
  equal(calls, 1)
})
