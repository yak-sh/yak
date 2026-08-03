// The window: where a screenful sits over the content, given a cursor.
import { assertEquals } from '@std/assert'
import { win } from './paint.ts'

// top, cursor, window height, content height -> where the window sits
let cases: [number[], number][] = [
  [[0, 0, 10, 100], 0], // a cursor on screen never moves the window
  [[0, 9, 10, 100], 0],
  [[0, 10, 10, 100], 1], // one past the bottom scrolls by one
  [[0, 40, 10, 100], 31],
  [[20, 10, 10, 100], 10], // a cursor above the window pulls it up to itself
  [[91, 99, 10, 100], 90], // the last line is reachable, and is the end
  [[91, 200, 10, 100], 90], // and nothing scrolls past the end
  [[0, 3, 10, 5], 0], // content shorter than the window: no scroll at all
  [[7, 3, 10, 5], 0],
  [[7, -1, 10, 100], 0], // no cursor (the board) pins it to the top
  [[0, 0, 10, 0], 0], // empty content
]

Deno.test('the window follows the cursor and stops at both ends', () => {
  for (let [[top, at, h, n], want] of cases) {
    assertEquals(win(top, at, h, n), want, `win(${top}, ${at}, ${h}, ${n})`)
  }
})
