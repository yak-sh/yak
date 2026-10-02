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
    let report = reporter(config, { by: 'actor', via: 'session' }, 'abc')
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
