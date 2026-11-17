import { equal, test } from '@yaks/testing'
import { channel } from '@yaks/trace'
import { readActivity, readOperations } from './read_activity.ts'

test('a worker operation is visible through its shared buffer and stays bounded', () => {
  let at = 1000, clock = () => at
  let writer = readActivity(new SharedArrayBuffer(48), clock)
  let reader = readActivity(writer.buffer, clock)
  writer.say('sqlite is stepping')
  at = 3500
  equal(reader.read(), { text: 'sqlite is stepping', ms: 2500 })
  writer.say('x'.repeat(100))
  equal(reader.read(), { text: 'x'.repeat(24), ms: 0 })
  writer.say('idle')
  equal(reader.read()?.text, 'idle')
})

test('a posted reply names its job independently of the current operation', () => {
  let writer = readActivity(), reader = readActivity(writer.buffer)
  equal(reader.completed(1), false)
  writer.done(1)
  writer.say('reading the next job')
  equal(reader.completed(1), true)
  equal(reader.completed(2), false)
  writer.done(2)
  equal(reader.completed(2), true)
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
    equal(
      activity.read()!.text.startsWith('sql select: select * from entity'),
      true,
    )
    sql.end()
    equal(activity.read()!.text.startsWith('query read'), true)
    query.end()
    equal(activity.read()?.text, 'query returned; preparing its reply')
  } finally {
    stop()
  }
  channel(graph).begin({ kind: 'get', name: 'unobserved' })
  equal(activity.read()?.text, 'query returned; preparing its reply')
})
