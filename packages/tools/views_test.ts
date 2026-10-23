// A registered tool reads as what callers call it and what it does, wherever
// a list holds one. A text the graph keeps is, in a list, a passage: its
// title, who wrote it, when, and the words around what was sought. Its page is
// the text whole.
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { plain, render, tree } from '@yaks/text'
import { docDoc } from '@yaks/doc'
import { provenanceDoc } from '@yaks/provenance/vocab'
import { toolsDoc } from './vocab.ts'
import { views } from './views.ts'

let vocab = loadVocab([toolsDoc, docDoc, provenanceDoc])
let tool = {
  entity: { eid: 't1' },
  tool: {
    name: 'graph_query',
    description: 'Read the graph with a query.\n\nThe grammar is …',
  },
}

test('a tool reads by its name and the first line of what it does', () => {
  equal(plain(tree(views, tool, 'Title', vocab)), 'graph_query')
  for (let view of ['Tile', 'List.Tile']) {
    equal(
      plain(tree(views, tool, view, vocab)),
      'tool graph_query Read the graph with a query.',
    )
  }
})

let ctx = {
  name: (eid: string) => (eid == 'u1' ? 'Jeff' : eid),
  when: () => '3 days ago',
  words: ['oracle'],
}
let said = (b: object, view: string) =>
  render(views, b as never, view, vocab, ctx, 'plain')

let body = 'Opening words. '.repeat(40) +
  'An oracle is not a persona per topic.'
let kept = {
  entity: { eid: 't2' },
  doc: { title: 'Oracles', body: '' },
  content: { body },
  created: { by: 'u1', at: '2026-10-19T15:33:46Z' },
}

test('a kept text in a list is its title, who, when and the passage sought', () => {
  let tile = said(kept, 'Tile')
  ok(tile.startsWith('Oracles · Jeff · 3 days ago …'))
  ok(tile.endsWith('An oracle is not a persona per topic.'))
  ok(tile.length < 250)
  equal(said(kept, 'Page'), body)
})
