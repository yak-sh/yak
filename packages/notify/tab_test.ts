import { equal, test } from '@yaks/testing'
import { BEAT, type Tab } from './whereabouts.ts'
import { type Page, sayTab } from './tab.ts'

// A page driven by hand: its listeners, its one interval, and what it says.
let page = () => {
  let on = new Map<string, () => void>()
  let beat: { fn: () => void; ms: number } | undefined
  let state = { visibilityState: 'visible', focused: true }
  let listen = (type: string, fn: () => void) => on.set(type, fn)
  let unlisten = (type: string) => on.delete(type)
  let p: Page = {
    document: {
      get visibilityState() {
        return state.visibilityState
      },
      hasFocus: () => state.focused,
      addEventListener: listen,
      removeEventListener: unlisten,
    },
    addEventListener: listen,
    removeEventListener: unlisten,
    setInterval: (fn, ms) => beat = { fn, ms },
    clearInterval: () => beat = undefined,
  }
  return { p, on, state, beat: () => beat }
}

test('a page says its tab at once, on each change and every beat, until stopped', () => {
  let { p, on, state, beat } = page()
  let said: Tab[] = []
  let stop = sayTab(p, (t) => said.push(t))
  equal(said, [{ visible: true, focused: true }])
  state.focused = false
  on.get('blur')!()
  state.visibilityState = 'hidden'
  on.get('visibilitychange')!()
  equal(beat()?.ms, BEAT)
  beat()!.fn()
  equal(said.slice(1), [
    { visible: true, focused: false },
    { visible: false, focused: false },
    { visible: false, focused: false },
  ])
  stop()
  equal([on.size, beat()], [0, undefined])
})
