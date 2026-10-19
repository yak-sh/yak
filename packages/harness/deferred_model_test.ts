// Provider selection must not open unused transports; once selected, concurrent
// requests and metadata calls share the same provider and retain its recorders.
import { equal, test } from '@yaks/testing'
import type { Model, Request } from '@yaks/model'
import { deferredModel } from './deferred_model.ts'

let request: Request = { model: 'fake', items: [], tools: [] }
let reply = { id: 'reply', model: 'fake', items: [] }
let loaded = 0
let calls = 0
let provider: Model = Object.assign(() => {
  calls++
  return Promise.resolve(reply)
}, {
  list: () => Promise.resolve([{ name: 'fake' }]),
  info: (name: string) => Promise.resolve({ name }),
  recover: (id: string) => Promise.resolve({ ...reply, id }),
})
let mark: Model['mark'] = (r) => ({ fake: { response_id: r.id } })
let deferred = deferredModel(() => {
  loaded++
  return Promise.resolve(provider)
}, { mark, info: true, recover: true })
let before = { loaded, marked: deferred.mark?.(reply) }
let answers = await Promise.all([deferred(request), deferred(request)])
let listed = await deferred.list?.()
let described = await deferred.info?.('fake')
let recovered = await deferred.recover?.('saved')
let plain = deferredModel(() => Promise.resolve(provider), { mark })

test('an unused provider records replies without loading its transport', () => {
  equal(before, { loaded: 0, marked: { fake: { response_id: 'reply' } } })
})
test('concurrent requests and discovery share one deferred provider', () => {
  equal({ loaded, calls }, { loaded: 1, calls: 2 })
  equal(answers, [reply, reply])
  equal(listed, [{ name: 'fake' }])
  equal(described, { name: 'fake' })
  equal(recovered, { ...reply, id: 'saved' })
})
test('deferring a provider does not invent optional preparation or recovery', () => {
  equal(plain.info, undefined)
  equal(plain.recover, undefined)
})
