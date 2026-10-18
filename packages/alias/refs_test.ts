// Resolving a direct identity must not evaluate the entity it names. A name
// that exists still yields to a live identity, over either storage boundary.
import { equal, test } from '@yaks/testing'
import type { Bundle, ReadTx } from '@yaks/graph'
import { aliasEid } from './comp.ts'
import { addressed } from './refs.ts'

for (let async of [false, true]) {
  let tx: ReadTx = {
    read: () => {
      throw new Error('name resolution is not a query')
    },
    get: (ids, comps) => {
      if (ids.includes('session') || comps?.join(',') != 'key') {
        throw new Error('direct identity evaluated its transcript')
      }
      return async ? Promise.resolve([]) : []
    },
  }
  test(`a direct reference leaves its computed properties unread (${async ? 'async' : 'sync'})`, async () => {
    equal(await addressed(tx, ['session', 'session']), new Map())
  })

  for (let state of ['live', 'empty', 'deleted', 'missing']) {
    let rows: Bundle[] = [{
      entity: { eid: aliasEid('cake') },
      key: { of: 'recipe', value: 'cake' },
    }]
    if (state != 'missing') {
      rows.push({
        entity: { eid: 'cake' },
        ...state == 'live'
          ? { doc: { title: 'identity' } }
          : state == 'deleted'
          ? { tombstone: {} }
          : {},
      })
    }
    let tx: ReadTx = {
      read: () => {
        throw new Error('name resolution is not a query')
      },
      get: (ids, comps) => {
        let found = rows.filter((b) => ids.includes(b.entity.eid)).map((b) =>
          comps
            ? {
              entity: b.entity,
              ...Object.fromEntries(
                Object.entries(b).filter(([k]) => comps.includes(k)),
              ),
            }
            : b
        )
        return async ? Promise.resolve(found) : found
      },
    }
    test(`an alias respects a ${state} identity (${async ? 'async' : 'sync'})`, async () => {
      equal(
        await addressed(tx, ['cake']),
        new Map(state == 'live' ? [] : [['cake', 'recipe']]),
      )
    })
  }
}

for (let id of ['b08d920e-bc1b-809e-9950-7661c8f20bd1', 'a'.repeat(40)]) {
  test('a former identity remains addressable: ' + id, async () => {
    let tx: ReadTx = {
      read: () => {
        throw Error('not a query')
      },
      get: (ids) =>
        ids.includes(aliasEid(id))
          ? [{
            entity: { eid: aliasEid(id) },
            key: { of: 'canonical', value: id },
          }]
          : [],
    }
    equal(await addressed(tx, [id]), new Map([[id, 'canonical']]))
  })
}
