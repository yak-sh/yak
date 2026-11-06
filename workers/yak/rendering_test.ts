import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import type { Clock } from '@yaks/fp'
import {
  answer,
  type Browser,
  type Browsing,
  capture,
  CHECK,
  type Message,
  type Page,
  RENDER,
  type Session,
} from './browser/capture.ts'
import { render } from './browser.ts'
import { type Audit, report } from './accessibility.ts'
import { within } from './defects.ts'
import type { Bundle } from '@yaks/graph'

let view = { width: 390, height: 844, wait: 0 }

// The page's main world runs its own scripts; only the audit's isolated
// world answers axe-core, the way Chrome keeps the two realms apart.
let devtools = (
  main: (expression: string) => unknown,
  world: (expression: string) => unknown,
) => {
  let worlds = 0
  let cdp: Session = {
    send: (method, params) => {
      if (method == 'Page.getFrameTree') {
        return Promise.resolve({ frameTree: { frame: { id: 'main' } } })
      }
      if (method == 'Page.createIsolatedWorld') {
        return Promise.resolve({ executionContextId: ++worlds })
      }
      let { expression, contextId } = params as {
        expression: string
        contextId?: number
      }
      try {
        let value = contextId ? world(expression) : main(expression)
        return Promise.resolve({ result: { value } })
      } catch (e) {
        return Promise.resolve({
          result: {},
          exceptionDetails: {
            text: 'Uncaught',
            exception: { description: (e as Error).stack },
          },
        })
      }
    },
  }
  return cdp
}
let axe = (expression: string) =>
  expression.includes('axe.run(document')
    ? {
      violations: [{
        id: 'image-alt',
        help: 'Add alternative text',
        impact: 'critical',
        nodes: [{ html: '<img src=photo.png>', target: ['img'] }],
      }],
      incomplete: [],
    }
    : undefined
let page = (
  options: {
    loading?: Error
    screenshot?: Error
    main?: typeof axe
    world?: typeof axe
  } = {},
) => {
  let cdp = devtools(options.main ?? axe, options.world ?? axe)
  let hear = new Map<string, (value: unknown) => void>()
  let viewport: unknown
  let closed = false
  let p: Page = {
    on: (event: string, fn: (value: never) => void) => {
      hear.set(event, fn as (value: unknown) => void)
    },
    setViewport: (v) => {
      viewport = v
      return Promise.resolve()
    },
    goto: () => {
      hear.get('console')?.(
        { type: () => 'log', text: () => 'page ready' } satisfies Message,
      )
      hear.get('pageerror')?.(new Error('page exception'))
      return options.loading
        ? Promise.reject(options.loading)
        : Promise.resolve({ status: () => 200 })
    },
    createCDPSession: () => Promise.resolve(cdp),
    screenshot: () =>
      options.screenshot
        ? Promise.reject(options.screenshot)
        : Promise.resolve('png-bytes'),
  }
  let browser: Browser = {
    newPage: () => Promise.resolve(p),
    close: () => {
      closed = true
      return Promise.resolve()
    },
  }
  let browsing: Browsing = {
    acquire: () => Promise.resolve('session'),
    connect: () => Promise.resolve(browser),
    axe: { source: '', version: 'test' },
  }
  return {
    p,
    browser,
    browsing,
    hear,
    viewport: () => viewport,
    closed: () => closed,
  }
}

// The kernel's BROWSER binding, answered by yak-browser over these fakes.
let bound = (browsing: Browsing, time?: Clock) => ({
  BROWSER: { fetch: answer(browsing, time) },
  CLOCK: time,
})
let reported = <T>(run: () => Promise<T>) => {
  let reports: Bundle[] = []
  return within(
    { ERRORS: { send: (rows) => (reports.push(...rows), Promise.resolve()) } },
    { request: 'app_preview' },
    async () => ({ result: await run(), reports: JSON.stringify(reports) }),
  )
}

test('draft rendering captures loading diagnostics at the requested viewport and closes', async () => {
  let p = page()
  let result = await capture(
    p.browsing,
    'https://private.invalid/',
    view,
  )
  assertEquals(p.viewport(), { width: 390, height: 844 })
  assertEquals(result.image, 'png-bytes')
  assertEquals((result.accessibility as Audit).problems[0].rule, 'image-alt')
  assertEquals(result.console, [{ type: 'log', text: 'page ready' }])
  assertStringIncludes(result.errors[0], 'page exception')
  assertEquals(result.status, 200)
  assertEquals(p.closed(), true)
})

test('a page that extends Object.prototype still gets its accessibility audit', async () => {
  // orbits adds an enumerable Object.prototype.tap, which axe-core's color
  // spaces read as a fourth coordinate when it loads in that world.
  let p = page({
    main: () => {
      throw new TypeError("Cannot read properties of undefined (reading '0')")
    },
  })
  let result = await capture(
    p.browsing,
    'https://private.invalid/',
    view,
  )
  assertEquals(result.image, 'png-bytes')
  assertEquals((result.accessibility as Audit).problems[0].rule, 'image-alt')
})

test('a check that throws keeps the preview and the kernel reports its failure', async () => {
  let p = page({
    world: () => {
      throw new RangeError('axe gave up')
    },
  })
  let { result, reports } = await reported(() =>
    render(bound(p.browsing), 'https://x.invalid/', view)
  )
  assertEquals(result.image, 'png-bytes')
  assertEquals(result.console, [{ type: 'log', text: 'page ready' }])
  assertStringIncludes(result.errors[0], 'page exception')
  assertStringIncludes(report(result.accessibility), 'RangeError: axe gave up')
  assertStringIncludes(reports, 'axe gave up')
  assertEquals(p.closed(), true)
})

test('a check that passes reports nothing', async () => {
  let { result, reports } = await reported(() =>
    render(bound(page().browsing), 'https://x.invalid/', view)
  )
  assertEquals((result.accessibility as Audit).problems[0].rule, 'image-alt')
  assertEquals(reports, '[]')
})

test('the audit runs the script it is given in its own world', async () => {
  let ran: string[] = []
  let p = page({
    world: (expression) => (ran.push(expression), axe(expression)),
  })
  let result = await capture(
    {
      ...p.browsing,
      axe: { source: 'S', version: '9' },
    },
    'https://x.invalid/',
    view,
  )
  assertEquals(ran[0], 'S')
  assertEquals((result.accessibility as Audit).engine, 'axe-core 9')
})

test('a check that stalls keeps the preview and fails at its own deadline', async () => {
  let p = page()
  let time = clock()
  p.p.createCDPSession = () => new Promise(() => {})
  let running = capture(
    p.browsing,
    'https://x.invalid/',
    view,
    undefined,
    time,
  )
  await time.advance(CHECK)
  let result = await running
  assertEquals(result.image, 'png-bytes')
  assertStringIncludes(
    report(result.accessibility),
    'Accessibility check timed out after 10 seconds',
  )
  assertEquals(time.pending(), 0)
})

test('a slow load leaves the check its own time', async () => {
  let p = page()
  let time = clock()
  let after = <T>(ms: number, value: () => Promise<T>) =>
    new Promise<T>((done) => time.after(ms, () => done(value())))
  let { goto, createCDPSession } = p.p
  p.p.goto = (...args) => after(RENDER - 1000, () => goto(...args))
  p.p.createCDPSession = () => after(CHECK - 1000, createCDPSession)
  let running = capture(p.browsing, 'https://x.invalid/', view, undefined, time)
  await time.advance(RENDER - 1000)
  await time.advance(CHECK - 1000)
  let result = await running
  assertEquals((result.accessibility as Audit).problems[0].rule, 'image-alt')
  assertEquals(result.duration, RENDER + CHECK - 2000)
})

test('a failed check is reported with the space and app it previewed', async () => {
  let p = page({
    world: () => {
      throw new RangeError('axe gave up')
    },
  })
  let { reports } = await reported(() =>
    render(bound(p.browsing), 'https://x.invalid/', view, undefined, {
      space: 'jeff',
      app: 'jolly-wedding',
    })
  )
  assertStringIncludes(reports, 'jolly-wedding')
})

test('a failed page load still returns the screenshot and its error', async () => {
  let p = page({ loading: new Error('net::ERR_NAME_NOT_RESOLVED') })
  let result = await capture(
    p.browsing,
    'https://private.invalid/',
    view,
  )
  assertEquals(result.image, 'png-bytes')
  assertEquals((result.accessibility as Audit).problems[0].rule, 'image-alt')
  assertEquals(result.status, 0)
  assertStringIncludes(result.errors[1], 'net::ERR_NAME_NOT_RESOLVED')
  assertEquals(p.closed(), true)
})

test('a screenshot failure closes its browser and the kernel charges its time', async () => {
  let p = page({ screenshot: new Error('browser unavailable') })
  let time = clock()
  let duration = 0
  p.browser.close = async () => {
    await time.advance(200)
  }
  let browsing = {
    ...p.browsing,
    connect: async () => {
      await time.advance(100)
      return p.browser
    },
  }
  await assertRejects(
    () =>
      render(bound(browsing, time), 'https://private.invalid/', view, (ms) => {
        duration = ms
        return Promise.resolve()
      }),
    Error,
    'browser unavailable',
  )
  assertEquals(duration, 300)
  assertEquals(time.pending(), 0)
})

// A connect that fails `misses` times, then opens the page's browser.
let flaky = (misses: number) => {
  let p = page()
  let sessions: string[] = []
  let browsing: Browsing = {
    ...p.browsing,
    acquire: () => Promise.resolve(`session ${sessions.length}`),
    connect: (session) => {
      sessions.push(session)
      return sessions.length > misses
        ? Promise.resolve(p.browser)
        : Promise.reject(new TypeError("reading 'accept' of null"))
    },
  }
  return { p, browsing, sessions }
}
// Each pause between connects, one turn of the clock apiece.
let paused = async (time: ReturnType<typeof clock>) => {
  for (let pause of [250, 500, 1000]) await time.advance(pause)
}

test('a session not ready yet is connected to again', async () => {
  let { p, browsing, sessions } = flaky(2)
  let time = clock()
  let rendering = capture(browsing, 'https://x.invalid/', view, undefined, time)
  await paused(time)
  assertEquals((await rendering).image, 'png-bytes')
  assertEquals(sessions, ['session 0', 'session 0', 'session 0'])
  assertEquals(p.closed(), true)
})

test('a session that never takes a connection fails the preview', async () => {
  let { browsing, sessions } = flaky(Infinity)
  let time = clock()
  let rendering = capture(browsing, 'https://x.invalid/', view, undefined, time)
  rendering.catch(() => {})
  await paused(time)
  await assertRejects(() => rendering, Error, "reading 'accept' of null")
  assertEquals(sessions.length, 4)
})

test('a yak-browser that cannot say is charged the time the kernel waited', async () => {
  let time = clock()
  let duration = 0
  let BROWSER = {
    fetch: async () => {
      await time.advance(700)
      return new Response('worker exceeded its CPU', { status: 503 })
    },
  }
  await assertRejects(
    () =>
      render({ BROWSER, CLOCK: time }, 'https://x.invalid/', view, (ms) => {
        duration = ms
        return Promise.resolve()
      }),
    Error,
    'yak-browser 503',
  )
  assertEquals(duration, 700)
})

test('draft diagnostics are bounded while collecting messages during load', async () => {
  let p = page()
  p.p.goto = () => {
    for (let n = 0; n < 150; n++) {
      p.hear.get('console')?.({
        type: () => 'log',
        text: () => 'x'.repeat(3000),
      })
      p.hear.get('pageerror')?.('x'.repeat(3000))
    }
    return Promise.resolve({ status: () => 200 })
  }
  let result = await capture(
    p.browsing,
    'https://private.invalid/',
    view,
  )
  assertEquals(result.console.length, 100)
  assertEquals(result.console[0].text.length, 2000)
  assertEquals(result.errors.length, 100)
  assertEquals(result.errors[0].length, 2000)
})

test('a stalled screenshot releases its browser and accounts for elapsed time', async () => {
  let p = page()
  let time = clock()
  let used = 0
  p.p.screenshot = () => new Promise(() => {})
  let running = capture(
    p.browsing,
    'https://private.invalid/',
    view,
    (ms) => {
      used = ms
      return Promise.resolve()
    },
    time,
  )
  let failed = assertRejects(() => running, Error, 'Browser preview timed out')
  await time.advance(15_000)
  await failed
  assertEquals(p.closed(), true)
  assertEquals(used, 15_000)
  assertEquals(time.pending(), 0)
})
