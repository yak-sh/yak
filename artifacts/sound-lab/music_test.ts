import { equal, ok, test } from '@yaks/testing'
import {
  advance,
  audible,
  duration,
  sequence,
  song,
  stepDuration,
} from './music.js'

let close = (left: number, right: number) => ok(Math.abs(left - right) < 1e-9)

test('sound lab swing preserves bar length and delays offbeats', () => {
  let value = song()
  value.swing = 0.7
  close(stepDuration(value, 0) + stepDuration(value, 1), 60 / value.bpm / 2)
  ok(stepDuration(value, 0) > stepDuration(value, 1))
  close(duration(value), 60 / value.bpm * 8)
})

test('sound lab banks have independent editable steps', () => {
  let first = song(), second = song()
  first.patterns[0].steps[0][0]!.velocity = 0.1
  equal(second.patterns[0].steps[0][0]!.velocity, 0.8)
  equal(first.patterns[1].steps[0][0]!.velocity, 0.8)
})

test('sound lab playback and export agree on mixed length bank chains', () => {
  let value = song()
  value.mode = 'chain'
  value.chain = [2, 0, 1]
  value.patterns[2].length = 16
  let events = sequence(value)
  equal(events.length, 80)
  let cursor = events[0]
  for (let event of events) {
    equal(cursor, event)
    cursor = advance(value, cursor)
  }
  equal(cursor.pattern, 2)
  equal(cursor.step, 0)
  equal(cursor.chain, 0)
  close(cursor.time, duration(value))
})

test('sound lab solo isolates tracks and mute still silences a solo track', () => {
  let value = song()
  value.mix[6].solo = true
  equal(value.mix.map((_, i) => audible(value.mix, i)), [
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
  ])
  value.mix[6].mute = true
  equal(audible(value.mix, 6), false)
})
