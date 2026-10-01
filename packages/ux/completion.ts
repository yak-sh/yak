/**
 * Completion behavior bound to a host graph and durable host-owned drafts.
 * The domain supplies replacements; @yaks/ui Field and Choices present them.
 * State is Completion{caret,from,to,cands,pick}, or the component the host names.
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
import { Choices, Field as Input } from '@yaks/ui'
import type { Result } from './completion-state.ts'
import {
  type Act,
  act,
  dismissed,
  moved,
  placed,
  type Row,
  taken,
  typed,
} from './completion-state.ts'

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

/** A person's drafts, by the place they type in: what is typed there ('' for
 * nothing, read reactively), and kept as it is typed. @yaks/draft's `desk`
 * is one. */
export type Drafts = {
  text: (place: string) => string
  type: (place: string, text: string) => void
}

/** What the host supplies; the domain owns completion, the host owns drafts. */
export type Opts = {
  /** What the domain offers, read anew each time the person types. */
  complete: (text: string, caret: number) => Result | Promise<Result>
  /** The graph component holding the caret and choices (default: Completion). */
  component?: string
  /** where what is typed in each field is kept, by the field's name */
  drafts: Drafts
  /** where the list floats (default: in the flow, under the field) */
  Float?: Float
}

/** What a completion `Field` takes. */
export type FieldProps = {
  /** the field's entity in the front-end graph */
  id: string
  placeholder?: string
  /** several lines: a newline can be typed (shift+Enter) */
  lines?: boolean
  /** @yaks/ui `Field` variants */
  mod?: string
  class?: string
  /** the text a field starts with when nothing is typed in it yet */
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
export type Controller = {
  /** the completion field */
  Field: FunctionComponent<FieldProps>
  /** Choices for a separately hosted input; reads its row reactively. */
  List: FunctionComponent<{ id: string; anchor: Anchor }>
  /** Wire an imperative input, returning its listener cleanup. */
  bind: (id: string, el: HTMLInputElement | HTMLTextAreaElement) => () => void
  /** Release the controller's graph subscription when its host closes. */
  dispose: () => void
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

/** Bind completion to a front-end graph and to what its host knows. */
export let completion = (front: Front, opts: Opts): Controller => {
  let { Float = Inline, component = 'Completion' } = opts
  // One watch for every field; each field's row is its own computed, so a
  // keystroke repaints the field it landed in and whoever reads that one.
  let seen = front.watch(`.${component}`)
  let rows = signal(seen.value)
  let dispose = seen.subscribe((all) => rows.value = all)
  let held = new Map<string, ReadonlySignal<Row | undefined>>()
  // A field's row: what is typed (its draft) over its state component, and none
  // while it has neither.
  let rowOf = (id: string, f?: Bundle) => {
    let text = opts.drafts.text(id)
    let at = f?.[component] as Omit<Row, 'text'> | undefined
    return at || text ? { ...placed(text), ...at, text } : undefined
  }
  let live = (id: string) => {
    let r = held.get(id)
    if (!r) {
      r = computed(() => rowOf(id, rows.value.find((b) => b.entity.eid == id)))
      held.set(id, r)
    }
    return r
  }
  let now = (id: string) => rowOf(id, front.ent(id))
  let write = (id: string, { text, ...at }: Partial<Row>) => {
    if (text != null) opts.drafts.type(id, text)
    if (Object.keys(at).length) {
      front.mutate([{ entity: { eid: id }, [component]: at }])
    }
  }

  let versions = new Map<string, number>()
  let next = (id: string) => {
    let version = (versions.get(id) ?? 0) + 1
    versions.set(id, version)
    return version
  }

  let type = (id: string, text: string, caret = text.length) => {
    let version = next(id)
    let found = opts.complete(text, caret)
    if (!(found instanceof Promise)) {
      return write(id, typed(text, caret, found))
    }
    // A source that answers later: the text lands now, the list when it
    // arrives, unless the person has typed on since.
    write(id, placed(text, caret))
    found.then((f) => {
      let r = now(id)
      if (versions.get(id) == version && r?.text == text && r.caret == caret) {
        write(id, typed(text, caret, f))
      }
    }, () => {
      // An unavailable source leaves the draft and its empty list intact.
      // In particular, a failed older request must not clear newer choices.
    })
  }
  let set = (id: string, text: string, caret?: number) => {
    next(id)
    write(id, placed(text, caret))
  }
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
    next(id)
    if (now(id)?.cands.length) write(id, dismissed)
  }
  let acts: Record<Act, (id: string) => void> = {
    accept,
    up: (id) => move(id, -1),
    down: (id) => move(id, 1),
    dismiss,
  }

  // Accepting in a browser edits the element the way typing does, caret and
  // all, so the host's own input listener hears it too and the list rolls on
  // from the word taken (`.task.status=` into its values).
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

  // A key, taken through the element where there is one. An Enter the list
  // leaves to the host sends what is typed as it stands, so the list closes.
  let key = (id: string, name: string, el?: Anchor['current']) => {
    let a = act(now(id), name)
    if (a == 'accept' && el) take(id, el)
    else if (a) acts[a](id)
    else if (name == 'Enter') dismiss(id)
    return !!a
  }
  let press = (id: string, name: string) => key(id, name)

  let ChoicesList = (
    { id, r, anchor }: { id: string; r: Row; anchor: Anchor },
  ) =>
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

  let List = ({ id, anchor }: { id: string; anchor: Anchor }) => {
    let r = live(id).value
    return r?.cands.length ? h(ChoicesList, { id, r, anchor }) : null
  }

  let selection = (id: string, el: HTMLInputElement | HTMLTextAreaElement) => {
    let caret = el.selectionStart ?? el.value.length
    if (now(id)?.caret != caret) type(id, el.value, caret)
  }

  let bind = (id: string, el: HTMLInputElement | HTMLTextAreaElement) => {
    if (!now(id)) set(id, el.value)
    let input = () => type(id, el.value, el.selectionStart ?? el.value.length)
    let keydown = (event: Event) => {
      let e = event as KeyboardEvent
      if (modified(e) || !key(id, e.key, el)) return
      e.preventDefault()
      e.stopPropagation()
    }
    let blur = () => dismiss(id)
    let selected = () => selection(id, el)
    el.addEventListener('input', input)
    el.addEventListener('keydown', keydown)
    el.addEventListener('blur', blur)
    for (let event of ['click', 'select', 'keyup']) {
      el.addEventListener(event, selected)
    }
    let off = live(id).subscribe((r) => {
      if (r && el.value != r.text) {
        el.value = r.text
        el.setSelectionRange(r.caret, r.caret)
      }
    })
    return () => {
      off()
      el.removeEventListener('input', input)
      el.removeEventListener('keydown', keydown)
      el.removeEventListener('blur', blur)
      for (let event of ['click', 'select', 'keyup']) {
        el.removeEventListener(event, selected)
      }
    }
  }

  let Field = (p: FieldProps): VNode => {
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
      h(Input, {
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
          let el = e.currentTarget as HTMLInputElement
          if (modified(e) || !key(p.id, e.key, el)) return p.onKey?.(e)
          e.preventDefault()
          e.stopPropagation()
        },
        onClick: (e: MouseEvent) =>
          selection(p.id, e.currentTarget as HTMLInputElement),
        onSelect: (e: Event) =>
          selection(p.id, e.currentTarget as HTMLInputElement),
        onKeyUp: (e: KeyboardEvent) =>
          selection(p.id, e.currentTarget as HTMLInputElement),
        onBlur: (e: FocusEvent) => {
          dismiss(p.id)
          p.onBlur?.(e)
        },
      }),
      r?.cands.length ? h(ChoicesList, { id: p.id, r, anchor: box }) : null,
    )
  }

  return {
    Field,
    List,
    bind,
    dispose,
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

export {
  type Act,
  act,
  type Cand,
  CAP,
  dismissed,
  moved,
  placed,
  type Result,
  type Row,
  taken,
  typed,
} from './completion-state.ts'
