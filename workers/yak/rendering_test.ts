import { clock, test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import type { Clock } from '@yaks/fp'
import {
  answer,
  BROWSE_REPLY,
  type Browser,
  type Browsing,
  capture,
  CHECK,
  CONNECT,
  type Cookie,
  type Message,
  MOST,
  OPEN,
  type Page,
  RELEASE,
  RENDER,
  type Session,
} from '@yaks/platform/browser-visit'
import { render, seen } from './browser.ts'
import { actions } from './browser/testing.ts'
import { type Audit, report } from '@yaks/platform/preview-audit'
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
  expression.includes('innerText')
    ? 'Meetings\nAgenda'
    : expression.includes('axe.run(document')
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
    missing?: string
    /** A selector whose press opens a confirm, as input does, returning only
     * once it is dismissed. */
    confirm?: string
  } = {},
) => {
  let log: string[] = []
  let shots = 0
  let cdp = devtools(options.main ?? axe, options.world ?? axe)
  let hear = new Map<string, (value: unknown) => void>()
  let viewport: unknown
  let cookies: Cookie[] = []
  let opened: Cookie[] | undefined
  let closed = false
  let acts = actions((line) => log.push(line))
  let p: Page = {
    ...acts,
    waitForSelector: async (s, o) => {
      if (s == options.missing) {
        throw new Error(`Waiting for selector \`${s}\` failed`)
      }
      let el = (await acts.waitForSelector(s, o))!
      if (s != options.confirm) return el
      let tap = () =>
        new Promise<void>((dismiss) =>
          hear.get('dialog')?.({
            type: () => 'confirm',
            message: () => 'Delete it?',
            dismiss: () => (log.push('dismiss'), dismiss(), Promise.resolve()),
          })
        )
      return { ...el, tap }
    },
    on: (event: string, fn: (value: never) => void) => {
      hear.set(event, fn as (value: unknown) => void)
    },
    setViewport: (v) => {
      viewport = v
      log.push(`view ${v.width}x${v.height}${v.hasTouch ? ' touch' : ''}`)
      return Promise.resolve()
    },
    setCookie: (...c) => {
      cookies.push(...c)
      return Promise.resolve()
    },
    goto: () => {
      opened = [...cookies]
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
        : Promise.resolve(shots++ ? `png-${shots}` : 'png-bytes'),
  }
  let browser: Browser = {
    newPage: () => Promise.resolve(p),
  }
  let released: string[] = []
  let browsing: Browsing = {
    acquire: () => Promise.resolve('session'),
    connect: () => Promise.resolve(browser),
    release: (id) => {
      closed = true
      released.push(id)
      return Promise.resolve()
    },
    axe: { source: '', version: 'test' },
  }
  return {
    p,
    browser,
    browsing,
    hear,
    viewport: () => viewport,
    opened: () => opened,
    closed: () => closed,
    released,
    log,
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
    { url: 'https://private.invalid/', view },
  )
  assertEquals(p.viewport(), { width: 390, height: 844 })
  assertEquals(result.image, 'png-bytes')
  assertEquals((result.accessibility as Audit).problems[0].rule, 'image-alt')
  assertEquals(result.console, [{ type: 'log', text: 'page ready' }])
  assertStringIncludes(result.errors[0], 'page exception')
  assertEquals(result.status, 200)
  assertEquals(p.closed(), true)
})

test('a page opens with the cookies it was sent and answers its visible text', async () => {
  let p = page()
  let signIn: Cookie = {
    name: 'yak_session',
    value: 'sealed',
    domain: 'town.yaks.app',
    path: '/',
    secure: true,
    httpOnly: true,
  }
  let result = await capture(p.browsing, {
    url: 'https://town.yaks.app/',
    view,
    cookies: [signIn],
  })
  assertEquals(p.opened(), [signIn])
  assertEquals(result.text, 'Meetings\nAgenda')
})

test('a visit takes its steps in order on a phone, and keeps each named screenshot', async () => {
  let p = page()
  let result = await capture(p.browsing, {
    url: 'https://checks.yaks.app/',
    view: { ...view, touch: true },
    steps: [
      { tap: 'textarea' },
      { keyboard: 336 },
      { clear: 'textarea' },
      { type: 'hello', into: 'textarea' },
      { shot: 'typed' },
      { press: 'Enter' },
      { swipe: [10, 400, 300, 400] },
      { keyboard: 0 },
    ],
  })
  assertEquals(p.log.filter((l) => !l.startsWith('move')), [
    'view 390x844 touch',
    'find textarea',
    'tap textarea',
    'view 390x508 touch',
    'find textarea',
    'focus textarea',
    'down Control',
    'press a',
    'up Control',
    'press Backspace',
    'find textarea',
    'type hello into textarea',
    'press Enter',
    'touch 10,400',
    'lift',
    'view 390x844 touch',
  ])
  assertEquals(p.log.filter((l) => l.startsWith('move')).at(-1), 'move 300,400')
  assertEquals(result.shots, [{ name: 'typed', image: 'png-bytes' }])
  assertEquals(result.accessibility != null, true)
  assertEquals(result.image, 'png-2')
})

test('a visit that asks for no audit reads its text and runs no check', async () => {
  let p = page()
  let result = await capture(p.browsing, {
    url: 'https://checks.yaks.app/',
    view,
    audit: false,
  })
  assertEquals(result.accessibility, undefined)
  assertEquals(result.text, 'Meetings\nAgenda')
})

test("a step that fails ends the steps, is the visit's error, and the page is still pictured", async () => {
  let p = page({ missing: '#send' })
  let result = await capture(p.browsing, {
    url: 'https://checks.yaks.app/',
    view,
    steps: [{ tap: '#send' }, { press: 'Enter' }],
  })
  assertEquals(p.log.includes('press Enter'), false)
  assertStringIncludes(result.errors.at(-1)!, 'step 1 {"tap":"#send"}')
  assertStringIncludes(result.errors.at(-1)!, 'Waiting for selector')
  assertEquals(result.image, 'png-bytes')
})

test('a dialog a step opens is dismissed and listed, and the steps go on', async () => {
  let p = page({ confirm: '#delete' })
  let result = await capture(p.browsing, {
    url: 'https://checks.yaks.app/',
    view: { ...view, touch: true },
    steps: [{ tap: '#delete' }, { press: 'Enter' }],
  })
  assertEquals(p.log.slice(-3), ['find #delete', 'dismiss', 'press Enter'])
  assertEquals(result.dialogs, [{ type: 'confirm', message: 'Delete it?' }])
})

test('a desktop visit keeps driving its original tab after a link opens another', async () => {
  let p = page()
  let find = p.p.waitForSelector
  let foreground = true
  let moved = false
  let pressed = false
  let clicks: string[] = []
  let selector = ''
  p.p.bringToFront = () =>
    Promise.resolve().then(() => {
      foreground = true
    })
  p.p.waitForSelector = async (s, options) => {
    let el = (await find(s, options))!
    return {
      ...el,
      hover: () =>
        Promise.resolve().then(() => {
          if (!foreground) throw new Error('viewport observer stalled')
          selector = s
          moved = true
        }),
    }
  }
  p.p.mouse.down = () => {
    if (!moved) throw new Error('mouse still moving')
    return Promise.resolve().then(() => {
      pressed = true
    })
  }
  p.p.mouse.up = () => {
    if (!pressed) throw new Error('mouse still pressing')
    clicks.push(selector)
    foreground = selector != '#new-tab'
    moved = pressed = false
    return Promise.resolve()
  }
  await capture(p.browsing, {
    url: 'https://checks.yaks.app/',
    view,
    steps: [{ tap: '#new-tab' }, { tap: '#original' }],
  })
  assertEquals(clicks, ['#new-tab', '#original'])
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
    { url: 'https://private.invalid/', view },
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
    render(bound(p.browsing), { url: 'https://x.invalid/', view })
  )
  assertEquals(result.image, 'png-bytes')
  assertEquals(result.console, [{ type: 'log', text: 'page ready' }])
  assertStringIncludes(result.errors[0], 'page exception')
  assertStringIncludes(report(result.accessibility), 'RangeError: axe gave up')
  assertStringIncludes(reports, 'axe gave up')
  assertEquals(p.closed(), true)
})

// Puppeteer allocates the stack before Chrome answers, then updates the message.
let protocol = (detail: string, originalMessage = detail) =>
  Object.assign(new Error(`Protocol error (Runtime.evaluate): ${detail}`), {
    stack: 'Error: ProtocolError\n    at CallbackRegistry.create',
    originalMessage,
  })

for (
  let [error, interrupted, explanation] of [
    [protocol('Target closed', ''), 'target', 'browser closed or detached'],
    [
      protocol('Session with given id not found.'),
      'target',
      'browser closed or detached',
    ],
    [
      protocol('Execution context was destroyed.'),
      'document',
      'page navigated or closed',
    ],
  ] as const
) {
  test(`an interrupted audit keeps the screenshot when ${error.message}`, async () => {
    let p = page()
    let cdp = await p.p.createCDPSession()
    let send = cdp.send
    cdp.send = (method, params) =>
      method == 'Runtime.evaluate' &&
        String(params?.expression).includes('axe.run(document')
        ? Promise.reject(error)
        : send(method, params)
    let { result, reports } = await reported(() =>
      render(bound(p.browsing), { url: 'https://x.invalid/', view })
    )
    assertEquals(result.image, 'png-bytes')
    assertEquals(result.text, '')
    assertEquals(result.accessibility, { interrupted })
    assertStringIncludes(
      report(result.accessibility).toLowerCase(),
      explanation,
    )
    assertEquals(reports, '[]')
    assertEquals(p.closed(), true)
  })
}

test('an unexpected protocol error reaches the tracker with the browser reply', async () => {
  let p = page()
  let cdp = await p.p.createCDPSession()
  let send = cdp.send
  cdp.send = (method, params) =>
    method == 'Runtime.evaluate'
      ? Promise.reject(protocol('Internal error'))
      : send(method, params)
  let { result, reports } = await reported(() =>
    render(bound(p.browsing), { url: 'https://x.invalid/', view })
  )
  assertEquals(result.image, 'png-bytes')
  assertStringIncludes(
    reports,
    'Protocol error (Runtime.evaluate): Internal error',
  )
})

test('a check that passes reports nothing', async () => {
  let { result, reports } = await reported(() =>
    render(bound(page().browsing), { url: 'https://x.invalid/', view })
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
    { url: 'https://x.invalid/', view },
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
    { url: 'https://x.invalid/', view },
    undefined,
    time,
  )
  await time.advance(CHECK)
  let result = await running
  assertEquals(result.image, 'png-bytes')
  assertStringIncludes(
    report(result.accessibility!),
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
  let running = capture(
    p.browsing,
    { url: 'https://x.invalid/', view },
    undefined,
    time,
  )
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
    render(bound(p.browsing), { url: 'https://x.invalid/', view }, undefined, {
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
    { url: 'https://private.invalid/', view },
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
  p.browsing.release = async () => {
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
      render(
        bound(browsing, time),
        { url: 'https://private.invalid/', view },
        (ms) => {
          duration = ms
          return Promise.resolve()
        },
      ),
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

let unavailable = (code: number) =>
  new Error(
    `Unable to create new browser: code: ${code}: message: No browser available`,
  )

for (let code of [500, 503]) {
  test(`browser acquisition recovers from a temporary ${code}`, async () => {
    let p = page()
    let time = clock()
    let attempts = 0
    p.browsing.acquire = () =>
      ++attempts < 3
        ? Promise.reject(unavailable(code))
        : Promise.resolve('session')
    let rendering = capture(
      p.browsing,
      { url: 'https://x.invalid/', view },
      undefined,
      time,
    )
    rendering.catch(() => {})
    for (let pause of [1000, 2000, 4000]) await time.advance(pause)
    assertEquals((await rendering).image, 'png-bytes')
    assertEquals(attempts, 3)
    assertEquals(p.closed(), true)
    assertEquals(time.pending(), 0)
  })
}

for (let [code, expected] of [[503, 4], [400, 1], [429, 1]]) {
  test(`browser acquisition ${code} fails after ${expected} attempts`, async () => {
    let p = page()
    let time = clock()
    let attempts = 0
    p.browsing.acquire = () => {
      attempts++
      return Promise.reject(unavailable(code))
    }
    let rendering = capture(
      p.browsing,
      { url: 'https://x.invalid/', view },
      undefined,
      time,
    )
    let failed = assertRejects(() => rendering, Error, `code: ${code}`)
    for (let pause of [1000, 2000, 4000]) await time.advance(pause)
    await failed
    assertEquals(attempts, expected)
    assertEquals(time.pending(), 0)
  })
}

test('a session not ready yet is connected to again', async () => {
  let { p, browsing, sessions } = flaky(2)
  let time = clock()
  let rendering = capture(
    browsing,
    { url: 'https://x.invalid/', view },
    undefined,
    time,
  )
  await paused(time)
  assertEquals((await rendering).image, 'png-bytes')
  assertEquals(sessions, ['session 0', 'session 0', 'session 0'])
  assertEquals(p.closed(), true)
})

test('a session that never takes a connection fails the preview', async () => {
  let { browsing, sessions, p } = flaky(Infinity)
  let time = clock()
  let rendering = capture(
    browsing,
    { url: 'https://x.invalid/', view },
    undefined,
    time,
  )
  rendering.catch(() => {})
  await paused(time)
  await assertRejects(() => rendering, Error, "reading 'accept' of null")
  assertEquals(sessions.length, 4)
  assertEquals(p.released, ['session 0'])
})

test('an acquisition that answers after the timeout releases its session without connecting', async () => {
  let p = page()
  let time = clock()
  let held: Promise<void>[] = []
  let connects = 0
  p.browsing.acquire = () =>
    new Promise((resolve) => time.after(OPEN + 100, () => resolve('late')))
  p.browsing.connect = () => {
    connects++
    return Promise.resolve(p.browser)
  }
  let running = capture(
    p.browsing,
    { url: 'https://x.invalid/', view },
    undefined,
    time,
    {
      hold: (work) => held.push(work),
    },
  )
  let failed = assertRejects(
    () => running,
    Error,
    'Acquiring a browser session timed out',
  )
  await time.advance(OPEN)
  await failed
  await time.advance(100)
  await Promise.all(held)
  assertEquals([connects, p.released, time.pending()], [0, ['late'], 0])
})

test('a stalled connection releases by session ID even when release stalls', async () => {
  let p = page()
  let time = clock()
  let released: string[] = []
  let errors: string[] = []
  let signal: AbortSignal | undefined
  let releaseStarted = Promise.withResolvers<void>()
  p.browsing.connect = (_, stop) => {
    signal = stop
    return new Promise(() => {})
  }
  p.browsing.release = (id) => {
    released.push(id)
    releaseStarted.resolve()
    return new Promise(() => {})
  }
  let running = capture(
    p.browsing,
    { url: 'https://x.invalid/', view },
    undefined,
    time,
    {
      report: (error) => errors.push((error as Error).message),
    },
  )
  let failed = assertRejects(
    () => running,
    Error,
    'Connecting to the browser session timed out',
  )
  await time.advance(CONNECT)
  await releaseStarted.promise
  assertEquals(signal?.aborted, true)
  assertEquals(released, ['session'])
  await time.advance(RELEASE)
  await failed
  assertStringIncludes(errors[0], 'Releasing the browser session timed out')
  assertEquals(time.pending(), 0)
})

test('a lost screenshot session is released and the read-only visit starts on a fresh one', async () => {
  let first = page({
    screenshot: Object.assign(
      new Error(
        'Protocol error (Page.bringToFront): Session closed. Most likely the page has been closed.',
      ),
      { originalMessage: '' },
    ),
  })
  let second = page()
  let next = 0
  let released: string[] = []
  let faults: string[] = []
  let browsing: Browsing = {
    ...first.browsing,
    acquire: () => Promise.resolve(String(++next)),
    connect: (id) =>
      Promise.resolve(id == '1' ? first.browser : second.browser),
    release: (id) => {
      released.push(id)
      return Promise.resolve()
    },
  }
  let result = await capture(
    browsing,
    { url: 'https://x.invalid/', view },
    undefined,
    clock(),
    {
      report: (error) => faults.push((error as Error).message),
    },
  )
  assertEquals(result.image, 'png-bytes')
  assertEquals(released, ['1', '2'])
  assertEquals(faults, [
    'The browser session closed while taking the final screenshot',
  ])

  next = 0
  released.length = 0
  await assertRejects(
    () =>
      capture(
        browsing,
        { url: 'https://x.invalid/', view, steps: [{ press: 'Enter' }] },
      ),
    Error,
    'The browser session closed while taking the final screenshot',
  )
  assertEquals(released, ['1'])
  assertEquals(first.log.filter((line) => line == 'press Enter'), [
    'press Enter',
  ])
})

test('a long visit stops at its deadline without taking the remaining steps', async () => {
  let p = page()
  let time = clock()
  let running = capture(
    p.browsing,
    {
      url: 'https://x.invalid/',
      view,
      steps: [{ wait: 60_000 }, { press: 'Enter' }],
    },
    undefined,
    time,
  )
  let failed = assertRejects(
    () => running,
    Error,
    'Step 1 asks to wait 60000 ms',
  )
  await failed
  assertEquals(p.log.filter((line) => line == 'press Enter'), [])
  assertEquals(p.released, ['session'])
  assertEquals(time.pending(), 0)
})

test('a named screenshot that stalls reports the failed operation', async () => {
  let p = page()
  let time = clock()
  p.p.screenshot = () => new Promise(() => {})
  let running = capture(
    p.browsing,
    {
      url: 'https://x.invalid/',
      view,
      steps: [{ shot: 'opened' }],
      audit: false,
    },
    undefined,
    time,
  )
  let failed = assertRejects(
    () => running,
    Error,
    'taking step 1 (taking a screenshot) timed out',
  )
  await time.advance(MOST)
  await failed
  assertEquals(p.released, ['session'])
})

test('the visit deadline while waiting for step 7 names the missing element', async () => {
  let p = page()
  let time = clock()
  let waiting: AbortSignal | undefined
  p.p.setViewport = () => time.advance(MOST - 1_000)
  p.p.waitForSelector = (_, options) => {
    waiting = options.signal
    return time.advance(options.timeout).then(() => null)
  }
  let response = await answer(p.browsing, time)(
    new Request('https://x.invalid/', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://x.invalid/',
        view,
        audit: false,
        steps: [
          ...Array.from({ length: 6 }, () => ({ shot: 'before' })),
          { tap: '[data-not-now]' },
          { press: 'Enter' },
        ],
      }),
    }),
  )
  assertEquals(response.status, 400)
  let body = await response.json()
  assertEquals(body.refusal, 'browser_wait_expired')
  assertEquals(
    body.failed,
    'Step 7 waited for a visible element matching [data-not-now].',
  )
  assertEquals(body.faults, undefined)
  assertEquals(p.log.includes('press Enter'), false)
  assertEquals(p.released, ['session'])
  assertEquals(waiting?.aborted, true)
})

test('the kernel bounds even a browser binding that never replies', async () => {
  let time = clock()
  let signal: AbortSignal | undefined
  let charged = 0
  let BROWSER = {
    fetch: (req: Request): Promise<Response> => {
      signal = req.signal
      return new Promise(() => {})
    },
  }
  let running = seen({ BROWSER, CLOCK: time }, {
    url: 'https://x.invalid/',
    view,
    audit: false,
  }, (ms) => {
    charged = ms
    return Promise.resolve()
  })
  let failed = assertRejects(
    () => running,
    Error,
    'Waiting for the browser service to answer timed out',
  )
  await time.advance(BROWSE_REPLY)
  await failed
  assertEquals([signal?.aborted, charged, time.pending()], [
    true,
    BROWSE_REPLY,
    0,
  ])
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
      render(
        { BROWSER, CLOCK: time },
        { url: 'https://x.invalid/', view },
        (ms) => {
          duration = ms
          return Promise.resolve()
        },
      ),
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
    { url: 'https://private.invalid/', view },
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
    { url: 'https://private.invalid/', view },
    (ms) => {
      used = ms
      return Promise.resolve()
    },
    time,
  )
  let failed = assertRejects(
    () => running,
    Error,
    'taking the final screenshot timed out',
  )
  await time.advance(15_000)
  await failed
  assertEquals(p.closed(), true)
  assertEquals(used, 15_000)
  assertEquals(time.pending(), 0)
})
