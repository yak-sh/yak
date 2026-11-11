import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { signsUp } from './app-texts.ts'

test('a text signs up when its sender is new or asks to join, and has not said STOP', () => {
  let cases: [string, boolean, boolean, boolean][] = [
    ['Are the kids classes on?', false, false, true],
    ['Are the kids classes on?', true, false, false],
    ['Join', true, false, true],
    ['  JOIN prayer list', true, false, true],
    ['joined us last week', true, false, false],
    ['JOIN', false, true, false],
    ['hello', false, true, false],
  ]
  for (let [text, known, stopped, want] of cases) {
    assertEquals(signsUp(text, known, stopped), want, text)
  }
})
