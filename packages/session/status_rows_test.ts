// The status SQL run by workerd itself: cursor rowsRead counts visited rows,
// not returned bundles. A private, disposable Durable Object holds only this
// test's synthetic transcript; no platform account or standing store is used.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { createRequire } from 'node:module'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { as, insert, render, select, type Stmt, val } from '@yaks/sql'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { effectDoc } from '@yaks/effects'
import { archetypeDoc } from '@yaks/archetype/vocab'

test(
  'workerd reads a finished session in bounded rows regardless of history',
  async () => {
    // The repository's installed workerd, not a runtime fetched by this test.
    let require = createRequire(
      new URL('../../workers/yak/package.json', import.meta.url),
    )
    let { Miniflare } = require('miniflare')
    let vocab = loadVocab([
      sessionDoc,
      toolsDoc,
      modelDoc,
      kernelDoc,
      effectDoc,
      archetypeDoc,
    ], [kernelKeywords])
    let d = mem()
    let s = storage(d, vocab, { derived: sessionDerived(vocab) })
    let ddl = s.ddl().map(render)
    let statement = render(
      select({
        cols: [
          as(sessionDerived(vocab)['session.status'].expr(val(1)), 'status'),
        ],
      }),
    )
    let writes = [
      insert(
        'entity',
        { id: 1, eid: 'session' },
        { id: 10001, eid: 'input-shape' },
        { id: 10002, eid: 'ask-shape' },
        { id: 10003, eid: 'output-shape' },
      ),
      insert('session', { entity: 1, id: 'long' }),
      insert(
        'archetype',
        { entity: 10001, tables: JSON.stringify(['content', 'entry']) },
        { entity: 10002, tables: JSON.stringify(['ask', 'attempt', 'entry']) },
        {
          entity: 10003,
          tables: JSON.stringify(['content', 'entry', 'output']),
        },
      ),
    ].map(render)
    let entry = (i: number): Stmt[] => [
      insert('entity', {
        id: i + 1,
        eid: `e${i}`,
        archetype: i % 3 == 1 ? 10001 : i % 3 == 2 ? 10002 : 10003,
      }),
      insert('entry', { entity: i + 1, session: 1, seq: i }),
      ...i % 3 == 1
        ? [insert('content', { entity: i + 1, body: 'hi' })]
        : i % 3 == 2
        ? [
          insert('ask', { entity: i + 1, through: i }),
          insert('attempt', { entity: i + 1 }),
        ]
        : [
          insert('output', { entity: i + 1, source: i }),
          insert('content', { entity: i + 1, body: 'done' }),
        ],
    ]
    // A migrated active transcript can retain thousands of NULL-sequence
    // rows from its old release, yet have no ask in its new positive range.
    let legacyWrites = [
      insert('entity', { id: 50000, eid: 'legacy-session' }),
      insert('session', { entity: 50000, id: 'legacy' }),
      ...Array.from({ length: 3000 }, (_, i) => [
        insert('entity', {
          id: 50001 + i,
          eid: `legacy-${i}`,
          archetype: 10003,
        }),
        insert('entry', { entity: 50001 + i, session: 50000, seq: null }),
        insert('output', { entity: 50001 + i, source: null }),
        insert('content', { entity: 50001 + i, body: 'old' }),
      ]).flat(),
      insert('entity', {
        id: 60000,
        eid: 'legacy-new-input',
        archetype: 10001,
      }),
      insert('entry', { entity: 60000, session: 50000, seq: 1 }),
      insert('content', { entity: 60000, body: 'new' }),
      insert('using', { entity: 60000 }),
    ].map(render)
    let legacyStatement = render(
      select({
        cols: [
          as(
            sessionDerived(vocab)['session.status'].expr(val(50000)),
            'status',
          ),
        ],
      }),
    )
    let transcript = Array.from(
      { length: 3000 },
      (_, i) => entry(i + 1).map(render),
    )
    // The worker contains no handwritten SQL: schema, writes, and the status
    // statement are rendered ASTs, exactly what the production adapter sends.
    let script = `const ddl=${JSON.stringify(ddl)}, writes=${
      JSON.stringify(writes)
    }, transcript=${JSON.stringify(transcript)}, statement=${
      JSON.stringify(statement)
    };
    const legacyWrites=${JSON.stringify(legacyWrites)}, legacyStatement=${
      JSON.stringify(legacyStatement)
    };
    export class Probe {
      constructor(ctx) {this.sql=ctx.storage.sql}
      fetch() {
        const run=s=>this.sql.exec(s.sql,...s.params);
        ddl.forEach(run); writes.forEach(run);
        const samples=[];
        legacyWrites.forEach(run);
        const legacyCursor=run(legacyStatement), legacyRows=legacyCursor.toArray();
        samples.push({length:3000, rows:legacyRows, read:legacyCursor.rowsRead, legacy:true});
        for(let i=0;i<transcript.length;i++) {
          transcript[i].forEach(run);
          if(i===29 || i===2999) {
            const cursor=run(statement); const rows=cursor.toArray();
            samples.push({length:i+1, rows, read:cursor.rowsRead});
          }
        }
        return Response.json(samples);
      }
    }
    export default {fetch(req,env) {return env.P.get(env.P.idFromName('one')).fetch(req)}}`
    let runtime = new Miniflare({
      modules: true,
      script,
      compatibilityDate: '2025-05-08',
      durableObjects: { P: { className: 'Probe', useSQLite: true } },
    })
    try {
      let response = await runtime.dispatchFetch('http://probe/')
      assertEquals(response.status, 200, await response.clone().text())
      let samples = await response.json() as {
        length: number
        rows: { status: string }[]
        read: number
        legacy?: boolean
      }[]
      console.log('SESSION_STATUS_ROWS', samples)
      for (let sample of samples) {
        assertEquals(sample.rows, [{
          status: sample.legacy ? 'running' : 'settled',
        }])
        assert(
          sample.read <= (sample.legacy ? 100 : 25),
          `${sample.length} entries read ${sample.read} rows`,
        )
      }
      assertEquals(samples[1].read, samples[2].read)
    } finally {
      await runtime.dispose()
    }
  },
  { tags: ['session-rows'] },
)
