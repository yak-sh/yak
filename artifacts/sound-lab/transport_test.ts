import { equal, test } from '@yaks/testing'
import { transport } from './transport.js'

let pending = () => {
  let resolve!: () => void
  let promise = new Promise<void>((done) => resolve = done)
  return { promise, resolve }
}

test('sound lab single toggle cancels pending activation without repainting playback', async () => {
  let activation = pending(),
    playing = false,
    stopped = false,
    states: unknown[] = []
  let audio = {
    get playing() {
      return playing
    },
    start: async () => {
      await activation.promise
      playing = !stopped
    },
    stop: () => {
      stopped = true
      playing = false
    },
  }
  let control = transport(audio, (state: unknown) => states.push(state))
  let first = control.toggle()
  equal(states, ['starting'])
  await control.toggle()
  activation.resolve()
  await first
  equal(states, ['starting', false])
  equal(playing, false)
})

test('sound lab single toggle starts and stops active playback', async () => {
  let playing = false, states: unknown[] = []
  let control = transport({
    get playing() {
      return playing
    },
    start: () => {
      playing = true
      return Promise.resolve()
    },
    stop: () => {
      playing = false
    },
  }, (state: unknown) => states.push(state))
  await control.toggle()
  equal(playing, true)
  await control.toggle()
  equal(playing, false)
  equal(states, ['starting', true, false])
})
