// What the browser answers a call, decided from what the tab gave. The glue
// asks the tab for what a tool `needs` (the page read, a screenshot), and only
// on a site the person allowed; `answering` turns that into the answer frame's
// fields. Every word from the page reaches the model fenced, as the page's.

import type { Page } from './read.ts'
import type { Answer, Call, Shot } from './wire.ts'
import { host, site } from './consent.ts'

/** What the tab gave for one call: its address and title, whether the person
 * allowed its site, and what the tool needed, or why that failed. */
export type Seen = {
  url: string
  title?: string
  allowed: boolean
  page?: Page
  /** A screenshot, as the `data:` URL the browser captures. */
  shot?: string
  failed?: string
}

/** What a tool needs from the tab beyond its address and title. */
export type Need = 'page' | 'shot'

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

// Each tool: what it needs, and what it says once it has it.
let TOLD: Record<string, { needs?: Need; says: (s: Seen) => Fields }> = {
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
}

/// needs('browser_text') -> 'page'
/// needs('browser_page') -> undefined
/** What a tool needs the tab to give, if anything. */
export let needs = (tool: string): Need | undefined => TOLD[tool]?.needs

// Why a call can't be answered, before anything is asked of the tab.
let refusal = (tool: string, s: Seen): string | undefined => {
  let on = site(s.url)
  let need = needs(tool)
  return !TOLD[tool]
    ? `This browser has no tool called ${tool}.`
    : !on
    ? `The person's tab (${
      s.url || 'no address'
    }) is not a web page, so the browser can't read it.`
    : !s.allowed
    ? `The person has not allowed you to read ${
      host(on)
    } yet. The extension is asking them now; try again once they allow it.`
    : s.failed
    ? `The browser could not read ${s.url}: ${s.failed}`
    : need && !s[need]
    ? `The browser gave nothing for ${tool}.`
    : undefined
}

/** The answer to a call, from what the tab gave. */
export let answering = (call: Call['call'], seen: Seen): Answer => {
  let refused = refusal(call.tool, seen)
  return {
    answer: {
      id: call.id,
      ...(refused ? { error: refused } : TOLD[call.tool].says(seen)),
    },
  }
}

/** Whether a call waits on the person's consent for the tab's site: the glue
 * raises its badge and keeps the question for the popup. */
export let asks = (call: Call['call'], seen: Seen): string | null => {
  let on = site(seen.url)
  return TOLD[call.tool] && on && !seen.allowed ? on : null
}
