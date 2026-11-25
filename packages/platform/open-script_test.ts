import { equal, test } from '@yaks/testing'
import { openScript } from './open-script.ts'
import { reportInteractions } from './interaction-report.ts'
import type { Batch } from '@yaks/timing/interaction'
import type { TimingRow } from '@yaks/timing'
import type { Bundle } from '@yaks/graph'

let browser = (href = 'https://yaks.app/ada') => {
  let document = Object.assign(new EventTarget(), {
    readyState: 'loading',
    querySelector: () => null,
  })
  let window = new EventTarget()
  let sent: Batch[] = []
  let frames: (() => void)[] = []
  let entries = new Map<string, { startTime: number }>()
  let clock = 0
  let performance = {
    timeOrigin: 1795626000000,
    now: () => clock,
    getEntriesByType: () => [{ requestStart: 60, responseStart: 180 }],
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
        standalone: true,
        sendBeacon: (_at: string, body: string) => sent.push(JSON.parse(body)),
      },
      () => ({ matches: false }),
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
    parsed,
    frame,
    sent,
    window,
    entries,
    location,
    at: performance.timeOrigin,
  }
}

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
  }])
})

test('a picture and its replacement report one paired sample and use the picture paint budget', async () => {
  let b = browser()
  let held = b.run('push')
  b.parsed(30)
  b.frame(600)
  await held.frame
  held.swapping()
  b.frame(620, 590)
  held.waited(300)
  equal(b.sent.length, 0)
  b.run()
  b.entries.set('yak-usable', { startTime: 980 })
  b.parsed(1000)
  equal(b.sent.length, 1)
  let rows: Bundle[] = []
  let person = crypto.randomUUID()
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
    opened: { page: 'operator', person },
  })
  let timings = rows.filter((row) => row.timing) as TimingRow[]
  equal(timings.map((row) => [row.timing.total, row.during.entity]), [
    [590, person],
    [980, person],
  ])
  equal(timings[0].timing.counts.server, 300)
  equal(timings.map((row) => row.timing.counts.overBudget), [1, 0])
  equal(rows.filter((row) => row.error).length, 1)
})

test('an offline kept picture reports its paint without pretending its scripts ran', () => {
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
  let rows: Bundle[] = []
  await reportInteractions(
    new Request('https://yaks.app/api/interaction?open=1', {
      method: 'POST',
      body: JSON.stringify(b.sent[0]),
    }),
    {
      sink: (got) => Promise.resolve(void rows.push(...got)),
      now: () => b.at,
      failed: (error) => {
        throw error
      },
      opened: { page: 'updates', person: crypto.randomUUID() },
    },
  )
  let timings = rows.filter((row) => row.timing) as TimingRow[]
  equal(
    timings.map((row) => [row.timing.total, row.timing.counts.overBudget]),
    [
      [200, 0],
      [2400, 0],
    ],
  )
})
