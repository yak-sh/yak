import { equal, test } from '@yaks/testing'
import { attachmentOf, attachmentRows } from './operator-attachments.ts'
import { operatorMemory } from './operator-testing.ts'
import { receive } from './operator-channels.ts'

let store = operatorMemory()
let sha = 'a'.repeat(64)
let file = {
  name: 'notes.docx',
  mime:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 24,
  key: 'checks/.operator/' + sha,
}
let request = crypto.randomUUID()
await receive(
  store,
  {
    space: crypto.randomUUID(),
    person: crypto.randomUUID(),
    channel: 'chat',
    files: [file],
  },
  'Read this',
  { id: request },
)
let rows = await store.g.read('.attachment&*')
let artifact = (await store.g.get([sha]))[0]

test('intake attachment rows expose their name, message and immutable bytes', () => {
  equal(rows[0].attachment, {
    name: file.name,
    media_type: file.mime,
    artifact: sha,
    message: request,
  })
  equal(artifact.artifact, { address: sha, media_type: file.mime, size: 24 })
})

test('one file sent with two messages keeps both occurrences and shared bytes', () => {
  let first = attachmentRows('first', [file])
  let later = attachmentRows('later', [{ ...file, name: 'renamed.docx' }])
  equal(first[0].entity.eid, later[0].entity.eid)
  equal(first[1].entity.eid == later[1].entity.eid, false)
  equal(first[1].entity.eid, attachmentOf('first', 0))
  equal(later[1].attachment, {
    name: 'renamed.docx',
    media_type: file.mime,
    artifact: sha,
    message: 'later',
  })
})
