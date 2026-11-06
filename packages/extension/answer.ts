// What the browser answers a call, decided from what the tab gave. The glue
// asks the tab for what a tool `needs` (the page read, a screenshot, its
// controls, a step done), and only on a site the person allowed; `answering`
// turns that into the answer frame's fields. Every word from the page reaches
// the model fenced, as the page's.

import type { Page } from './read.ts'
import type { Control } from './touch.ts'
import type { Answer, Call, Shot } from './wire.ts'
import { host, site } from './consent.ts'
import { aims, doing, named } from './act.ts'

/** How the person answered a question a call waited on, when it was not yes:
 * they said no, or nothing in time. */
export type Answered = 'no' | 'none'

/** What the tab gave for one call: its address and title, whether the person
 * allowed the site the call aims at (./act.ts `aims`), and what the tool
 * needed, or why that failed. */
export type Seen = {
  url: string
  title?: string
  allowed: boolean
  /** The person's answer when asked to allow the site, or to press Do it. */
  answered?: Answered
  page?: Page
  /** A screenshot, as the `data:` URL the browser captures. */
  shot?: string
  /** The controls a listing found, or the one a step acts on. */
  controls?: Control[]
  /** Why a listing is not the whole page. */
  more?: string
  /** Where the tab is after a step, and whether the person allowed its
   * site, without which nothing of it is said. */
  now?: { url: string; title?: string; allowed: boolean }
  failed?: string
}

/// unlent("Either the '<all_urls>' or 'activeTab' permission is required.") -> true
/// unlent('frame gone') -> false
/** Whether a screenshot failed because Chrome wants the person's click: it
 * captures a tab only under `activeTab`, which a click on the extension's
 * button grants for that tab, or under every site's permission, which a
 * site allowed on its own is not (Chromium's `CanCaptureVisiblePage`). */
export let unlent = (failed = ''): boolean => /'activeTab'/.test(failed)

/** What a tool needs from the tab beyond its address and title: the page
 * read, a screenshot, the page's controls, a step on one, or a navigation. */
export type Need = 'page' | 'shot' | 'list' | 'act' | 'go'

type Fields = Omit<Answer['answer'], 'id'>

/// fence('a ``` b') -> '````\na ``` b\n````'
/** Text between backtick fences longer than any run inside it, so nothing the
 * text says can close the fence early. */
export let fence = (text: string): string => {
  let longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length))
  let bar = '`'.repeat(Math.max(3, longest + 1))
  return `${bar}\n${text}\n${bar}`
}

// What precedes the page's words, so the model reads them as content.
let quoted = (what: string, text: string) =>
  `${what}, written by the site, not by the person or by you:\n${fence(text)}`

/// shot('data:image/png;base64,iVBO') -> { mime: 'image/png', base64: 'iVBO' }
/// shot('nonsense') -> undefined
/** The image a `data:` URL holds. */
export let shot = (url: string): Shot | undefined => {
  let m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  return m ? { mime: m[1], base64: m[2] } : undefined
}

let titled = (s: Seen) =>
  quoted("The page's title", s.page?.title ?? s.title ?? '')

/// line({ ref: 'e3', role: 'textbox', name: 'Email', form: true, value: 'a@b.c' }) -> 'e3 textbox "Email" in a form, value "a@b.c"'
/// line({ ref: 'e4', role: 'link', name: 'Home' }) -> 'e4 link "Home"'
/** One control as the agent reads it in a listing. */
export let line = (c: Control): string =>
  [
    `${c.ref} ${c.role} ${JSON.stringify(c.name)}`,
    [
      c.submits ? 'submits a form' : c.form ? 'in a form' : '',
      c.search ? 'a search' : '',
      c.href ? `to ${c.href}` : '',
      c.value != null ? `value ${JSON.stringify(c.value)}` : '',
      c.checked != null ? (c.checked ? 'checked' : 'not checked') : '',
      c.options ? `options ${JSON.stringify(c.options)}` : '',
      c.disabled ? 'disabled' : '',
    ].filter(Boolean).join(', '),
  ].filter(Boolean).join(' ')

// Where a step left the tab: its address and title on a site the person
// allowed, and only the site's name on one they have not.
let after = ({ now }: Seen) =>
  !now
    ? ''
    : now.allowed
    ? `The tab is now at ${now.url}\n${
      quoted("The page's title", now.title ?? '')
    }`
    : site(now.url)
    ? `The tab is now on ${
      host(site(now.url)!)
    }, which the person has not allowed, so nothing of it is read.`
    : `The tab is now at ${now.url}.`

let did = (call: Call['call'], s: Seen) =>
  `Did this on ${s.url}: ${doing(call, s.controls?.[0])}.\n${after(s)}`

// Each tool: what it needs, and what it says once it has it.
let TOLD: Record<
  string,
  { needs?: Need; says: (s: Seen, call: Call['call']) => Fields }
> = {
  browser_page: {
    says: (s) => ({ text: `The person's tab is at ${s.url}\n${titled(s)}` }),
  },
  browser_text: {
    needs: 'page',
    says: (s) => ({
      text: `The text of ${s.url}\n${quoted('The page', s.page?.text ?? '')}`,
    }),
  },
  browser_selection: {
    needs: 'page',
    says: ({ url, page }) => ({
      text: page?.selection
        ? `What the person selected on ${url}\n` +
          quoted('The selection', page.selection)
        : `The person has nothing selected on ${url}.`,
    }),
  },
  browser_screenshot: {
    needs: 'shot',
    says: (s) => {
      let image = shot(s.shot ?? '')
      return image
        ? { text: `A screenshot of the visible part of ${s.url}.`, image }
        : { error: 'The browser gave no image for the screenshot.' }
    },
  },
  browser_elements: {
    needs: 'list',
    says: (s) => ({
      text: s.controls?.length
        ? `The links, buttons and fields on ${s.url}, each after its ref` +
          (s.more ? ` (${s.more})` : '') + '\n' +
          quoted('Their names and values', s.controls.map(line).join('\n'))
        : `${s.url} has no links, buttons or fields to press or type into.`,
    }),
  },
  browser_click: { needs: 'act', says: (s, call) => ({ text: did(call, s) }) },
  browser_type: { needs: 'act', says: (s, call) => ({ text: did(call, s) }) },
  browser_navigate: {
    needs: 'go',
    says: (s) => ({ text: after(s) }),
  },
}

/// needs('browser_text') -> 'page'
/// needs('browser_page') -> undefined
/** What a tool needs the tab to give, if anything. */
export let needs = (tool: string): Need | undefined => TOLD[tool]?.needs

// What each need gives the answer, which an answer can't do without; a step
// on a control says for itself what it lacks.
let GIVES: Record<Need, keyof Seen | undefined> = {
  page: 'page',
  shot: 'shot',
  list: 'controls',
  act: undefined,
  go: 'now',
}

// Why the site a call aims at is not open to it.
let unallowed = (s: Seen, on: string) =>
  s.answered == 'no'
    ? `The person chose not to let you use ${
      host(on)
    }. Ask them in the conversation before trying it again.`
    : s.answered == 'none'
    ? `The person has not answered whether you may use ${
      host(on)
    }. The extension still asks them in its popup; ask them to open it and choose.`
    : `The person has not allowed you to use ${
      host(on)
    } yet. The extension is asking them now; try again once they allow it.`

// Why a step on a control was not done.
let undone = (call: Call['call'], s: Seen): string | undefined => {
  let [c] = s.controls ?? []
  let ref = String(call.args.ref ?? '')
  return !c
    ? `${s.url} has no ${ref} now. List the elements again with browser_elements and use a ref from that.`
    : !named(call.args.name, c)
    ? `${ref} on ${s.url} is not ${
      JSON.stringify(call.args.name ?? '')
    } but the ${c.role} named below. List the elements again with browser_elements and use the ref of what you mean.\n${
      quoted('Its name', c.name)
    }`
    : s.answered == 'no'
    ? `The person pressed Don't, so nothing was done: ${doing(call, c)}.`
    : s.answered == 'none'
    ? `The person did not press Do it in time, so nothing was done: ${
      doing(call, c)
    }. Ask them in the conversation, then try again.`
    : undefined
}

// Why a call can't be answered.
let refusal = (call: Call['call'], s: Seen): string | undefined => {
  let { tool } = call
  let aimed = aims(call, s.url)
  let on = site(aimed)
  let need = needs(tool)
  return !TOLD[tool]
    ? `This browser has no tool called ${tool}.`
    : !on
    ? tool == 'browser_navigate'
      ? `${aimed || 'No address'} is not a web address the browser opens.`
      : `The person's tab (${
        s.url || 'no address'
      }) is not a web page, so the browser can't use it.`
    : !s.allowed
    ? unallowed(s, on)
    : need == 'shot' && unlent(s.failed)
    ? `Chrome lets the extension take a screenshot of a tab only after the person clicks the extension's button in their browser's toolbar while on that tab, and they have not yet. Ask them to click it on ${
      host(on)
    }, then try again; it then works on that site in that tab until the tab leaves it. browser_text reads the page without it.`
    : need == 'act' && undone(call, s)
    ? undone(call, s)
    : tool == 'browser_navigate' && s.answered
    ? `The person ${
      s.answered == 'no' ? "pressed Don't" : 'did not press Do it in time'
    }, so the tab did not go to ${aimed}.`
    : s.failed
    ? `The browser could not do ${tool} on ${s.url}: ${s.failed}`
    : need && GIVES[need] && !s[GIVES[need]!]
    ? `The browser gave nothing for ${tool}.`
    : undefined
}

/** The answer to a call, from what the tab gave. */
export let answering = (call: Call['call'], seen: Seen): Answer => {
  let refused = refusal(call, seen)
  return {
    answer: {
      id: call.id,
      ...(refused ? { error: refused } : TOLD[call.tool].says(seen, call)),
    },
  }
}

/** Whether a call waits on the person's consent for the site it aims at: the
 * glue keeps the question for the popup, and waits for their answer. */
export let asks = (call: Call['call'], seen: Seen): string | null => {
  let on = site(aims(call, seen.url))
  return TOLD[call.tool] && on && !seen.allowed && !seen.answered ? on : null
}

/** Whether a screenshot waits on the person's click on the extension's
 * button, on the site it names: the glue keeps it for the popup, and takes it
 * again once the popup opens. */
export let lends = (call: Call['call'], seen: Seen): string | null => {
  let on = site(seen.url)
  return needs(call.tool) == 'shot' && on && unlent(seen.failed) ? on : null
}
