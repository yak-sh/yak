import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { type Browser, capture, type Message, type Page } from './browser.ts'

let view = { width: 390, height: 844, wait: 0 }
let page = (options: { loading?: Error; screenshot?: Error } = {}) => {
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
    evaluate: (expression) =>
      Promise.resolve(
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
          : undefined,
      ),
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
  assertEquals(result.accessibility.problems[0].rule, 'image-alt')
  assertEquals(result.console, [{ type: 'log', text: 'page ready' }])
  assertStringIncludes(result.errors[0], 'page exception')
  assertEquals(result.status, 200)
  assertEquals(p.closed(), true)
})

test('a failed page load still returns the screenshot and its error', async () => {
  let p = page({ loading: new Error('net::ERR_NAME_NOT_RESOLVED') })
  let result = await capture(
    () => Promise.resolve(p.browser),
    'https://private.invalid/',
    view,
  )
  assertEquals(result.image, 'png-bytes')
  assertEquals(result.accessibility.problems[0].rule, 'image-alt')
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
