// Cold component counts over workerd's billed SQL cursors.
import { driver, type DurableStorage } from '@yaks/durable-object'
import { archetypeDoc } from '@yaks/archetype/sets'
import { col, eq, insert, select, table, val } from '@yaks/sql'
import type { Visibility } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'

export let countCost = (durable: DurableStorage) => {
  let owners = 32
  let counting = false, read = 0, written = 0
  let db = driver(durable, (s) => {
    if (!counting) return
    read += s.rowsRead
    written += s.rowsWritten
  })
  let tags = Array.from({ length: 9 }, (_, i) => `tag${i}`)
  let targets = ['t', '_t', 'empty']
  let vocab = loadVocab([archetypeDoc, {
    $defs: {
      ...Object.fromEntries(
        ['entity', 'tombstone', 'references', 'recalled', ...targets, ...tags]
          .map((name) => [name, {
            component: true,
            type: 'object',
          }]),
      ),
      private: {
        component: true,
        properties: { by: { type: 'string', ref: 'entity' } },
      },
      edge: {
        component: true,
        properties: {
          from: { type: 'string', ref: 'entity' },
          to: { type: 'string', ref: 'entity' },
        },
      },
      comment: {
        component: true,
        properties: { target: { type: 'string', ref: 'entity' } },
      },
    },
  }])
  let store = storage(db, vocab)
  store.install()
  store.tx((tx) =>
    tx.patch([
      { entity: { eid: 'reader' } },
      { entity: { eid: 'other' } },
      { entity: { eid: 'out' }, edge: { from: 'reader', to: 'other' } },
      { entity: { eid: 'in' }, edge: { from: 'other', to: 'reader' } },
      { entity: { eid: 'loop' }, edge: { from: 'reader', to: 'reader' } },
      { entity: { eid: 'note' }, comment: { target: 'reader' } },
      {
        entity: { eid: 'mention' },
        edge: { from: 'reader', to: 'other' },
        references: {},
      },
      {
        entity: { eid: 'memory' },
        comment: { target: 'reader' },
        recalled: {},
      },
      {
        entity: { eid: 'hidden' },
        edge: { from: 'reader', to: 'other' },
        private: { by: 'other' },
      },
      { entity: { eid: 'grave' }, edge: { from: 'reader', to: 'other' } },
      ...targets.filter((component) => component != 'empty').flatMap((
        component,
      ) =>
        Array.from({ length: owners }, (_, i) => ({
          entity: { eid: `${component}-${i}` },
          [component]: {},
          ...i == 1 ? { private: { by: 'other' } } : {},
          ...i == 3 ? { private: { by: 'reader' } } : {},
        }))
      ),
      ...Array.from({ length: 512 }, (_, i) => ({
        entity: { eid: `other-${i}` },
        ...Object.fromEntries(
          tags.filter((_, bit) => i & (1 << bit)).map((tag) => [tag, {}]),
        ),
      })),
    ])
  )
  // A retained component on a grave must never inflate the count.
  for (
    let eid of [
      ...targets.filter((c) => c != 'empty').map((c) => `${c}-0`),
      'grave',
    ]
  ) {
    let [dead] = db.query(select({
      cols: [col('id')],
      from: table('entity'),
      where: eq(col('eid'), val(eid)),
    }))
    db.query(insert('tombstone', { entity: Number(dead.id) }))
  }
  let counts = Object.fromEntries(targets.flatMap((component) => {
    let entity = '!private|.private.by=reader'
    let components = { [component]: `.entity.eid!=${component}-2` }
    let scopes: [string, Visibility | undefined, number][] = [
      ['plain', undefined, owners - 1],
      ['entity', { entity }, owners - 2],
      ['aspect', { components }, owners - 2],
      ['both', { entity, components }, owners - 3],
      ['denied', { entity: '.entity.eid=reader' }, 0],
    ]
    return scopes.map(([scope, visibility, expected]) => {
      read = written = 0
      counting = true
      try {
        let rows = storage({ ...db }, vocab, { schemaReady: () => true }).rows(
          `.${component} .count`,
          { visibility },
        )
        return [`${component}/${scope}`, {
          rows,
          read,
          written,
          owners: component == 'empty' ? 0 : owners,
          expected: component == 'empty' ? 0 : expected,
        }]
      } finally {
        counting = false
      }
    })
  }))
  let cases: [string, Visibility | undefined, string[]][] = [
    ['plain', undefined, ['hidden', 'in', 'loop', 'note', 'out']],
    ['entity', { entity: '!private|.private.by=reader' }, [
      'in',
      'loop',
      'note',
      'out',
    ]],
    ['aspect', { components: { edge: '.entity.eid!=in' } }, [
      'hidden',
      'loop',
      'note',
      'out',
    ]],
    ['both', {
      entity: '!private|.private.by=reader',
      components: { edge: '.entity.eid!=in' },
    }, ['loop', 'note', 'out']],
    ['empty', undefined, []],
  ]
  let nearby = Object.fromEntries(cases.map(([name, visibility, expected]) => {
    let eid = name == 'empty' ? 'missing' : 'reader'
    read = written = 0
    counting = true
    try {
      let rows = storage({ ...db }, vocab, { schemaReady: () => true }).rows(
        `(.edge.from=${eid}|.edge.to=${eid}|.comment.target=${eid})` +
          '&!references&!recalled&.limit=100',
        { visibility },
      ).map((row) => row.eid).sort()
      return [name, { rows, expected, read, written }]
    } finally {
      counting = false
    }
  }))
  return { owners, counts, nearby }
}
