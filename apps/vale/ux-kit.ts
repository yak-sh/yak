/** Vale's controlled UX kit. List keeps both panes mounted: selecting a row
 * changes content and keyboard ownership, never the list/detail geometry.
 * The consumer names its state entity and handles every emitted bundle.
 */
import { type FunctionComponent, h, type JSX } from 'preact'
import { useEffect, useMemo } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { type Bundle, comps } from '@yaks/graph'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { Button, Panes } from '@yaks/ui'
import { defineKit } from '@yaks/ux'
import words from './ux-vocab.json' with { type: 'json' }

export type Pane = 'list' | 'detail'
export type Selection = { cursor?: string; pane: Pane }

/** Read selection without importing or copying game rows into the page graph. */
export let selection = (e: Bundle): Selection => {
  let v = comps(e).find(([name]) => name == 'List')?.[1]
  return {
    cursor: typeof v?.cursor == 'string' ? v.cursor : undefined,
    pane: v?.pane == 'detail' ? 'detail' : 'list',
  }
}

/** Controlled outputs retain the named instance and the other selection field. */
export let selected = (e: Bundle, cursor: string | null): Bundle => ({
  entity: { eid: e.entity.eid },
  List: { cursor, pane: selection(e).pane },
})
export let focused = (e: Bundle, pane: Pane): Bundle => ({
  entity: { eid: e.entity.eid },
  List: { cursor: selection(e).cursor ?? null, pane },
})

export type ListProps = {
  e: Bundle
  rows: Bundle[]
  onChange: (b: Bundle) => void
  Row: FunctionComponent<{ row: Bundle; selected: boolean }>
  Detail: FunctionComponent<{ row?: Bundle }>
  label?: string
}

/** The panes always exist, even for an empty list or an absent selected row. */
export let List = (
  { e, rows, onChange, Row, Detail, label = 'Rows' }: ListProps,
): JSX.Element => {
  let { cursor, pane } = selection(e)
  return h(
    Panes,
    { style: { height: '100%' } },
    h(
      Panes.Pane,
      { mod: ['nav', pane == 'list' && 'on'], 'aria-label': label },
      h(
        Panes.Body,
        { onFocusIn: () => onChange(focused(e, 'list')) },
        rows.map((row) =>
          h(
            Button,
            {
              key: row.entity.eid,
              type: 'button',
              'aria-pressed': row.entity.eid == cursor,
              onClick: () => onChange(selected(e, row.entity.eid)),
            },
            h(Row, { row, selected: row.entity.eid == cursor }),
          )
        ),
      ),
    ),
    h(
      Panes.Pane,
      { mod: ['main', pane == 'detail' && 'on'], 'aria-label': 'Detail' },
      h(
        Panes.Body,
        { onFocusIn: () => onChange(focused(e, 'detail')) },
        h(Detail, { row: rows.find((row) => row.entity.eid == cursor) }),
      ),
    ),
  )
}

let sample = {
  entity: { eid: 'vale-list-specimen' },
  List: { cursor: 'sample-a', pane: 'list' },
}
let samples = ['sample-a', 'sample-b'].map((eid) => ({ entity: { eid } }))
let Sample = (): JSX.Element => {
  let front = useMemo(() => {
    let c = client(loadVocab([words]), [], { vault: false, wireVault: false })
    c.mutate([sample])
    return c
  }, [])
  let row = useSignal<Bundle>(sample)
  useEffect(() => {
    let watch = front.watch('.entity.eid=vale-list-specimen&.List')
    let off = watch.subscribe((rows) => row.value = rows[0] ?? sample)
    return () => {
      off()
      watch.close()
      front.close()
    }
  }, [])
  return h(List, {
    e: row.value,
    rows: samples,
    onChange: (b) => {
      front.mutate([b])
    },
    Row: ({ row }) => h('span', {}, row.entity.eid),
    Detail: ({ row }) => h('p', {}, row?.entity.eid ?? 'Choose a row'),
  })
}

/** The kit owns only its words; base Edit/Stack words come from base kitDocs. */
export let kit = defineKit({
  description: 'Vale list selection and page navigation',
  vocab: words,
  components: {
    List: {
      Component: List,
      description: 'Controlled selection with persistent list/detail panes',
      state: ['List'],
      specimens: () =>
        [[
          'Choose a row without moving either pane',
          h(Sample, {}),
        ]] as [string, JSX.Element][],
    },
  },
})
export let ux = { vale: kit }
