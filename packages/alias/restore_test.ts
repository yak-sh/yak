import { equal, test } from '@yaks/testing'
import { restoreTrash } from '@yaks/graph/trash'
import { cookbookGraph, store } from './testing.ts'

let fixture = () => {
  let storage = store(), graph = cookbookGraph(storage)
  let named = async (name: string, title: string) => {
    let rows = await graph.apply([{
      entity: { eid: '$recipe' },
      alias: { name },
      doc: { title },
    }])
    return rows.find((b) => b.$alias == '$recipe')!.entity.eid
  }
  let address = async (name: string) => (await graph.address([name])).get(name)
  return { storage, graph, named, address }
}

test('a trashed alias is free and returns unchanged while nobody takes it', async () => {
  let { storage, graph, named, address } = fixture()
  let original = await named('notes', 'Original')
  await graph.apply([{ entity: { eid: original }, $delete: true }])
  equal(await address('notes'), undefined)
  let [entry] = await storage.trash!([original])
  let notices: string[] = []
  await restoreTrash(graph, entry, { notice: (text) => notices.push(text) })
  equal(await address('notes'), original)
  equal(notices, [])
})

test('restoring aliases leaves reused names with their new owners and reports a free name', async () => {
  let { storage, graph, named, address } = fixture()
  let first = await named('notes', 'Original')
  let second = await named('notes-2', 'Another original')
  await graph.apply([first, second].map((eid) => ({
    entity: { eid },
    $delete: true,
  })))
  let replacement = await named('notes', 'Replacement')
  let [entry] = await storage.trash!([first, second])
  let notices: string[] = []
  await restoreTrash(graph, entry, { notice: (text) => notices.push(text) })
  equal(await address('notes'), replacement)
  equal(await address('notes-2'), second)
  equal(await address('notes-3'), first)
  equal((await graph.get([replacement]))[0].doc, { title: 'Replacement' })
  equal((await graph.get([first]))[0].doc, { title: 'Original' })
  equal(notices, ['Alias "notes" was taken; restored as "notes-3".'])
  // Repeating the recovery keeps the allocated name and both owners.
  await restoreTrash(graph, entry)
  equal(await address('notes'), replacement)
  equal(await address('notes-3'), first)
})

test('restoring several aliases of one entity keeps each restored name distinct', async () => {
  let { storage, graph, named, address } = fixture()
  let original = await named('notes', 'Original')
  await graph.apply([{ entity: { eid: original }, alias: { name: 'notes-2' } }])
  await graph.apply([{ entity: { eid: original }, $delete: true }])
  let replacement = await named('notes', 'Replacement')
  let [entry] = await storage.trash!([original])
  await restoreTrash(graph, entry)
  equal(await address('notes'), replacement)
  equal(await address('notes-2'), original)
  equal(await address('notes-3'), original)
})
