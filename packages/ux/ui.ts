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
import { type Door, Signup, signupAt } from './Signup.ts'
import { Text } from './Text.ts'
import { Save } from './Save.ts'
import { Sort, sortAt } from './Sort.ts'
import { Table } from '@yaks/ui/parts'
import type { Question } from '@yaks/forms'
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

// A sign-up read from a sample door and sent nowhere; its state is the
// specimen's own.
let card: Door = {
  doc: {
    title: 'Membership card',
    body: 'Tell us a little about you, and what you’d like to do next.',
  },
  form: {
    thanks: 'Thank you. We’ll be in touch this week.',
    closed: 'Membership cards are back in January.',
  },
  open: true,
  questions: [
    ['name', 'line', 'Your name', { required: true }],
    ['phone', 'phone', 'Phone', { order: 1, hint: 'For a call back.' }],
    ['next', 'choices', 'Next steps', {
      order: 2,
      choices: ['Baptism', 'Membership class', 'Serving', 'Church directory'],
    }],
    ['children', 'repeat', 'Child', { order: 3 }],
    ['child', 'line', 'Name', { within: 'children', required: true }],
    ['texts', 'check', 'Announcements by text', { order: 4 }],
  ].map(([eid, kind, label, more]) => ({
    entity: { eid: eid as string },
    question: {
      form: 'card',
      label: label as string,
      kind: kind as Question['question']['kind'],
      ...more as object,
    },
  })),
}

let SignupSample = ({ open }: { open: boolean }): JSX.Element => {
  let at = `guide/signup/${open}`
  let row = useSignal<Bundle>({ entity: { eid: signupAt(at) } })
  return h(Signup, {
    at,
    e: row.value,
    onChange: (b) => row.value = b,
    read: () => Promise.resolve({ ...card, open }),
    send: () => Promise.resolve(undefined),
  })
}

// Read-only text specimens do not type drafts. A real editor uses the
// consumer's persistent drafts through its host, not this guide's graph.
let Sample = ({ part }: { part: 'Edit' | 'Text' }): JSX.Element => {
  let front = useMemo(
    () => client(loadVocab([uxDoc]), [], { vault: false, wireVault: false }),
    [],
  )
  let host = useMemo((): Host => {
    return {
      vocab: loadVocab([domain]),
      front,
      drafts: { text: () => '', type: () => {}, spend: () => {} },
      write: () => {},
      name: (eid) => eid,
      id: (e) => e.entity.eid,
      kind: () => 'sample',
      when: (at) => at,
      find: () => Promise.resolve([]),
    }
  }, [])
  useEffect(() => () => front.close(), [])
  let node = part == 'Edit'
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
    Signup: {
      Component: Signup,
      description:
        'Any sign-up form, drawn from its questions and sent to its form door',
      state: ['Signup'],
      specimens: () => [
        [
          'A membership card; send it to see its thanks',
          h('div', {}, h(SignupSample, { open: true })),
        ],
        [
          'A closed form says its own words',
          h('div', {}, h(SignupSample, { open: false })),
        ],
      ],
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
