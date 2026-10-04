// The platform sweeps must seek platform component sets, not scan world rows.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { archetypes } from '@yaks/archetype'
import { type Comp, graph } from '@yaks/graph'
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'
import { mem } from '../../packages/sqlite/testing.ts'
import { compSql, storage } from '@yaks/sqlite'
import { appDerived, appVocab } from './vocab.ts'
import { catalog } from '../../packages/sqlite/catalog.ts'

test('platform boot sweeps and single session reads never scan entity', async () => {
  let d = mem(), v = appVocab()
  let derived = appDerived(v)
  let s = storage(d, v, { derived })
  s.install()
  let g = graph({ storage: s, vocab: v, plugins: [archetypes()] })
  g.apply([{
    entity: { eid: 'village' },
    session: {},
    created: { via: 'browser' },
  }])
  g.apply([{ entity: { eid: 'village' }, session: { actor: 'village' } }])
  for (
    let q of [
      '.session.status=pending,running,queued (.entries.using|.entries.ask)|.dispatch.status=active,queued,waiting',
      '(.created.via !created.by|.updated.via !updated.by)',
    ]
  ) {
    let stmt = compile(parse(q), v, { derived, archetypes: catalog(d) })
    let plan = d.query({ t: 'explain query plan', of: stmt }).map((r) =>
      String(r.detail)
    ).join('\n')
    assert(!plan.includes('SCAN entity'), plan)
  }
  let stmt = compSql(v, 'session', 'village', derived)
  let plan = d.query({ t: 'explain query plan', of: stmt }).map((r) =>
    String(r.detail)
  ).join('\n')
  assert(!plan.includes('SCAN session'), plan)
  assertEquals(
    ((await g.get(['village'], ['session']))[0].session as Comp).status,
    'empty',
  )
})

test('guest attribution seeks nullable reference keys without scanning stamp indexes', () => {
  let d = mem(), v = appVocab(), derived = appDerived(v)
  let s = storage(d, v, { derived })
  s.install()
  let g = graph({ storage: s, vocab: v, plugins: [archetypes()] })
  g.apply([{
    entity: { eid: 'guest-write' },
    doc: { title: 'Kept' },
    $actor: { via: 'browser' },
  }])
  // Exercise the catalog fallback a store with unclassified identities uses.
  d.query({
    t: 'update',
    table: 'entity',
    set: { archetype: { t: 'lit', v: null } },
  })
  let q = '(.created.via !created.by|.updated.via !updated.by)'
  let stmt = compile(parse(q), v, { derived, archetypes: catalog(d) })
  let plan = d.query({ t: 'explain query plan', of: stmt }).map((r) =>
    String(r.detail)
  ).join('\n')
  assert(!plan.includes('SCAN entity'), plan)
  assert(!plan.includes('SCAN created'), plan)
  assert(!plan.includes('SCAN updated'), plan)
})
