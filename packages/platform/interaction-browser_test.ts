import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { reloaded } from './interaction-browser.ts'
import { interactionTarget, targetKind } from './interaction.ts'

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

test('homepage timings name the link, example jump or section that was tapped', () => {
  let { document } = parseHTML(`
    <a href="/?campaign=test#helpers"><span id="tab">Helpers</span></a>
    <a id="pricing" href="#cost">Pricing</a>
    <a id="catalog" href="/integrations">All integrations</a>
    <li data-line="1" data-turn="5">
      <a id="message" class="Home_MessageLink" href="#helpers">A reply</a>
      <div id="edge"></div>
    </li>
    <div data-wander><img id="yak"></div>
    <div class="Home_SkySpace"><span id="sky"></span></div>
    <section data-story-step="5" id="helpers"><div id="text"></div></section>
    <a id="private" href="#private-fragment">An arbitrary fragment</a>
  `)
  let here = new URL('https://yaks.app/?campaign=test')
  let labels = [
    ['tab', 'section-helpers'],
    ['pricing', 'section-cost'],
    ['catalog', 'open-integrations'],
    ['message', 'example-helpers'],
    ['edge', 'example-helpers'],
    ['yak', 'home-mascot'],
    ['sky', 'home-sky'],
    ['text', 'in-helpers'],
    ['private', 'anchor'],
  ]
  for (let [id, target] of labels) {
    equal(targetKind(document.getElementById(id)!, here, 'click'), target)
    equal(interactionTarget(target), true)
  }
  equal(interactionTarget('section-private-fragment'), false)
})
