// File opening and local reads stay read-only even with a writer holding the
// WAL write lock. Installation is explicit and never part of these commands.
import { equal, ok, test } from '@yaks/testing'
import { compose, facet } from './host.ts'
import { read } from './config.ts'
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
    let cli = async (...args: string[]) => {
      let result = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          '--config',
          new URL('../../deno.json', import.meta.url).pathname,
          new URL('./yak.ts', import.meta.url).pathname,
          '--config',
          file,
          '--json',
          ...args,
        ],
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      equal(result.code, 0, new TextDecoder().decode(result.stderr))
      return new TextDecoder().decode(result.stdout)
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
      equal(reader.sql.extension, undefined)
      equal(
        reader.sql.query(
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
