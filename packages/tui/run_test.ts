import { equal, test } from '@yaks/testing'
import { fatal } from './run.ts'

let heard = (types: string[], prevented = false) => {
  let target = new EventTarget()
  let released = 0
  let stop = fatal(target, () => released++)
  for (let type of types) {
    let event = new Event(type, { cancelable: true })
    if (prevented) event.preventDefault()
    target.dispatchEvent(event)
  }
  stop()
  target.dispatchEvent(new Event('unload'))
  return released
}

test('an ending the run loop never reaches releases the terminal', () => {
  equal(heard(['error']), 1)
  equal(heard(['unhandledrejection']), 1)
  equal(heard(['unload']), 1)
  equal(heard(['message']), 0)
  equal(heard(['error', 'unhandledrejection'], true), 0)
})
