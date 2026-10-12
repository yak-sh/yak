// File opening and local reads stay read-only even with a writer holding the
// WAL write lock. Installation is explicit and never part of these commands.
import { equal, ok, test, throws } from '@yaks/testing'
import type { GraphFacet, Load } from '@yaks/host'
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
  let snapshot = await host.graph.get(
    ['12345678-1234-1234-1234-123456789abc'],
    ['doc'],
  )
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
    let prepared: string[] = []
    let loading: Load = async (plugin, name) => {
      let loaded = await facet(plugin, name)
      if (plugin != '@yaks/kernel' || name != 'graph') return loaded
      let original = loaded as GraphFacet | null
      let graph: GraphFacet = {
        ...original,
        plugins: (host, options) => [
          ...original?.plugins?.(host, options) ?? [],
          {
            name: 'external preparation',
            hooks: Object.fromEntries(
              ['normalize', 'prepare'].map((phase) => [
                phase,
                (bundles: import('@yaks/graph').Bundle[]) => {
                  prepared.push(phase)
                  return bundles
                },
              ]),
            ),
          },
        ],
      }
      return graph as NonNullable<typeof loaded>
    }
    let reader = await compose(config, ['graph'], loading, { readOnly: true })
    try {
      let patch = [{
        entity: { eid: '12345678-1234-1234-1234-123456789abc' },
        doc: { title: 'attempted' },
      }]
      await throws(() => reader.graph.apply(patch))
      await throws(() => reader.graph.apply(patch, { check: true }))
      await throws(() => reader.graph.admit(patch))
      await throws(() => reader.graph.install())
      await throws(() => reader.storage.install())
      await throws(() =>
        reader.storage.tx(() => prepared.push('storage callback'))
      )
      await throws(() =>
        reader.storage.tx((tx) => {
          prepared.push('prune callback')
          tx.prune?.(['orphan'])
        })
      )
      equal(prepared, [])
      equal(
        reader.storage.statements.atomic(() =>
          reader.graph.get(['12345678-1234-1234-1234-123456789abc'], ['doc'])
        ),
        snapshot,
      )
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
