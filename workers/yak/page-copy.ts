// An app's copy filled into its pages as they are served (@yaks/copy): each
// element naming a snippet of the release's copy.json shows that snippet, so
// what a browser, a crawler and Site's kept copy of a page read is the copy as
// released. The file itself is served like any other, so a script that draws
// text reads it and marks what it draws.
//
// A page is filled as it streams. An element whose snippet has no slots gets
// the snippet as its content; one with slots keeps the children that fill
// them, in the snippet's order, with the snippet's text placed around them,
// and loses the rest of what it held. A slot whose child is missing, or whose
// child a later slot's came before, shows as its `%{name}`, as `fill` shows a
// slot it was given nothing for. A key the file lacks leaves the element as written: what
// the copy says is the app's input, not a failure.
import { type Copy, fill, marks, parse, read, slots } from '@yaks/copy'
import type { Env } from './env.ts'
import { fileBytes, ofRelease } from './files.ts'

export type { Copy }

// The runtime's streaming HTML rewriter, the slice this file asks for, so
// `deno check` reads the Worker without @cloudflare/workers-types (env.ts).
type End = { before(s: string): void }
type Element = {
  attributes: Iterable<[string, string]>
  setAttribute(name: string, value: string): void
  setInnerContent(s: string): void
  before(s: string): void
  remove(): void
  onEndTag(fn: (end: End) => void): void
}
type Rewriter = {
  on(selector: string, handlers: { element(el: Element): void }): Rewriter
  onDocument(handlers: { text(text: { remove(): void }): void }): Rewriter
  transform(res: Response): Response
}
declare let HTMLRewriter: { new (): Rewriter }

/** The name an app keeps its copy under, at the root of what it serves. */
export let COPY = 'copy.json'

let read$ = new Map<string, Promise<Copy | null>>()

/**
 * The copy of the files at `prefix` (a release, or a draft's state), or null
 * when they hold none to fill: no copy.json, an empty one, or one that is not
 * a file of snippets, which serves its pages as written.
 */
export let appCopy = (
  env: Env,
  eid: string,
  prefix: string,
  source: string,
): Promise<Copy | null> =>
  ofRelease(read$, prefix, async () => {
    let got = await fileBytes(env, eid, prefix, `/${COPY}`, source)
    if (got.status == 404) {
      await got.body?.cancel()
      return null
    }
    if (!got.ok) {
      await got.body?.cancel()
      throw new Error(`${COPY} answered ${got.status}`)
    }
    try {
      let copy = parse(await got.text())
      return Object.keys(copy).length ? copy : null
    } catch {
      return null
    }
  })

// A snippet with no slots to fill, as text: `%%{x}` reads `%{x}`.
let said = (value: string) => fill(value).join('')

// An element filling a snippet with slots: its parts in order, how far its
// children have placed them, and how deep inside it the parser stands.
type Slot = { slot: string }
type Frame = { parts: Array<string | Slot>; at: number; depth: number }

let shown = (parts: Array<string | Slot>) =>
  parts.map((p) => typeof p == 'string' ? p : `%{${p.slot}}`).join('')

// A child filling slot `name`: the snippet's text up to it goes before it.
// One whose slot is not ahead in the snippet has no place in it.
let place = (frame: Frame, name: string, el: Element) => {
  let next = frame.parts.findIndex((p, i) =>
    i >= frame.at && typeof p != 'string' && p.slot == name
  )
  if (next < 0) return el.remove()
  let text = shown(frame.parts.slice(frame.at, next))
  if (text) el.before(text)
  frame.at = next + 1
}

/** `page` with each element `copy` names a snippet for showing it. */
export let filled = (page: Response, copy: Copy | null): Response => {
  if (!copy) return page
  let frames: Frame[] = []
  return new HTMLRewriter()
    .on('*', {
      element: (el) => {
        let outer = frames.at(-1)
        let own: Frame | undefined
        // A void element has no end tag, and no content to fill.
        let ends = true
        try {
          el.onEndTag((end) => {
            if (own) {
              let rest = shown(own.parts.slice(own.at))
              if (rest) end.before(rest)
              frames.pop()
            }
            if (outer) outer.depth--
          })
        } catch {
          ends = false
        }
        let m = marks(Object.fromEntries(el.attributes))
        if (outer?.depth == 0) {
          if (m.slot == null) el.remove()
          else place(outer, m.slot, el)
        }
        if (outer && ends) outer.depth++
        for (let [name, key] of Object.entries(m.attrs)) {
          let value = read(copy, key)
          if (value != null) el.setAttribute(name, said(value))
        }
        if (!ends) return
        let value = m.text == null ? undefined : read(copy, m.text)
        if (value == null) return
        let named = slots(value)
        if (!named.length) return el.setInnerContent(said(value))
        let marked = Object.fromEntries(named.map((slot) => [slot, { slot }]))
        own = { parts: fill(value, marked), at: 0, depth: 0 }
        frames.push(own)
      },
    })
    .onDocument({
      text: (text) => {
        if (frames.at(-1)?.depth == 0) text.remove()
      },
    })
    .transform(page)
}
