// A page's actions for a fake browser, each heard by `did` as the line it
// would be in a log: what a test that drives no steps leaves untouched, and
// what one that does reads back in order.
import type { Page } from './capture.ts'

export type Actions = Pick<Page, 'waitForSelector' | 'keyboard' | 'touchscreen'>

export let actions = (did: (line: string) => void = () => {}): Actions => {
  let done = (line: string) => (did(line), Promise.resolve())
  return {
    waitForSelector: async (s) => (await done(`find ${s}`), {
      tap: () => done(`tap ${s}`),
      click: () => done(`click ${s}`),
      focus: () => done(`focus ${s}`),
      type: (text) => done(`type ${text} into ${s}`),
    }),
    keyboard: {
      type: (text) => done(`type ${text}`),
      press: (key) => done(`press ${key}`),
      down: (key) => done(`down ${key}`),
      up: (key) => done(`up ${key}`),
    },
    touchscreen: {
      touchStart: (x, y) => done(`touch ${x},${y}`),
      touchMove: (x, y) => done(`move ${x},${y}`),
      touchEnd: () => done('lift'),
    },
  }
}
