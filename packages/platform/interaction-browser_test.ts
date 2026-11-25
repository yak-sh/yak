import { equal, test } from '@yaks/testing'
import { reloaded } from './interaction-browser.ts'

// A tab: its session storage, how its document came to be, and its first
// paint, `ms` after the reload began.
let tab = (kept = new Map<string, string>()) => {
  let on: Record<string, ((e: { persisted?: boolean }) => void)[]> = {}
  let open = (type: string, ms = 640) =>
    reloaded(
      {
        sessionStorage: {
          getItem: (k: string) => kept.get(k) ?? null,
          setItem: (k: string, v: string) => void kept.set(k, v),
          removeItem: (k: string) => void kept.delete(k),
        },
        addEventListener: (kind: string, fn: () => void) =>
          (on[kind] ??= []).push(fn),
        performance: {
          getEntriesByType: () => [{ type, responseStart: 90 }],
        },
        PerformanceObserver: class {
          constructor(public fn: (l: unknown) => void) {}
          observe() {
            this.fn({ getEntriesByName: () => [{ startTime: ms }] })
          }
          disconnect() {}
        },
      } as unknown as Window & typeof globalThis,
      'operator',
    )
      .then((p) => p && [p.target, p.ms, p.server])
  let leave = () => on.pagehide?.forEach((fn) => fn({}))
  return { kept, open, leave }
}

test('a reload is counted by why it happened: the stamp, a page that never left, else the person', async () => {
  let t = tab()
  equal(await t.open('navigate'), null)
  t.leave()
  equal(await t.open('reload'), ['reload', 640, 90])
  t.leave()
  t.kept.set('yak-reload', 'away')
  equal(await t.open('reload'), ['reload-away', 640, 90])
  // The page was let go of without leaving: brought back, it reloads.
  equal(await t.open('reload', 2400), ['reload-discarded', 2400, 90])
  t.leave()
  t.kept.set('yak-reload', 'whim')
  equal(await t.open('reload'), ['reload-unknown', 640, 90])
})
