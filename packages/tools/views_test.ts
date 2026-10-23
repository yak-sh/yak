// A registered tool reads as what callers call it and what it does, wherever
// a list holds one.
import { equal, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { plain, tree } from '@yaks/text'
import { toolsDoc } from './vocab.ts'
import { views } from './views.ts'

let vocab = loadVocab([toolsDoc])
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
