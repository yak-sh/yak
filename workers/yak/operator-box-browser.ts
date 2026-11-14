// The Operator chat page's message box in the browser, mounted over what the
// server drew (operator-box.ts `Ask`), as part of `_talk.js`
// (operator-rows.ts). Only page code imports it, as operator-talk-browser.ts
// says why.
import { h, render } from 'preact'
import { type Filed, PICTURES } from './operator-draw.ts'
import { Ask, type AskProps, type Held, reads, UNREAD } from './operator-box.ts'

// The files an input holds, as the box draws them: a picture by a source of
// its own, which the page lets go once it is drawn no more.
let held = (input: HTMLInputElement, kinds: string[]): Filed[] =>
  [...input.files ?? []].map((f) => ({
    name: f.name,
    mime: f.type,
    size: f.size,
    ...PICTURES.includes(f.type) ? { src: URL.createObjectURL(f) } : {},
    ...reads(kinds, f) ? {} : { note: UNREAD },
  }))

/** What the page does to its box. */
export type Asked = ReturnType<typeof mountAsk>

/**
 * The box mounted over what the server drew in `root`, its words the
 * person's drafts at `place`. What the page holds of it changes by `set`;
 * `focus` puts the caret in it, at the end of what it holds when asked.
 */
export let mountAsk = (
  { root, ...given }: Omit<AskProps, keyof Held> & { root: Element },
) => {
  let now: Held = {}
  let draw = () => render(h(Ask, { ...given, ...now }), root)
  draw()
  let field = () => root.querySelector('textarea')
  let input = root.querySelector<HTMLInputElement>('input[type=file]')
  input?.addEventListener('change', () => {
    for (let f of now.files ?? []) if (f.src) URL.revokeObjectURL(f.src)
    now = { ...now, files: held(input, given.asking.reads) }
    draw()
  })
  return {
    set: (change: Held) => {
      now = { ...now, ...change }
      draw()
    },
    /** what it says under itself */
    said: () => now.said ?? '',
    focus: (end = false) => {
      draw()
      let f = field()
      f?.focus()
      if (end && f) f.setSelectionRange(f.value.length, f.value.length)
    },
  }
}
