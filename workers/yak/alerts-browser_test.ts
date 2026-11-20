import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { renderToString as render } from 'preact-render-to-string'
import { CallError } from '@yaks/tools/errors'
import { LONG_WORK, offer, persist } from './alerts-browser.ts'
import { alertsOffer } from './operator-page.ts'

// The browser's push service refusing a subscription for a while (bug
// a0001c73): the page tries again later and says so once.
let refused = () =>
  new DOMException('Registration failed - push service error', 'AbortError')

let run = (answers: (string | Error)[]) => {
  let slept: number[] = []
  let said = 0
  let attempt = () => {
    let answer = answers.shift()!
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer)
  }
  let done = persist(attempt, {
    waits: [1, 2, 3],
    sleep: (ms) => Promise.resolve(void slept.push(ms)),
    waiting: () => said++,
  })
  return { done, slept, said: () => said }
}

test('persist tries again while the push service refuses, saying so once', async () => {
  let r = run([refused(), refused(), 'sub'])
  assertEquals(await r.done, 'sub')
  assertEquals(r.slept, [1, 2])
  assertEquals(r.said(), 1)
})

test('persist answers at once when the push service takes it', async () => {
  let r = run(['sub'])
  assertEquals(await r.done, 'sub')
  assertEquals([r.slept, r.said()], [[], 0])
})

test('persist gives up with a refusal the person reads', async () => {
  let r = run([refused(), refused(), refused(), refused()])
  await assertRejects(() => r.done, CallError, 'not answering')
  assertEquals(r.slept, [1, 2, 3])
})

test('persist passes any other failure through untried', async () => {
  let r = run([new DOMException('bad key', 'InvalidAccessError')])
  await assertRejects(() => r.done, DOMException, 'bad key')
  assertEquals(r.slept, [])
})

// The offer in the conversation, on a linkedom page, with a browser that can
// be allowed and has not been: hidden until the Operator starts long work,
// and Not now kept on the person, saying where alerts are turned on. The
// browser's globals are put back after each.
let onPage = (name: string, check: (page: Page) => Promise<void>) =>
  test(name, async () => {
    let had = { fetch: globalThis.fetch }
    let posted: string[] = []
    let { document, Event } = parseHTML(
      `<main>${
        render(alertsOffer('/manage/ana/operator', 'key', false, 0)!)
      }</main>`,
    )
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: () => Promise.resolve(undefined) },
      configurable: true,
    })
    Object.assign(globalThis, {
      PushManager: class {},
      Notification: { permission: 'default' },
      matchMedia: () => ({ matches: false }),
      fetch: (at: string, init?: RequestInit) => {
        posted.push(`${at} ${init?.body}`)
        return Promise.resolve(Response.json({}))
      },
    })
    try {
      await check({
        document: document as unknown as Document,
        // As the chat says it (operator-page.ts `lengthy`).
        long: () => {
          document.querySelector('[data-alerts-offer]')!
            .setAttribute('data-due', '')
          document.dispatchEvent(new Event(LONG_WORK))
        },
        posted,
        shown: (name) =>
          !document.querySelector<HTMLElement>(`[data-shows=${name}]`)!.hidden,
        done: offer(document as unknown as Document),
      })
    } finally {
      Object.assign(globalThis, had)
      for (let name of ['PushManager', 'Notification', 'matchMedia']) {
        delete (globalThis as Record<string, unknown>)[name]
      }
      delete (navigator as { serviceWorker?: unknown }).serviceWorker
    }
  })
type Page = {
  document: Document
  long: () => void
  posted: string[]
  shown: (name: string) => boolean
  done: Promise<void>
}
let settle = () => new Promise((r) => setTimeout(r))

onPage('the offer asks only once the Operator starts long work', async (p) => {
  await settle()
  assertEquals(p.shown('offer'), false)
  p.long()
  await p.done
  assertEquals(p.shown('offer'), true)
})

onPage(
  'Not now is kept on the person and says where alerts are turned on',
  async (p) => {
    p.long()
    await p.done
    p.document.querySelector<HTMLElement>('[data-not-now]')!.click()
    await settle()
    assertEquals(p.posted, ['/manage/ana/operator?alerts=1 declined=1'])
    assertEquals([p.shown('offer'), p.shown('away')], [false, true])
    assertStringIncludes(
      p.document.querySelector('[data-shows=away]')!.textContent!,
      'turn alerts on anytime in Settings',
    )
  },
)
