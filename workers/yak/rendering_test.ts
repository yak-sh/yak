import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import {
  type Browser,
  capture,
  type Message,
  type Page,
  type Session,
} from './browser.ts'
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
  return { p, browser, hear, viewport: () => viewport, closed: () => closed }
}

test('draft rendering captures loading diagnostics at the requested viewport and closes', async () => {
  let p = page()
  let result = await capture(
    () => Promise.resolve(p.browser),
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
    () => Promise.resolve(p.browser),
    'https://private.invalid/',
    view,
  )
  assertEquals(result.image, 'png-bytes')
  assertEquals((result.accessibility as Audit).problems[0].rule, 'image-alt')
})

test('a check that throws keeps the preview and reports its failure', async () => {
  let p = page({
    world: () => {
      throw new RangeError('axe gave up')
    },
  })
  let reports: Bundle[] = []
  let result = await within(
    { ERRORS: { send: (rows) => (reports.push(...rows), Promise.resolve()) } },
    { request: 'app_preview' },
    () => capture(() => Promise.resolve(p.browser), 'https://x.invalid/', view),
  )
  assertEquals(result.image, 'png-bytes')
  assertEquals(result.console, [{ type: 'log', text: 'page ready' }])
  assertStringIncludes(result.errors[0], 'page exception')
  assertStringIncludes(report(result.accessibility), 'RangeError: axe gave up')
  assertStringIncludes(JSON.stringify(reports), 'axe gave up')
  assertEquals(p.closed(), true)
})

test('a check that stalls keeps the preview and fails at the deadline', async () => {
  let p = page()
  let time = clock()
  p.p.createCDPSession = () => new Promise(() => {})
  let running = capture(
    () => Promise.resolve(p.browser),
    'https://x.invalid/',
    view,
    undefined,
    time,
  )
  await time.advance(15_000)
  let result = await running
  assertEquals(result.image, 'png-bytes')
  assertStringIncludes(
    report(result.accessibility),
    'Browser preview timed out',
  )
  assertEquals(time.pending(), 0)
})

test('a failed page load still returns the screenshot and its error', async () => {
  let p = page({ loading: new Error('net::ERR_NAME_NOT_RESOLVED') })
  let result = await capture(
    () => Promise.resolve(p.browser),
    'https://private.invalid/',
    view,
  )
  assertEquals(result.image, 'png-bytes')
  assertEquals((result.accessibility as Audit).problems[0].rule, 'image-alt')
  assertEquals(result.status, 0)
  assertStringIncludes(result.errors[1], 'net::ERR_NAME_NOT_RESOLVED')
  assertEquals(p.closed(), true)
})

test('a screenshot failure closes its browser and accounts for its time', async () => {
  let p = page({ screenshot: new Error('browser unavailable') })
  let time = clock()
  let duration = 0
  p.browser.close = async () => {
    await time.advance(200)
  }
  await assertRejects(
    () =>
      capture(
        async () => {
          await time.advance(100)
          return p.browser
        },
        'https://private.invalid/',
        view,
        (ms) => {
          duration = ms
          return Promise.resolve()
        },
        time,
      ),
    Error,
    'browser unavailable',
  )
  assertEquals(duration, 300)
  assertEquals(time.pending(), 0)
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
    () => Promise.resolve(p.browser),
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
    () => Promise.resolve(p.browser),
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
