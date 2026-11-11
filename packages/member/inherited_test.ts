import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'
import { equal, test } from '@yaks/testing'
import { personal } from './personal.ts'

let ref = { type: 'string', ref: 'entity', death: 'cascade' }
let vocab = loadVocab({
  $defs: {
    person: { component: true, properties: {} },
    private: { component: true, properties: { by: ref } },
    page: {
      component: true,
      properties: { source: ref, text: { type: 'string' } },
    },
    link: { component: true, properties: { target: ref } },
  },
})
let sql = storage(open(':memory:'), vocab)
sql.install()
for (let [name, store] of Object.entries({ RAM: ram(vocab), SQL: sql })) {
  let g = graph({ vocab, storage: store })
  await g.apply([
    { entity: { eid: 'alice' }, person: {} },
    { entity: { eid: 'bob' }, person: {} },
    { entity: { eid: 'document' }, private: { by: 'alice' } },
    {
      entity: { eid: 'page' },
      page: { source: 'document', text: 'private text' },
    },
    { entity: { eid: 'link' }, link: { target: 'page' } },
  ])
  g.use(personal(vocab, { private: 'by' }, { page: 'source' }))
  let ids = (rows: Bundle[]) => rows.map((b) => b.entity.eid)
  test(`${name} derived rows inherit source ownership in reads, aggregates and relays`, async () => {
    for (let person of [null, 'bob']) {
      equal(await g.read('.page *', { person }), [])
      equal(await g.get(['page'], undefined, { person }), [])
      equal(await g.rows('.page .count', { person }), [{ value: '', n: 0 }])
      equal(
        await g.answer([{
          entity: { eid: 'page' },
          page: { text: 'patch without source' },
        }], { person }),
        [],
      )
      equal(await g.rows('.link.target.page.text~=private', { person }), [])
      let [link] = await g.answer([{
        entity: { eid: 'link' },
        link: { target: 'page' },
      }], { person })
      equal(link.link, { target: null })
    }
    equal(ids(await g.read('.page *', { person: 'alice' })), ['page'])
    equal(
      ids(
        await g.get(['page'], undefined, {
          person: 'bob',
          administrative: true,
        }),
      ),
      ['page'],
    )
    await g.apply([{ entity: { eid: 'document' }, private: { by: 'bob' } }], {
      trusted: true,
    })
    equal(await g.read('.page *', { person: 'alice' }), [])
    equal(ids(await g.read('.page *', { person: 'bob' })), ['page'])
    equal(
      await g.answer([{
        entity: { eid: 'page' },
        page: { text: 'late patch' },
      }], { person: 'alice' }),
      [],
    )
    await g.apply([{ entity: { eid: 'document' }, private: null }], {
      trusted: true,
    })
    equal(ids(await g.read('.page *', { person: null })), ['page'])
    await g.apply([{ entity: { eid: 'document' }, $delete: true }], {
      trusted: true,
    })
    equal(await g.read('.page *', { person: 'bob' }), [])
  })
  // A rehearsal's answer: its source was created by the rolled-back batch.
  test(`${name} a row whose source the answer carries inherits it`, async () => {
    let answered = async (person: string) =>
      ids(
        await g.answer([
          { entity: { eid: 'draft' }, private: { by: 'alice' } },
          { entity: { eid: 'note' }, page: { source: 'draft', text: 'new' } },
        ], { person }),
      )
    equal(await answered('alice'), ['draft', 'note'])
    equal(await answered('bob'), [])
  })
}
