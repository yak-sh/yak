/// <reference types="chrome" />
// What each need asks of the tab, in the browser (./answer.ts `Need`): the
// page read, a screenshot, its controls, a step on one, a navigation. Each
// decision is a pure module's (./act.ts, ./answer.ts); this file only reaches
// the browser, and the person, through the popup.

import type { Answered, Need, Seen } from './answer.ts'
import { confirms, doing, named } from './act.ts'
import { allowed, NONE, site } from './consent.ts'
import { read } from './read.ts'
import { type Touch, touch, type Touched } from './touch.ts'
import type { Control } from './touch.ts'
import type { Call } from './wire.ts'
import { keep, stored, until } from './chrome.ts'

/** The tab a call is answered from. */
export type Tab = { id: number; windowId: number; url: string }

type Give = (call: Call['call'], tab: Tab, by: number) => Promise<Partial<Seen>>

// How long a step waits for the page it started to load, in milliseconds.
let LOAD = 10_000

let wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

/** Bring the popup forward to ask the person something. Chrome opens it only
 * in a focused window; otherwise the badge asks. */
export let pop = (): Promise<void> => chrome.action.openPopup().catch(() => {})

let touched = async (tab: Tab, t: Touch): Promise<Touched> =>
  (await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: touch,
    args: [t],
  }))[0]?.result ?? { controls: [] }

// Where a tab is once what a step started has loaded, and whether the person
// allowed its site.
let settled = async (id: number): Promise<Seen['now']> => {
  await wait(300)
  let end = Date.now() + LOAD
  let t = await chrome.tabs.get(id)
  while (t.status == 'loading' && Date.now() < end) {
    await wait(200)
    t = await chrome.tabs.get(id)
  }
  let { consent = NONE } = await stored()
  let on = site(t.url ?? '')
  return {
    url: t.url ?? '',
    title: t.title,
    allowed: !!on && allowed(on)(consent),
  }
}

/** The person's answer to a step that waits for their Do it, until `by`:
 * nothing when they pressed it, or the step needs none. */
let confirmed = async (
  call: Call['call'],
  control: Control | undefined,
  tab: Tab,
  by: number,
): Promise<Answered | undefined> => {
  if (!confirms(call, control)) return undefined
  let id = call.id
  await keep({
    confirm: {
      id,
      site: site(tab.url) ?? tab.url,
      doing: doing(call, control),
    },
  })
  pop()
  let yes = await until(
    (s) => s.confirm?.id == id ? s.confirm.yes : undefined,
    by - Date.now(),
  )
  if ((await stored()).confirm?.id == id) await keep({ confirm: undefined })
  return yes ? undefined : yes == false ? 'no' : 'none'
}

export let GIVE: Record<Need, Give> = {
  page: async (_, tab) => ({
    page: (await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: read,
    }))[0]?.result,
  }),
  shot: async (_, tab) => ({
    shot: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }),
  }),
  list: async (_, tab) => {
    let { controls, error } = await touched(tab, { op: 'list' })
    return { controls, more: error }
  },
  act: async (call, tab, by) => {
    let ref = String(call.args.ref ?? '')
    let [control] = (await touched(tab, { op: 'find', ref })).controls
    if (!control || !named(call.args.name, control)) {
      return { controls: control ? [control] : [] }
    }
    let answered = await confirmed(call, control, tab, by)
    if (answered) return { controls: [control], answered }
    let done = await touched(tab, {
      op: call.tool == 'browser_click' ? 'click' : 'type',
      ref,
      name: control.name,
      text: String(call.args.text ?? ''),
      enter: call.args.enter === true,
    })
    return done.error
      ? { controls: [control], failed: done.error }
      : { controls: [control], now: await settled(tab.id) }
  },
  go: async (call, tab, by) => {
    let answered = await confirmed(call, undefined, tab, by)
    if (answered) return { answered }
    let url = String(call.args.url)
    let opened = call.args.new_tab === true
      ? await chrome.tabs.create({ url, active: true })
      : await chrome.tabs.update(tab.id, { url })
    return { now: await settled(opened?.id ?? tab.id) }
  },
}
