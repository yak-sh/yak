import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { progress, reading } from './story.js'

test('a conversation line follows the reading position in both directions', () => {
  let at = (through: number) =>
    progress(
      1,
      1,
      2,
      reading([
        { top: -100, bottom: 0 },
        { top: 0, bottom: 100 },
        { top: 100, bottom: 200 },
      ], through),
    )
  assertEquals([20, 42, 60, 42, 20].map((line) => Math.round(at(line) * 100)), [
    0,
    50,
    100,
    50,
    0,
  ])
})

test('the opening and completed exchanges stay while later lines wait', () => {
  let at = { step: 2, through: 0 }
  assertEquals([0, 1, 2, 3].map((turn) => progress(turn, 1, 2, at)), [
    1,
    1,
    0,
    0,
  ])
})
