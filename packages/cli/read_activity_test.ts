import { equal, test } from '@yaks/testing'
import { channel } from '@yaks/trace'
import { readActivity, readOperations } from './read_activity.ts'

test('a worker operation is visible through its shared buffer and stays bounded', () => {
  let writer = readActivity(new SharedArrayBuffer(32))
  let reader = readActivity(writer.buffer)
  writer.say('sqlite is stepping')
  equal(reader.read(), 'sqlite is stepping')
  writer.say('x'.repeat(100))
  equal(reader.read(), 'x'.repeat(24))
  writer.say('idle')
  equal(reader.read(), 'idle')
})

test('a read exposes its open SQL call until that call returns', () => {
  let graph = {}, activity = readActivity()
  let stop = readOperations(graph, activity.say)
  try {
    let c = channel(graph)
    let query = c.begin({ kind: 'query', name: 'read' })!
    let sql = c.begin({
      kind: 'sql',
      name: 'select',
      sql: 'select * from entity where eid = ?',
    })!
    equal(activity.read()!.startsWith('sql select: select * from entity'), true)
    sql.end()
    equal(activity.read()!.startsWith('query read'), true)
    query.end()
    equal(activity.read(), 'query returned; preparing its reply')
  } finally {
    stop()
  }
  channel(graph).begin({ kind: 'get', name: 'unobserved' })
  equal(activity.read(), 'query returned; preparing its reply')
})
