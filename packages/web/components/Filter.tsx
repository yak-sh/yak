// The ephemeral filter — typed in the titlebar, felt in the face. It ANDs
// into the view's own query only while it's typed, never stored:
// board.query is the saved filter, this is the glance. Same grammar as
// everywhere (query.ts), same completion as every query field; a line that
// doesn't parse yet filters nothing — inert, because a bar mid-keystroke is
// no place to throw. Escape clears; blurring empty leaves nothing. The input
// (FilterInput, rendered by the card chrome) and the rows it screens
// (passOf, read by the face) live in different subtrees, and the wire
// between them is the page's own graph: the line is the field
// `filter:<eid>` there (fields.tsx), keyed by the viewed entity, so
// switching tabs (Board ⇄ List) keeps the glance.
import { useRef } from 'preact/hooks'
import type { SubscriptionRead } from '../live.ts'
import { parseQuery } from '../query.ts'
import { useDraft } from './drafts.ts'
import { useQueryResult } from './useQuery.ts'
import { block } from '@yaks/ui'
import { fields } from './fields.tsx'

let Frame = block('div', 'Filter', {})

/** The field a viewed entity's filter line is typed in. */
export let filterField = (eid: string) => `filter:${eid}`

// the faces that listen — the titlebar consults this to decide whether
// the current view earns the input or just the spacer
export let filterable = new Set(['Board', 'List'])

// the bar's current text, for a face that must know whether it is SCREENING
// at all: a count the server computed over the saved query is the truth only
// while nothing narrows it here. Before the bar has mounted, a host's
// `initial` line is the one it will show. Reading it subscribes the caller.
export let filterLine = (eid: string, initial = ''): string =>
  fields.row(filterField(eid))?.text ?? initial

// Windowed faces filter BEFORE taking a page. A half-typed expression stays
// inert, just as it does for the local faces, but a valid one rides the saved
// query instead of filtering an already-truncated page of cached rows.
export let filteredQuery = (eid: string, query: string): string => {
  let line = filterLine(eid).trim()
  try {
    parseQuery(line)
    return line ? query + '&' + line : query
  } catch {
    return query
  }
}

// the face's half: the current pass predicate for this entity's rows
export type Pass = ((eid: string) => boolean) & {
  subscription?: SubscriptionRead
}

export let usePassOf = (
  eid: string,
  initial = '',
): Pass => {
  let line = filterLine(eid, initial)
  let valid = true
  try {
    parseQuery(line)
  } catch {
    valid = false
  }
  // Text membership is FTS5-owned, so even this transient screen reads the
  // same server subscription as a saved board instead of tokenizing locally.
  let result = useQueryResult(valid ? line : '')
  let hits = new Set(result.eids)
  let pass: Pass = !line.trim() || !valid ? () => true : (row) => hits.has(row)
  pass.subscription = result.subscription
  return pass
}

// the titlebar's half: the query field for this entity's line. A draft keyed
// by the field survives a hot swap or reload; the field's row in the page's
// graph outlives a card remount on its own.
export let FilterInput = (
  { eid, initial = '' }: { eid: string; initial?: string },
) => {
  let id = filterField(eid)
  let box = useRef<HTMLInputElement>(null)
  // A restored draft is put in the field; a keystroke's is already there.
  let { sync, spend } = useDraft(
    id,
    box,
    (v) => v != fields.text(id) && fields.set(id, v),
  )
  return (
    <Frame>
      <fields.Filter
        id={id}
        initial={initial}
        elRef={box}
        placeholder='filter…'
        onInput={(e: InputEvent) => sync(e.currentTarget as HTMLInputElement)}
        onKey={(e: KeyboardEvent) => {
          if (e.key != 'Escape') return
          let el = e.currentTarget as HTMLInputElement
          if (el.value) e.stopPropagation() // consumed by the clear
          fields.set(id, '')
          spend()
          el.blur()
        }}
      />
    </Frame>
  )
}
