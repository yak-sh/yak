import { equal, test } from '@yaks/testing'
import { RESULT, type Result } from '@yaks/ui/interaction'
import { type Batch } from './interaction.ts'
import { interactions } from './interaction-browser.ts'

type Browser = Parameters<typeof interactions>[0]
let browser = (
  path: string,
  origin: number,
  storage = new Map<string, string>(),
) => {
  let doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  let win = new EventTarget()
  let now = 0
  let raf: (() => void)[] = []
  let tasks = new Map<number, () => void>()
  let timers = 0, change = () => {}
  let observed = [] as PerformanceEntry[]
  let seen: Batch[] = []
  class Changes {
    constructor(said: () => void) {
      change = said
    }
    observe() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  let scope = Object.assign(win, {
    document: doc,
    location: new URL(path, 'https://yaks.app'),
    performance: {
      now: () => now,
      timeOrigin: origin,
      getEntriesByType: (type: string) =>
        observed.filter((entry) => entry.entryType == type),
    },
    crypto,
    sessionStorage: {
      getItem: (key: string) => storage.get(key),
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    MutationObserver: Changes,
    requestAnimationFrame: (frame: () => void) => raf.push(frame),
    setTimeout: (run: () => void, ms: number) => {
      let id = ++timers
      if (!ms) tasks.set(id, run)
      return id
    },
    clearTimeout: (id: number) => tasks.delete(id),
  })
  let click = (href?: string, key = false, manual = false) => {
    let at = {
      nodeType: 1,
      getAttribute: (name: string) => name == 'href' ? href : null,
      hasAttribute: () => false,
      contains: (another: unknown) => another == at,
      closest: () => href ? at : null,
    }
    let input = (name: string, began: number) => {
      let event = new Event(name, { cancelable: true })
      Object.defineProperties(event, {
        button: { value: 0 },
        detail: { value: key ? 0 : 1 },
        isTrusted: { value: !manual },
        timeStamp: { value: began },
        composedPath: { value: () => [at] },
      })
      win.dispatchEvent(event)
      return event
    }
    if (key) input('keydown', now - 1)
    return input('click', now)
  }
  let install = () =>
    interactions(scope as unknown as Browser, {
      page: (url) => url.pathname.slice(1),
      target: (_at, _url, event) => event,
      send: (batch) => seen.push(batch),
    })
  return {
    install,
    observe: (entry: object) => observed.push(entry as PerformanceEntry),
    click,
    change: () => change(),
    at: (t: number) => now = t,
    result: (input: Event) => {
      let chosen: Result | undefined
      doc.dispatchEvent(
        new CustomEvent(RESULT, {
          detail: { input, take: (r: Result) => chosen = r },
        }),
      )
      return chosen!
    },
    frame: (at: number) => {
      now = at
      for (let run of raf.splice(0)) run()
      for (let [id, run] of tasks) {
        tasks.delete(id)
        run()
      }
    },
    leave: () => win.dispatchEvent(new Event('pagehide')),
    seen: () => seen.flatMap((batch) => batch.points),
  }
}

test('the event clock follows a keyboard-activated link through loading to its result', () => {
  let page = browser('/pricing', 1_000)
  page.install()
  page.at(10)
  let click = page.click('/gallery', true)
  let result = page.result(click)
  click.preventDefault()
  page.change()
  page.frame(20)
  page.at(140)
  result.drawn(110)
  page.frame(147)
  page.leave()
  equal(page.seen(), [{
    page: 'pricing',
    target: 'click',
    ms: 138,
    input: 0,
    server: 110,
    script: 21,
    render: 7,
  }])
})

// A page left at 30 for one whose navigation started at `origin`, after its
// form's post and redirect (`fetchStart`), answered at 125 and painted at 144.
let crossing = (origin: number) => {
  let storage = new Map<string, string>()
  let before = browser('/pricing', 1_000, storage)
  before.install()
  before.at(10)
  before.click('/gallery')
  before.at(30)
  before.leave()
  equal(before.seen(), [])
  let after = browser('/gallery', origin, storage)
  after.observe({
    entryType: 'navigation',
    type: 'navigate',
    startTime: 0,
    fetchStart: 90,
    responseEnd: 125,
    domInteractive: 130,
  })
  after.observe({
    entryType: 'paint',
    name: 'first-contentful-paint',
    startTime: 144,
  })
  after.at(151)
  after.install()
  after.leave()
  return after.seen()
}

test('native navigation finishes at the next document’s contentful paint, its post and redirect the server’s', () => {
  equal(crossing(1_020), [{
    page: 'pricing',
    target: 'click',
    ms: 154,
    input: 0,
    server: 125,
    script: 15,
    render: 14,
  }])
})

test('a document whose navigation began after the page left does not finish its input', () => {
  equal(crossing(1_400), [])
})

test('local paint is counted once and synthetic or unchanged inputs stay out', () => {
  let page = browser('/gallery', 1_000)
  page.install()
  page.install()
  page.click()
  page.frame(120)
  page.click(undefined, false, true)
  page.change()
  page.frame(150)
  page.click()
  page.change()
  page.change()
  page.frame(158)
  page.leave()
  equal(page.seen().map((p) => p.ms), [8])
})
