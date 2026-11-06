// A parent's channel ending is independent of terminal input and process ids.
import { EventEmitter } from 'node:events'
import { equal, test } from '@yaks/testing'
import { disconnected } from './system.ts'

test('a child stays attached until its parent channel closes', async () => {
  let source = Object.assign(new EventEmitter(), { connected: true })
  let closed = false
  let ended = disconnected(source).then(() => closed = true)
  await Promise.resolve()
  equal(closed, false)
  source.connected = false
  source.emit('disconnect')
  await ended
  equal(closed, true)
  equal(source.listenerCount('disconnect'), 0)
})

test('a child notices a parent channel that closed before it listened', async () => {
  let source = Object.assign(new EventEmitter(), { connected: false })
  await disconnected(source)
  equal(source.listenerCount('disconnect'), 0)
})
