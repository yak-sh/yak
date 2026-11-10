/** The base UX kit, also the browser-safe ./ui plugin facet. Specimens own
 * a page graph; their values are examples, never a person's stored data.
 * @module
 */

import { h, type JSX } from 'preact'
import { useEffect, useMemo } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { client } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { Disclosure, disclosureAt } from './Disclosure.ts'
import { Edit } from './Edit.ts'
import { Order, orderAt } from './Order.ts'
import { Submit, submitAt, type SubmitProps } from './Submit.ts'
import { Fields, type FieldSpec } from './Fields.ts'
import { put } from './field-values.ts'
import { Text } from './Text.ts'
import { Save } from './Save.ts'
import { Sort, sortAt } from './Sort.ts'
import { Button, Form, Notice, Table } from '@yaks/ui/parts'
import { type Host, Ux } from './host.ts'
import { defineKit, type Kit } from './kit.ts'
import { uxDoc } from './vocab.ts'

let value = { entity: { eid: 'sample' }, Sample: { title: 'Draw the map' } }
let domain = {
  $defs: {
    Sample: { component: true, properties: { title: { type: 'string' } } },
  },
}

let DisclosureSample = ({ open }: { open: boolean }): JSX.Element => {
  let front = useMemo(
    () => client(loadVocab([uxDoc]), [], { vault: false, wireVault: false }),
    [],
  )
  let row = useSignal<Bundle>({
    entity: { eid: disclosureAt(`guide/${open}`) },
    Disclosure: { open },
  })
  useEffect(() => {
    front.mutate([row.value])
    let watch = front.watch('.Disclosure', { remote: false })
    let off = watch.subscribe((rows) => {
      if (rows[0]) row.value = rows[0]
    })
    return () => {
      off()
      watch.close()
      front.close()
    }
  }, [])
  return h(Disclosure, {
    e: row.value,
    onChange: (b) => void front.mutate([b]),
    summary: 'Completed',
  }, h('p', {}, 'The village is safe.'))
}

// Rows put in order by dragging, in the specimen's own page graph.
let OrderSample = (): JSX.Element => {
  let front = useMemo(
    () => client(loadVocab([uxDoc]), [], { vault: false, wireVault: false }),
    [],
  )
  let state = useSignal<Bundle>({ entity: { eid: orderAt('guide/order') } })
  let ids = useSignal(['signal over noise', 'the map', 'the one idea'])
  useEffect(() => {
    let watch = front.watch('.Order', { remote: false })
    let off = watch.subscribe((rows) => {
      state.value = rows[0] ?? { entity: state.value.entity }
    })
    return () => {
      off()
      watch.close()
      front.close()
    }
  }, [])
  return h(Order, {
    e: state.value,
    onChange: (b) => void front.mutate([b]),
    ids: ids.value,
    row: (id) => h('p', {}, id),
    onPlace: (id, at) => {
      let rest = ids.value.filter((x) => x != id)
      ids.value = [...rest.slice(0, at), id, ...rest.slice(at)]
    },
  })
}

let SortSample = (): JSX.Element => {
  let state = useSignal<Bundle>({ entity: { eid: sortAt('guide/sort') } })
  let rows = [['Apple', 12], ['Pear', 3], ['Orange', 90]] as [string, number][]
  return h(Sort, {
    e: state.value,
    onChange: (b) => {
      state.value = b
    },
    cols: [null, 'num'],
    heads: ['Name', 'Count'],
    rows: rows.map(([name, n]) => ({
      values: [name, n],
      content: h(
        Table.Row,
        null,
        h(Table.Cell, null, name),
        h(Table.Cell, { mod: 'num' }, n),
      ),
    })),
  })
}

let controls: FieldSpec[] = [
  { path: ['name'], label: 'Name', kind: 'text', required: true },
  {
    path: ['layout'],
    label: 'Layout',
    kind: 'choice',
    options: ['Compact', 'Comfortable'],
  },
  { path: ['notes'], label: 'Notes', kind: 'lines' },
]

let SubmitSample = (): JSX.Element => {
  let at = 'guide/submit'
  let row = useSignal<Bundle>({ entity: { eid: submitAt(at) } })
  let props: SubmitProps<object> = {
    at,
    place: at,
    e: row.value,
    onChange: (b) => row.value = b,
    read: () => Promise.resolve({}),
    send: () => Promise.resolve(undefined),
    render: ({ state, change, send }) =>
      state.sent ? h(Notice, { role: 'status' }, 'Saved.') : h(
        Form,
        {
          onSubmit: async (e: Event) => {
            e.preventDefault()
            change({ sending: true })
            let said = await send(at, state.values ?? {})
            change({ sending: false, sent: !said, said })
          },
        },
        h(Fields, {
          at,
          fields: controls,
          values: state.values ?? {},
          disabled: state.sending,
          onChange: (path, value) =>
            change({ values: put(state.values ?? {}, path, value) }),
        }),
        h(
          Form.Actions,
          {},
          h(Button, { type: 'submit', disabled: state.sending }, 'Save'),
        ),
      ),
  }
  return h(Submit<object>, props)
}

// Specimen drafts belong to the guide; an app supplies its persistent desk.
let Sample = (
  { part }: { part: 'Edit' | 'Text' | 'Submit' },
): JSX.Element => {
  let words = useSignal<Record<string, string>>({})
  let front = useMemo(
    () => client(loadVocab([uxDoc]), [], { vault: false, wireVault: false }),
    [],
  )
  let host = useMemo((): Host => {
    return {
      vocab: loadVocab([domain]),
      front,
      drafts: {
        text: (place) => words.value[place] ?? '',
        type: (place, text) => words.value = { ...words.value, [place]: text },
        spend: (place) => words.value = { ...words.value, [place]: '' },
      },
      write: () => {},
      name: (eid) => eid,
      id: (e) => e.entity.eid,
      kind: () => 'sample',
      when: (at) => at,
      find: () => Promise.resolve([]),
    }
  }, [])
  useEffect(() => () => front.close(), [])
  let node = part == 'Submit'
    ? h(SubmitSample, {})
    : part == 'Edit'
    ? h(Edit, { e: value, comp: 'Sample', prop: 'title' })
    : h(Text, { e: value, comp: 'Sample', prop: 'title', readOnly: true })
  return h(Ux, { host, at: `guide/${part}` }, node)
}

/** Edit and Text share Edit state; Refused is an event, never stored. */
export let kit: Kit = defineKit({
  description: 'Controlled editing and navigation in the page graph',
  vocab: uxDoc,
  components: {
    Sort: {
      Component: Sort,
      description:
        'A table sorted by raw column values, with accessible header buttons',
      state: ['Sort'],
      specimens: () => [[
        'Press a column to sort; press again to reverse',
        h(SortSample, {}),
      ]],
    },
    Save: {
      Component: Save,
      description:
        'Changed fields and one viewport bar to save or discard them together',
      state: [],
      specimens: () => [[
        'Two pending changes',
        h(
          'div',
          {},
          h(Save, {
            count: 2,
            mod: 'sample',
            onSave: () => {},
            onDiscard: () => {},
          }),
        ),
      ]],
    },
    Disclosure: {
      Component: Disclosure,
      description:
        'A summary that opens consumer-supplied content, emitting a page bundle',
      state: ['Disclosure'],
      specimens: () => [
        [
          'Closed; press the summary to show content',
          h('div', {}, h(DisclosureSample, { open: false })),
        ],
        [
          'Open; press the summary to hide content',
          h('div', {}, h(DisclosureSample, { open: true })),
        ],
      ],
    },
    Order: {
      Component: Order,
      description:
        'Rows put in order by dragging, taking an entity dragged from elsewhere',
      state: ['Order'],
      specimens: () => [[
        'Drag a row between two others',
        h('div', {}, h(OrderSample, {})),
      ]],
    },
    Fields: {
      Component: Fields,
      description: 'Controlled typed inputs, choices and repeat groups',
      state: [],
      specimens: () => [[
        'Typed inputs and choices',
        h(
          'div',
          {},
          h(Fields, {
            at: 'guide/fields',
            fields: controls,
            values: {},
            onChange: () => {},
          }),
        ),
      ]],
    },
    Submit: {
      Component: Submit,
      description: 'Loading, durable drafts and submission feedback',
      state: ['Submit'],
      specimens: () => [[
        'Fill and submit',
        h('div', {}, h(Sample, { part: 'Submit' })),
      ]],
    },
    Edit: {
      Component: Edit,
      description:
        'A property changed where it stands, with its control chosen by the vocabulary',
      state: ['Edit', 'Refused'],
      specimens: () => [[
        'A property at rest (read-only)',
        h('div', {}, h(Sample, { part: 'Edit' })),
      ]],
    },
    Text: {
      Component: Text,
      description:
        'Text edited in place, with persistent drafts kept by the host',
      state: ['Edit', 'Refused'],
      specimens: () => [[
        'Text at rest (read-only)',
        h('div', {}, h(Sample, { part: 'Text' })),
      ]],
    },
  },
})

/** Installed plugins contribute named kits; a page chooses its composition. */
export let ux: { base: Kit } = { base: kit }
