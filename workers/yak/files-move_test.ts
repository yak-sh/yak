import { equal, test } from '@yaks/testing'
import { mint } from '@yaks/graph'
import { attachmentRows } from '@yaks/blob/attachment'
import { inputOf } from '@yaks/session/intake'
import { operatorMemory } from './operator-testing.ts'
import { attachedOf, type File, FILES, filesOf } from './operator-files.ts'
import { BATCH, filesBackfill } from './files-move.ts'
import { ATTACHMENTS } from './attachment-move.ts'
import { OUTPUTS } from './operator-store.ts'

// A conversation kept while its lines named their own files: words from a
// request with a document the model read as its text, kept on the request,
// and one more such line than a batch, attached beside its request as the
// attachment pass left them, and a step's result that named the image its
// call made.
let store = operatorMemory()
let space = mint(), person = mint(), session = mint()
let file = (i: number, mime = 'application/pdf'): File => ({
  name: `file-${i}`,
  mime,
  key: `${space}/.operator/${i.toString(16).padStart(64, 'b')}`,
  size: i + 1,
})
let asked = Array.from({ length: BATCH + 1 }, (_, i) => {
  let request = mint()
  return [
    {
      entity: { eid: request },
      operator_request: { space, person, channel: 'email', files: [file(i)] },
      content: {
        body: JSON.stringify([{
          name: file(i).name,
          attachment: file(i).key.split('/').at(-1),
          text: `words of ${i}`,
        }]),
      },
    },
    {
      entity: { eid: inputOf(request) },
      entry: { session },
      content: { body: `By email: see ${i}` },
      operator_files: { request, files: [file(i)] },
    },
    ...attachmentRows(request, [attachedOf(file(i))]),
  ]
})
let call = mint(), result = mint()
await store.g.apply([
  {
    entity: { eid: session },
    session: {},
    operator_session: { space, person },
  },
  ...asked.flat(),
  { entity: { eid: call }, entry: { session }, call: { name: 'image_new' } },
  {
    entity: { eid: result },
    entry: { session },
    result: { call },
    operator_files: { files: [file(99, 'image/png')] },
  },
  ...attachmentRows(call, [attachedOf(file(99, 'image/png'))]),
], { trusted: true })

let marks = new Map<string, string>()
let marked = {
  ...store,
  marks: {
    get: (key: string) => marks.get(key),
    set: (key: string, value: string) => void marks.set(key, value),
  },
}
let lines = () => store.g.read(`.entry.session=${session}&*`)
let drawn = async () =>
  [...(await filesOf(marked, await lines())).values()].map((s) =>
    s.files.map((f) => [f.name, f.text ?? null])
  ).sort()
let before = await drawn()
let waits = await filesBackfill(marked)
marks.set(ATTACHMENTS, 'done')
marks.set(OUTPUTS, 'done')
let batches = 0
while (await filesBackfill(marked)) batches++
let after = await drawn()
let again = await filesBackfill(marked)
let first = (await store.g.get([inputOf(asked[0][0].entity.eid)]))[0]

test("a line's files are found among the attachments once its store's pass is done, the words read from them with them", async () => {
  equal(waits, true)
  equal(batches, 1)
  equal(again, false)
  equal(marks.get(FILES), 'done')
  equal((await store.g.read('.operator_files')).length, 0)
  equal(first.operator_files, undefined)
  equal(
    (first.intake as { item?: string }).item,
    asked[0][0].entity.eid,
  )
  equal(
    before.map((files) => files.map(([name]) => name)),
    after.map((files) => files.map(([name]) => name)),
  )
  equal(after.length, BATCH + 2)
  equal(after.filter((f) => f[0][1]?.startsWith('words of')).length, BATCH + 1)
})
