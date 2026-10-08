// File opening and local reads stay read-only even with a writer holding the
// WAL write lock. Installation is explicit and never part of these commands.
import { equal, ok, test } from '@yaks/testing'
import { compose, facet } from './host.ts'
import { read } from './config.ts'
import { close } from './held.ts'
import { cli as line } from './run.ts'
import { TOOLS, YAK } from './yak.ts'
import { open } from '@yaks/sqlite/db'
import { col, select, table } from '@yaks/sql'

test('local read commands leave graph bytes unchanged under a concurrent writer', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'T-65799-reader-' })
  let file = `${dir}/yak.json`, db = `${dir}/graph.db`
  await Deno.writeTextFile(
    file,
    JSON.stringify({
      db,
      duties: false,
      plugins: [
        '@yaks/kernel',
        '@yaks/doc',
        '@yaks/archetype',
        '@yaks/id',
        '@yaks/journal',
        '@yaks/tools',
        '@yaks/effects',
        '@yaks/process',
        '@yaks/embedding',
      ],
    }),
  )
  let config = read(file)
  let host = await compose(config, ['graph'], facet, {
    install: true,
    process: false,
  })
  await host.graph.apply([{
    entity: { eid: '12345678-1234-1234-1234-123456789abc' },
    doc: { title: 'kept' },
  }])
  await host.close()
  let writer = open(db)
  try {
    // The installer must not be called implicitly even when an index is gone.
    writer.query({
      t: 'drop',
      kind: 'index',
      name: 'doc_title',
      ifExists: true,
    })
    let before = await Deno.readFile(db)
    let schema = writer.query(
      select({
        cols: [col('name'), col('sql')],
        from: table('sqlite_schema'),
        order: [col('name')],
      }),
    )
    writer.query({ t: 'begin', mode: 'immediate' })
    // The command line run in this process, as `yak` runs it: the graph it
    // opens is closed when the line is done.
    let cli = async (...args: string[]) => {
      let said: string[] = []
      let code = await line(TOOLS, {
        ...YAK,
        argv: ['--config', file, '--json', ...args],
        env: () => undefined,
        reads: { file: () => '', stdin: () => '' },
        out: (l) => said.push(l),
        note: (l) => said.push(l),
      })
      await close(code)
      equal(code, 0, said.join('\n'))
      return said.join('\n')
    }
    ok(
      (await cli(
        'graph',
        'query',
        '.entity.eid=12345678-1234-1234-1234-123456789abc .count',
      )).includes('"count": 1'),
    )
    ok(
      (await cli('graph', 'show', '12345678-1234-1234-1234-123456789abc'))
        .includes('kept'),
    )
    let reader = await compose(config, ['graph'], facet, { readOnly: true })
    try {
      equal(reader.storage.statements.facilities, undefined)
      equal(
        reader.storage.statements.query(
          select({
            cols: [col('name'), col('sql')],
            from: table('sqlite_schema'),
            order: [col('name')],
          }),
        ),
        schema,
      )
    } finally {
      await reader.close()
    }
    writer.query({ t: 'rollback' })
    writer.close()
    equal(await Deno.readFile(db), before)
  } finally {
    try {
      writer.close()
    } catch { /* already closed */ }
    await Deno.remove(dir, { recursive: true })
  }
})
