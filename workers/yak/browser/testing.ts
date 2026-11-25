// A page's actions for a fake browser, each heard by `did` as the line it
// would be in a log: what a test that drives no steps leaves untouched, and
// what one that does reads back in order.
import type { Page } from '@yaks/platform/browser-visit'

export type Actions = Pick<
  Page,
  | 'bringToFront'
  | 'waitForSelector'
  | 'keyboard'
  | 'mouse'
  | 'touchscreen'
  | 'browserContext'
  | 'browser'
  | 'mainFrame'
  | 'setRequestInterception'
>

export let actions = (did: (line: string) => void = () => {}): Actions => {
  let done = (line: string) => (did(line), Promise.resolve())
  let frame = {}
  return {
    bringToFront: () => Promise.resolve(),
    browser: () => ({ targets: () => [] }),
    mainFrame: () => frame,
    setRequestInterception: (on) => done(`intercept ${on}`),
    waitForSelector: async (s) => (await done(`find ${s}`), {
      tap: () => done(`tap ${s}`),
      hover: () => done(`hover ${s}`),
      focus: () => done(`focus ${s}`),
    }),
    keyboard: {
      sendCharacter: (text) => done(`type ${text}`),
      press: (key) => done(`press ${key}`),
      down: (key) => done(`down ${key}`),
      up: (key) => done(`up ${key}`),
    },
    mouse: {
      down: () => done('mouse down'),
      up: () => done('mouse up'),
    },
    browserContext: () => ({
      overridePermissions: (origin, permissions) =>
        done(`allow ${permissions.join(',')} on ${origin}`),
    }),
    touchscreen: {
      touchStart: (x, y) => done(`touch ${x},${y}`),
      touchMove: (x, y) => done(`move ${x},${y}`),
      touchEnd: () => done('lift'),
    },
  }
}
