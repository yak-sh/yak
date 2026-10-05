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
import { Text } from './Text.ts'
import { panesOf, Stack, stackAt, stacked } from './Stack.ts'
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

// Read-only text specimens do not type drafts. A real editor uses the
// consumer's persistent drafts through its host, not this guide's graph.
let Sample = ({ part }: { part: 'Edit' | 'Text' | 'Stack' }): JSX.Element => {
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
  let row = useSignal({
    entity: { eid: stackAt('guide') },
    Stack: { panes: ['List', 'Detail'] },
  })
  useEffect(() => {
    if (part != 'Stack') return
    host.front.mutate([row.value])
    let watch = host.front.watch('.Stack')
    let off = watch.subscribe((rows) => {
      let next = rows[0]
      if (next) {
        row.value = { entity: next.entity, Stack: { panes: panesOf(next) } }
      }
    })
    return off
  }, [])
  let node = part == 'Stack'
    ? h(
      'div',
      {},
      h(Stack, {
        e: row.value,
        onChange: (b) => {
          host.front.mutate([b])
        },
        Pane: ({ pane }) => h('p', {}, `${pane} pane`),
        Strip: ({ pane }) => h('span', {}, pane),
      }),
      h('button', {
        onClick: () => host.front.mutate([stacked(row.value, 'Detail')]),
      }, 'Open detail'),
    )
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
    Stack: {
      Component: Stack,
      description:
        'Consumer-named panes stacked in the page graph, emitting a bundle',
      state: ['Stack'],
      specimens: () => [[
        'List and detail; press the list strip to return',
        h('div', {}, h(Sample, { part: 'Stack' })),
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
