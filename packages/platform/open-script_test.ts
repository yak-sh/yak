import { equal, test } from '@yaks/testing'
import { openScript } from './open-script.ts'
import { reportInteractions } from './interaction-report.ts'
import type { Batch } from '@yaks/timing/interaction'
import type { TimingRow } from '@yaks/timing'
import type { Bundle } from '@yaks/graph'
import { parseHTML } from 'linkedom'

let navigation = {
  redirectCount: 1,
  redirectStart: 2,
  redirectEnd: 7,
  workerStart: 10,
  fetchStart: 20,
  domainLookupStart: 23,
  domainLookupEnd: 27,
  connectStart: 28,
  secureConnectionStart: 35,
  connectEnd: 59,
  requestStart: 60,
  responseStart: 180,
  responseEnd: 190,
}

let browser = (
  href = 'https://yaks.app/ada',
  origin = new URL(href).origin,
  nav = navigation,
) => {
  let document = Object.assign(new EventTarget(), {
    readyState: 'loading',
    querySelector: (_selector: string): object | null => null,
  })
  let window = Object.assign(new EventTarget(), { origin })
  let sent: Batch[] = []
  let frames: (() => void)[] = []
  let entries = new Map<string, { startTime: number }>()
  let clock = 0
  let performance = {
    timeOrigin: 1795626000000,
    now: () => clock,
    getEntriesByType: () => [nav],
    getEntriesByName: (name: string) =>
      entries.has(name) ? [entries.get(name)] : [],
    mark: (name: string, { startTime = clock } = {}) =>
      entries.set(name, { startTime }),
    clearMarks: (name: string) => entries.delete(name),
  }
  let location = new URL(href)
  let history = {
    replaceState: (_state: unknown, _title: string, url: string) =>
      location.href = url,
  }
  let run = (source?: 'picture' | 'shell' | 'push') =>
    new Function(
      'window',
      'top',
      'self',
      'document',
      'history',
      'location',
      'screen',
      'navigator',
      'matchMedia',
      'performance',
      'requestAnimationFrame',
      'setTimeout',
      'addEventListener',
      `return ${openScript('/api/interaction?open=1', source)}`,
    )(
      window,
      window,
      window,
      document,
      history,
      location,
      { width: 375, height: 812 },
      {
        userAgent: 'iPhone',
        standalone: origin != 'null',
        get serviceWorker() {
          if (origin == 'null') {
            throw new DOMException(
              'Sandboxed',
              'SecurityError',
            )
          }
          return { controller: null }
        },
        sendBeacon: (_at: string, body: string) => sent.push(JSON.parse(body)),
      },
      (query: string) => ({
        matches: origin == 'null' &&
          query.includes('(display-mode: fullscreen)'),
      }),
      performance,
      (fn: () => void) => frames.push(fn),
      (fn: () => void) => fn(),
      window.addEventListener.bind(window),
    )
  let parsed = (at: number) => {
    clock = at
    document.dispatchEvent(new Event('DOMContentLoaded'))
  }
  let frame = (at: number, measured?: number) => {
    clock = at
    if (measured != null) {
      performance.mark('first-contentful-paint', { startTime: measured })
    }
    for (let fn of frames.splice(0)) fn()
  }
  return {
    run,
    document,
    parsed,
    frame,
    sent,
    window,
    entries,
    location,
    at: performance.timeOrigin,
  }
}

test('an Operator opening records the frame paint and waits for the composer to be usable', () => {
  let b = browser()
  b.document.querySelector = () => ({})
  let open = b.run()
  b.parsed(200)
  b.frame(250, 220)
  equal(b.sent, [])
  b.entries.set('yak-usable', { startTime: 900 })
  b.document.readyState = 'complete'
  open.ready()
  equal(b.sent.map(({ open }) => [open?.paint, open?.usable]), [[220, 900]])
})

test('Updates reports readiness while its hidden Operator view is still opening', () => {
  let b = browser('https://yaks.app/updates')
  let { document } = parseHTML(
    '<main><h1>Updates</h1><section hidden><div data-operator-opening></div></section></main>',
  )
  b.document.querySelector = (selector) => document.querySelector(selector)
  b.run()
  b.parsed(200)
  b.frame(250, 220)
  equal(b.sent.map(({ open }) => [open?.paint, open?.usable]), [[220, 220]])
})

test('an Updates error paints without reporting the cards usable', () => {
  let b = browser('https://yaks.app/updates')
  let { document } = parseHTML(
    '<main><p data-updates-unavailable>Updates could not be read.</p></main>',
  )
  b.document.querySelector = (selector) => document.querySelector(selector)
  let open = b.run()
  b.parsed(200)
  b.frame(250, 220)
  open.leave()
  equal(b.sent.map(({ open }) => [open?.paint, open?.usable]), [[220, null]])
})

test('the streamed composer can take typing before the document finishes', () => {
  let b = browser()
  b.document.querySelector = () => ({})
  let open = b.run()
  b.frame(340, 325)
  b.entries.set('yak-usable', { startTime: 340 })
  open.ready(true)
  equal(b.sent.map(({ open }) => [open?.paint, open?.usable]), [[325, 340]])
})

test('a sandboxed fullscreen app reports its opening without service worker access', () => {
  let b = browser('https://ada.yaks.app/explore/', 'null')
  b.run()
  b.parsed(30)
  b.frame(60, 50)
  equal(b.sent.map(({ open }) => [open?.installed, open?.controlled]), [[
    true,
    false,
  ]])
})

let reported = async (
  b: ReturnType<typeof browser>,
  opened: { page: string; person?: string },
  app?: string,
): Promise<Bundle[]> => {
  let rows: Bundle[] = []
  let req = new Request('https://yaks.app/api/interaction?open=1', {
    method: 'POST',
    body: JSON.stringify(b.sent[0]),
  })
  await reportInteractions(req, {
    sink: (got) => Promise.resolve(void rows.push(...got)),
    now: () => b.at,
    failed: (error) => {
      throw error
    },
    opened,
    ...app ? { app } : {},
  })
  return rows
}

let coldHome = (
  responseStart: number,
  paint: number,
  usable: number,
  changes: Partial<typeof navigation> = {},
) => {
  let b = browser('https://yaks.app/', undefined, {
    workerStart: 0,
    fetchStart: 5296.8,
    requestStart: 6375.8,
    responseStart,
    redirectCount: 0,
    redirectStart: 0,
    redirectEnd: 0,
    domainLookupStart: 5296.8,
    domainLookupEnd: 5296.8,
    connectStart: 5308.8,
    secureConnectionStart: 6307.3,
    connectEnd: 6375.6,
    responseEnd: responseStart + 377,
    ...changes,
  })
  b.run()
  b.entries.set('yak-usable', { startTime: usable })
  b.parsed(usable - 0.5)
  b.frame(usable + 1, paint)
  return b
}

let incidents = (rows: Bundle[]) =>
  rows.flatMap((row) =>
    row.error
      ? [
        row.error as {
          level: string
          tags: { ms: number; elapsed?: number; server: number }
        },
      ]
      : []
  )

test('a direct cold Home open keeps the full time but grades from the request', async () => {
  let rows = await reported(coldHome(7182.8, 9452, 9824.1), { page: 'home' })
  let timing = rows.filter((row) => row.timing) as TimingRow[]
  equal(timing.map((row) => Math.round(row.timing.total)), [9452, 9824])
  equal(
    incidents(rows).map(({ level, tags }) => [
      level,
      Math.round(tags.ms),
      tags.elapsed,
      Math.round(tags.server),
    ]),
    [['warning', 3076, 9452, 807]],
  )
})

test('a cold Home open still files slow responses after the request starts', async () => {
  let rows = await reported(coldHome(11045.8, 12100, 14000), { page: 'home' })
  equal(
    incidents(rows).map(({ level, tags }) => [level, Math.round(tags.ms)]),
    [
      ['error', 5724],
      ['error', 7624],
    ],
  )
})

test('a cold open with a redirect, worker, or missing request time keeps the full budget interval', async () => {
  let changes = [
    { redirectCount: 1 },
    { workerStart: 100 },
    { requestStart: 0 },
  ]
  for (let change of changes) {
    let b = coldHome(7182.8, 9452, 9824.1, change)
    let rows = await reported(b, { page: 'home' })
    equal(incidents(rows).map(({ level, tags }) => [level, tags.ms]), [
      ['error', 9452],
      ['error', 9824.1],
    ])
  }
})

test('a cold document opened from a notification records paint, readiness and the network wait once', () => {
  let b = browser('https://yaks.app/ada?_yak_open=push#row-123')
  b.run()
  b.parsed(350)
  b.frame(375, 360)
  b.window.dispatchEvent(new Event('pagehide'))
  equal(b.location.href, 'https://yaks.app/ada#row-123')
  equal(b.sent.map((p) => p.open), [{
    source: 'push',
    picture: false,
    device: 'iphone-compact',
    installed: true,
    paint: 360,
    usable: 360,
    server: 120,
    estimated: false,
    controlled: false,
    parsed: 350,
    frame: 375,
    navigation,
  }])
})

test('a slow network open reports the browser navigation timestamps with the incident', async () => {
  let b = browser()
  b.run()
  b.parsed(4000)
  b.frame(4100)
  let rows = await reported(b, { page: 'updates' })
  let tags = rows.flatMap((row) =>
    row.error ? [(row.error as { tags: typeof navigation }).tags] : []
  )
  let names = Object.keys(navigation) as (keyof typeof navigation)[]
  equal(tags.map((tag) => names.map((name) => tag[name])), [
    Object.values(navigation),
    Object.values(navigation),
  ])
})

test('a slow open of an app page names its app', async () => {
  let b = browser('https://ada.yaks.app/explore/')
  b.run()
  b.parsed(4000)
  b.frame(4100)
  let rows = await reported(b, { page: 'app' }, 'ada/explore')
  let apps = rows.flatMap((row) =>
    row.error ? [(row.error as { tags: { app?: string } }).tags.app] : []
  )
  equal(apps, ['ada/explore', 'ada/explore'])
})

test('a slow open begun hidden is counted but never filed as slow', async () => {
  let b = browser()
  b.run()
  b.parsed(4000)
  b.frame(4100)
  b.sent[0].open!.unseen = true
  let rows = await reported(b, { page: 'dashboard' })
  equal(rows.filter((row) => row.error), [])
  equal(rows.some((row) => row.timing), true)
})

test('a picture and its replacement report one paired sample and use the picture paint budget', async () => {
  let b = browser()
  let held = b.run('push')
  b.parsed(30)
  b.frame(600)
  await held.frame
  held.swapping()
  b.frame(620, 590)
  held.waited(300, 240)
  equal(b.sent.length, 0)
  b.run()
  b.entries.set('yak-usable', { startTime: 980 })
  b.parsed(1000)
  equal(b.sent.length, 1)
  let person = crypto.randomUUID()
  let rows = await reported(b, { page: 'operator', person })
  let timings = rows.filter((row) => row.timing) as TimingRow[]
  equal(timings.map((row) => [row.timing.total, row.during.entity]), [
    [590, person],
    [980, person],
  ])
  equal(timings[0].timing.counts.server, 300)
  equal(timings.map((row) => row.timing.counts.overBudget), [1, 0])
  let errors = rows.filter((row) => row.error)
  equal(
    errors.map((row) =>
      (row.error as { tags: { gateway?: number } }).tags.gateway
    ),
    [240],
  )
})

test("an offline kept picture reports its paint and its worker's answer without pretending its scripts ran", () => {
  let b = browser()
  let held = b.run('picture')
  held.offline()
  b.parsed(60)
  b.frame(90)
  equal(b.sent.map((p) => p.open), [{
    source: 'picture',
    picture: true,
    device: 'iphone-compact',
    installed: true,
    paint: 90,
    usable: null,
    server: null,
    estimated: true,
    controlled: false,
    parsed: 60,
    frame: 90,
    navigation,
  }])
})

test('a shell paints on the picture budget and is usable on the cold one', async () => {
  let b = browser()
  let held = b.run('shell')
  b.parsed(30)
  b.frame(200)
  await held.frame
  held.swapping()
  held.waited(2000)
  b.run()
  b.entries.set('yak-usable', { startTime: 2400 })
  b.parsed(2500)
  equal(b.sent.map((p) => [p.open?.source, p.open?.picture]), [['shell', true]])
  let rows = await reported(b, { page: 'updates', person: crypto.randomUUID() })
  let timings = rows.filter((row) => row.timing) as TimingRow[]
  equal(
    timings.map((row) => [row.timing.total, row.timing.counts.overBudget]),
    [
      [200, 0],
      [2400, 0],
    ],
  )
})

test('a picture left before its page is usable says how far its bootstrap came', async () => {
  let b = browser()
  let held = b.run('picture')
  held.step('files')
  b.parsed(30)
  b.frame(600, 590)
  b.window.dispatchEvent(new Event('pagehide'))
  equal(
    b.sent.map(({ open }) => [open?.usable, open?.stage, open?.left]),
    [[null, 'files', true]],
  )
  let rows = await reported(b, {
    page: 'operator',
    person: crypto.randomUUID(),
  })
  let timings = rows.filter((row) => row.timing) as TimingRow[]
  equal(timings.map((row) => row.timing.counts.left), [undefined, 1])
  let [tags] = rows.flatMap((row) =>
    row.error ? [(row.error as { tags: Record<string, unknown> }).tags] : []
  )
  equal(
    [
      tags.usable,
      tags.stage,
      tags.left,
      tags.parsed,
      tags.frame,
      tags.estimated,
    ],
    [null, 'files', true, 30, 600, false],
  )
})

test('a browser that leaves out navigation timestamps keeps those it gave', async () => {
  let b = browser()
  b.run()
  b.parsed(4000)
  b.frame(4100)
  let { workerStart: _, requestStart: __, ...given } = navigation
  b.sent[0].open!.navigation = given
  let rows = await reported(b, { page: 'updates' })
  let [tags] = rows.flatMap((row) =>
    row.error ? [(row.error as { tags: Record<string, unknown> }).tags] : []
  )
  equal([tags.fetchStart, tags.responseStart, 'workerStart' in tags], [
    20,
    180,
    false,
  ])
})
