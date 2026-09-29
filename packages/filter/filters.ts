/**
 * The query field, bound to its host. Each field is an entity in the host's
 * front-end graph wearing a `filter` component, named by the host (`search`,
 * `filter:<board>`), so any part of a page reads what is typed in any field
 * by reading the graph. `filters(front, opts)` gives the actions on those
 * rows (each one a patch) and `Filter`, the component that types into them,
 * built of @yaks/ui's `Field` and `Choices`.
 *
 * The host supplies what the field cannot know: the vocabulary its queries
 * speak, the `source` that answers what only a graph knows (@yaks/query
 * `Source`), and `Float`, where the list of candidates floats. Without one
 * the list paints in the flow, under the field, as a terminal wants it.
 *
 * The keys are the same everywhere: while the list is open, Tab or Enter
 * accepts the pick, the arrows move it and Escape closes the list; any other
 * key, and those with a modifier, are the host's (`onKey`). A browser types
 * through the element's own editing and `press` is called for it; a terminal
 * calls `type` and `press` from its key loop, and passes `active` so the field
 * paints its caret.
 *
 * @module
 */

import { computed, type ReadonlySignal, signal } from '@preact/signals'
import {
  type ComponentChildren,
  Fragment,
  type FunctionComponent,
  h,
  type VNode,
} from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import type { Bundle } from '@yaks/graph'
import { complete, type Source } from '@yaks/query'
import { Choices, Field } from '@yaks/ui'
import type { Vocab } from '@yaks/vocab'
import {
  type Act,
  act,
  dismissed,
  moved,
  placed,
  type Row,
  taken,
  typed,
} from './state.ts'

/** As much of a front-end graph as a field needs; a @yaks/client `client()`
 * is one. */
export type Front = {
  mutate: (change: Bundle[]) => unknown
  watch: (query: string) => {
    value: Bundle[]
    subscribe: (fn: (rows: Bundle[]) => void) => () => void
  }
  ent: (eid: string) => Bundle | undefined
}

/** An element a list floats beside. */
export type Anchor = { current: HTMLInputElement | HTMLTextAreaElement | null }

/** Where the list of candidates floats: around it, the field it belongs to. */
export type Float = FunctionComponent<
  { anchor: Anchor; children?: ComponentChildren }
>

/** What a host supplies. `vocab` and `source` are read each time a field
 * completes, so a vocabulary the host learns later is the one used. */
export type Opts = {
  /** the vocabulary the queries speak */
  vocab: Vocab
  /** what only a graph can answer: entity ids, common values, rankings */
  source?: Source
  /** where the list floats (default: in the flow, under the field) */
  Float?: Float
}

/** What a `Filter` takes. */
export type FilterProps = {
  /** the field's entity in the front-end graph */
  id: string
  placeholder?: string
  /** several lines: a newline can be typed (shift+Enter) */
  lines?: boolean
  /** @yaks/ui `Field` variants */
  mod?: string
  class?: string
  /** the text a field starts with when its row does not exist yet */
  initial?: string
  /** paint the caret, for a terminal, where no element has the focus */
  active?: boolean
  /** take the keyboard on mount */
  focus?: boolean
  /** the element, for a host that measures it or moves the focus */
  elRef?: Anchor
  /** a key the list did not take */
  onKey?: (e: KeyboardEvent) => void
  /** after the field took what was typed */
  onInput?: (e: InputEvent) => void
  onBlur?: (e: FocusEvent) => void
}

/** The fields in one front-end graph. */
export type Filters = {
  /** the query field */
  Filter: FunctionComponent<FilterProps>
  /** a field's row, read reactively */
  row: (id: string) => Row | undefined
  /** what is typed in a field, read reactively */
  text: (id: string) => string
  /** the person typed: the text, the caret, and what can come next there */
  type: (id: string, text: string, caret?: number) => void
  /** the host put this text in the field, offering nothing */
  set: (id: string, text: string, caret?: number) => void
  /** move the pick `d` rows */
  move: (id: string, d: number) => void
  /** take the picked candidate (or candidate `i`), and complete on from it */
  accept: (id: string, i?: number) => void
  /** close the list */
  dismiss: (id: string) => void
  /** a key, named as a browser names it: whether the list took it */
  press: (id: string, key: string) => boolean
}

// The list in the flow, under the field.
let Inline: Float = ({ children }) => h(Fragment, null, children)

// A key with a modifier is always the host's: ⌘⏎ opens a tab, ⇧⏎ a new line.
let modified = (e: KeyboardEvent) =>
  e.metaKey || e.ctrlKey || e.altKey || e.shiftKey

/** Bind the query field to a front-end graph and to what its host knows. */
export let filters = (front: Front, opts: Opts): Filters => {
  let { Float = Inline } = opts
  // One watch for every field; each field's row is its own computed, so a
  // keystroke repaints the field it landed in and whoever reads that one.
  let seen = front.watch('.filter')
  let rows = signal(seen.value)
  seen.subscribe((all) => rows.value = all)
  let held = new Map<string, ReadonlySignal<Row | undefined>>()
  let live = (id: string) => {
    let r = held.get(id)
    if (!r) {
      r = computed(() =>
        rows.value.find((b) => b.entity.eid == id)?.filter as Row | undefined
      )
      held.set(id, r)
    }
    return r
  }
  let now = (id: string) => front.ent(id)?.filter as Row | undefined
  let write = (id: string, patch: Partial<Row>) =>
    void front.mutate([{ entity: { eid: id }, filter: patch }])

  let type = (id: string, text: string, caret = text.length) => {
    let found = complete(opts.vocab, text, caret, opts.source ?? {})
    if (!(found instanceof Promise)) {
      return write(id, typed(text, caret, found))
    }
    // A source that answers later: the text lands now, the list when it
    // arrives, unless the person has typed on since.
    write(id, placed(text, caret))
    found.then((f) => {
      let r = now(id)
      if (r?.text == text && r.caret == caret) write(id, typed(text, caret, f))
    })
  }
  let set = (id: string, text: string, caret?: number) =>
    write(id, placed(text, caret))
  let move = (id: string, d: number) => {
    let r = now(id)
    if (r?.cands.length) write(id, moved(r, d))
  }
  let accept = (id: string, i?: number) => {
    let r = now(id)
    if (!r?.cands.length) return
    let t = taken(r, i)
    type(id, t.text, t.caret)
  }
  let dismiss = (id: string) => {
    if (now(id)?.cands.length) write(id, dismissed)
  }
  let acts: Record<Act, (id: string) => void> = {
    accept,
    up: (id) => move(id, -1),
    down: (id) => move(id, 1),
    dismiss,
  }
  let press = (id: string, key: string) => {
    let a = act(now(id), key)
    if (a) acts[a](id)
    return !!a
  }

  // Accepting in a browser edits the element the way typing does, caret and
  // all, so the host's own input listener hears it too and the list rolls on
  // from the word taken (`.status=` into its values).
  let take = (
    id: string,
    el: HTMLInputElement | HTMLTextAreaElement,
    i?: number,
  ) => {
    let r = now(id)
    if (!r?.cands.length) return
    let t = taken(r, i)
    el.value = t.text
    el.setSelectionRange(t.caret, t.caret)
    // an event of the element's own window, which may not be this realm's
    let E = el.ownerDocument.defaultView?.Event ?? Event
    el.dispatchEvent(new E('input', { bubbles: true }))
  }

  let List = ({ id, r, anchor }: { id: string; r: Row; anchor: Anchor }) =>
    h(
      Float,
      { anchor },
      h(
        Choices,
        {},
        r.cands.map((c, i) =>
          h(
            Choices.Item,
            {
              key: c.text,
              mod: i == r.pick && 'on',
              // mousedown, prevented: taken without the field losing focus
              onMouseDown: (e: MouseEvent) => {
                e.preventDefault()
                if (anchor.current) take(id, anchor.current, i)
                else accept(id, i)
              },
            },
            h(Choices.Text, {}, c.text),
            h(Choices.Note, {}, c.kind),
          )
        ),
      ),
    )

  let Filter = (p: FilterProps): VNode => {
    let own = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
    let box = p.elRef ?? own
    useLayoutEffect(() => {
      if (!now(p.id)) set(p.id, p.initial ?? '')
    }, [p.id])
    useLayoutEffect(() => {
      if (p.focus) box.current?.focus?.() // a terminal's element has none
    }, [])
    let r = live(p.id).value
    let text = r?.text ?? p.initial ?? ''
    return h(
      Fragment,
      null,
      h(Field, {
        elRef: box,
        lines: p.lines,
        mod: p.mod,
        class: p.class,
        placeholder: p.placeholder,
        value: text,
        caret: p.active ? r?.caret ?? text.length : undefined,
        onInput: (e: InputEvent) => {
          let el = e.currentTarget as HTMLInputElement
          type(p.id, el.value, el.selectionStart ?? el.value.length)
          p.onInput?.(e)
        },
        onKeyDown: (e: KeyboardEvent) => {
          let a = !modified(e) && act(now(p.id), e.key)
          if (!a) return p.onKey?.(e)
          e.preventDefault()
          e.stopPropagation()
          if (a == 'accept') take(p.id, e.currentTarget as HTMLInputElement)
          else acts[a](p.id)
        },
        onBlur: (e: FocusEvent) => {
          dismiss(p.id)
          p.onBlur?.(e)
        },
      }),
      r?.cands.length ? h(List, { id: p.id, r, anchor: box }) : null,
    )
  }

  return {
    Filter,
    row: (id) => live(id).value,
    text: (id) => live(id).value?.text ?? '',
    type,
    set,
    move,
    accept,
    dismiss,
    press,
  }
}
