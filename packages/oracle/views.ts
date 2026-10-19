// The browse facet offers live query-backed pages beside shared node faces.
// Both exports share entries so browse adapts each only once, with its Io.
import type { Bundle, View } from '@yaks/inspect'
import { parse } from '@yaks/query'
import {
  Dialogue,
  Inline,
  Node,
  NodeTile,
  Title,
  Tree,
  TreeTile,
} from './Tree.tsx'

let ref = (e: Bundle, name: string, prop: string): string => {
  let value = e[name]
  return value && typeof value == 'object' && prop in value
    ? String(Reflect.get(value, prop) ?? '')
    : ''
}
let treeAsks = (e: Bundle) => ({
  nodes: `.oracle.tree=${e.entity.eid} *`,
  edges:
    `.oracle_child .edge.from.oracle.tree=${e.entity.eid} * .order=edge.ord`,
  dialogues:
    `.oracle_dialogue.tree=${e.entity.eid} * .order=-created.at .limit=50`,
})
let nodeAsks = (e: Bundle) => ({
  tree: `.entity.eid=${ref(e, 'oracle', 'tree')} *`,
  parents: `.oracle_child .edge.from=${e.entity.eid} *`,
  children: `.oracle_child .edge.to=${e.entity.eid} * .order=edge.ord`,
  dialogues:
    `(.oracle_dialogue.from=${e.entity.eid}|.oracle_dialogue.to=${e.entity.eid}) * .order=-created.at .limit=50`,
})

let all: View[] = [
  { view: 'Oracle.Tree.Tile', match: parse('.oracle'), Render: NodeTile },
  {
    view: 'Oracle.Dialogue.Tile',
    match: parse('.oracle_dialogue'),
    Render: Dialogue,
  },
  ...['Tree', 'Page', 'Full'].map((view) => ({
    view,
    match: parse('.oracle_tree'),
    asks: treeAsks,
    Render: Tree,
  })),
  ...['Oracle', 'Page', 'Full'].map((view) => ({
    view,
    match: parse('.oracle .session'),
    asks: nodeAsks,
    Render: Node,
  })),
  ...['Tile', 'List.Tile'].flatMap((view) => [
    { view, match: parse('.oracle .session'), Render: NodeTile },
    { view, match: parse('.oracle_tree'), Render: TreeTile },
    { view, match: parse('.session .oracle_dialogue'), Render: Dialogue },
  ]),
  ...['Inline', 'Title', 'Card.Title'].flatMap((view) =>
    ['oracle', 'oracle_tree'].map((comp) => ({
      view,
      match: parse(comp == 'oracle' ? '.oracle .session' : '.oracle_tree'),
      Render: view == 'Inline' ? Inline : Title,
    }))
  ),
]

export let componentViews = () => ({ renderers: all })
export let inspectViews = () => all
export let tabs = [
  { view: 'Tree', icon: 'workflow' },
  { view: 'Oracle', icon: 'shapes' },
]
