import { equal, ok, test } from '@yaks/testing'
import { clock, engine, experiment, store } from './model.js'

let types = (model) => model.actions.map(({ action }) => action.type)
let complete = (demo) => {
  demo.start()
  for (let i = 0; i < 5; i++) demo.step()
}

test('an engine commits the original action before emitting a separate result', () => {
  let model = engine(clock())
  let action = { type: 'UPLOAD_QUEUED', id: 'one', file: 'one.pdf', readyAt: 0 }
  model.dispatch(action)
  ok(model.actions[0].action === action)
  equal(model.actions[0].state.uploads[0].status, 'queued')
  equal(types(model), ['UPLOAD_QUEUED', 'UPLOAD_STARTED'])
  equal(model.getState().uploads[0].status, 'uploading')
})

test('an observer return cannot replace the dispatched action', () => {
  let model = store()
  model.subscribe(() => ({ type: 'UPLOAD_COMPLETED', id: 'one' }))
  model.dispatch({
    type: 'UPLOAD_QUEUED',
    id: 'one',
    file: 'one.pdf',
    readyAt: 2,
  })
  equal(types(model), ['UPLOAD_QUEUED'])
  equal(model.getState().uploads[0].status, 'queued')
})

test('intercepting middleware holds and consumes intent but both transfers complete', () => {
  let demo = experiment()
  demo.start()
  equal(demo.left.getState().uploads, [])
  equal(demo.left.pending.length, 1)
  equal(types(demo.right), ['UPLOAD_QUEUED'])
  complete(demo)
  equal(types(demo.left), [
    'UPLOAD_STARTED',
    'UPLOAD_PROGRESS',
    'UPLOAD_PROGRESS',
    'UPLOAD_COMPLETED',
  ])
  equal(types(demo.right), ['UPLOAD_QUEUED', ...types(demo.left)])
  equal(demo.left.getState().uploads[0].progress, 100)
  equal(demo.right.getState().uploads[0].progress, 100)
})

test('state-watching middleware can preserve the same actions and state as engines', () => {
  let demo = experiment('observe')
  demo.start()
  ok(demo.left.actions[0].action === demo.right.actions[0].action)
  for (let i = 0; i <= 5; i++) {
    equal(demo.left.getState(), demo.right.getState())
    equal(types(demo.left), types(demo.right))
    demo.step()
  }
  equal(demo.left.getState().uploads[0].status, 'complete')
})
