// The Operator chat page's message box in the browser, mounted over what the
// server drew (operator-box.ts `Ask`), as part of `_talk.js`
// (operator-rows.ts). Only page code imports it, as operator-talk-browser.ts
// says why.
import { h, render } from 'preact'
import { type Filed, PICTURES } from '@yaks/session/conversation'
import {
  Ask,
  type AskProps,
  type Held,
  reads,
  UNREAD,
  within,
} from './operator-box.ts'

/** What the page does to its box. */
export type Asked = ReturnType<typeof mountAsk>

/**
 * The box mounted over what the server drew in `root`, its words the
 * person's drafts at `place`. What the page holds of it changes by `set`;
 * `hold` says which files it holds to send (none, once they are sent);
 * `focus` puts the caret in it, at the end of what it holds when asked.
 */
export let mountAsk = (
  { root, ...given }: Omit<AskProps, keyof Held | 'onFiles' | 'onRemove'> & {
    root: Element
  },
) => {
  let now: Held = {}
  let input = root.querySelector<HTMLInputElement>('input[type=file]')
  // The files held, in the form's input so they go with its words, and a
  // picture's source of its own, let go once it is held no more.
  let holding: File[] = []
  let sources = new Map<File, string>()
  let drawn = (f: File): Filed => {
    if (PICTURES.includes(f.type) && !sources.has(f)) {
      sources.set(f, URL.createObjectURL(f))
    }
    return {
      name: f.name,
      mime: f.type,
      size: f.size,
      ...sources.has(f) ? { src: sources.get(f) } : {},
      ...reads(given.asking.reads, f) ? {} : { note: UNREAD },
    }
  }
  let hold = (files: File[]) => {
    let { kept, left } = within(files, given.asking)
    holding = kept
    for (let [f, src] of sources) {
      if (kept.includes(f)) continue
      URL.revokeObjectURL(src)
      sources.delete(f)
    }
    if (input) {
      let put = new DataTransfer()
      for (let f of kept) put.items.add(f)
      input.files = put.files
    }
    now = { ...now, files: kept.map(drawn), left }
    draw()
  }
  let draw = () =>
    render(
      h(Ask, {
        ...given,
        ...now,
        onFiles: (files) => hold([...holding, ...files]),
        onRemove: (at) => {
          hold(holding.filter((_, i) => i != at))
          input?.focus()
        },
      }),
      root,
    )
  draw()
  let field = () => root.querySelector('textarea')
  return {
    set: (change: Held) => {
      now = { ...now, ...change }
      draw()
    },
    hold,
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
