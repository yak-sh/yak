// A plan of work, said once: the nodes somebody listed, as the bundles that
// write them and the indented tree a person reads before they land.
//
// Three decisions live here, and each is the reason the plan is a value rather
// than a sequence of writes.
//
// EVERY RELATION IS SAID. A node names its parent and the relation TO it; no
// shape is inferred from the order of the list or from prose. The relation is
// checked against the relations the loaded vocabulary declares (@yaks/edge
// `relations`), so `requires` and `contains` are this package's two and a host
// composing `wants` or `reads` gets those as well, with no edit here.
//
// A LINK IS AN ENTITY, and its id is the sentence it states. The plan says one
// under a `$alias` — `{entity: {eid: '$link~gate'}, edge: {from, to},
// requires: {}}` — because the ends of a new tree are themselves aliases the
// graph has yet to mint; the mint phase resolves the sentence and derives the
// id from it (@yaks/edge `edgeEid`), so stating the same link twice is one
// entity and unstating it is naming it again.
//
// THE TREE IS RENDERED FROM THE PLAN, not from what landed. A dry run and a
// real run print the same tree, and new nodes are named by their local `[key]`:
// the numbers are the server's to mint, after the answer was worded. What a
// caller wants the handles for is the landed bundles, which carry them.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { EDGE } from '@yaks/edge'
import { CallError } from '@yaks/tools'

/** One node of a plan: a task to write, and the sentence that hangs it under
 * its parent — another node's `key`, or the root when it names none. */
export type Node = {
  key: string
  title: string
  body?: string
  status?: string
  parent?: string
  relation: string
}

/** What a tree hangs from: the entity, and what a person calls it. */
export type Root = { eid: Eid; name: string }

/** A plan: the batch that writes it, and the tree it reads as. */
export type Plan = { bundles: Bundle[]; text: string }

let refuse = (said: string): never => {
  throw new CallError('nodes', said)
}

// A parent nobody named is the root, whether it was left out or left empty.
let up = (n: Node): string | undefined => n.parent?.trim() || undefined

// The task itself. `filed.project` is @yaks/project's word and this package
// does not compose it — a host that doesn't either has the column dropped at
// the door, and the tree is still a tree.
let born = (n: Node, project: Eid): Bundle => ({
  entity: { eid: `$${n.key}` },
  task: {},
  doc: { title: n.title.trim(), ...(n.body == null ? {} : { body: n.body }) },
  filed: { project },
  // A node born done or cancelled wears the mark that MEANS it; open wears
  // none, which is the only definition of open there is.
  ...(n.status == 'done' ? { completed: {} } : {}),
  ...(n.status == 'cancelled' ? { cancelled: {} } : {}),
})

// The sentence: `<parent> <relation> <this node>`. The alias cannot collide
// with a node's — a key holds no `~`.
let stated = (n: Node, from: Eid, tag: string): Bundle => ({
  entity: { eid: `$link~${n.key}` },
  [EDGE]: { from, to: `$${n.key}` },
  [tag]: {},
})

// Rootedness, proven rather than assumed: follow the parents and either reach
// the root or come back to a node already on this walk, which is a cycle no
// tree could hold.
let rooted = (n: Node, at: Map<string, Node>): void => {
  let seen = new Set<string>()
  let here: Node | undefined = n
  while (here) {
    if (seen.has(here.key)) refuse(`${n.key} hangs from itself: ${here.key}`)
    seen.add(here.key)
    let parent = up(here)
    here = parent ? at.get(parent) : undefined
  }
}

/**
 * The plan, checked: unique keys, a parent that is one of them, a relation the
 * vocabulary declares, and a walk that reaches the root. Anything wrong is a
 * refusal naming the node, before a single row is written.
 *
 * `tags` is the vocabulary's relation NAME → tag map (@yaks/edge `relations`);
 * either spelling is accepted, since a graph reading `referenced` writes
 * `references` and a caller has seen both.
 */
export let planned = (
  root: Root,
  nodes: Node[],
  tags: Record<string, string>,
): Plan => {
  if (!nodes.length) refuse('a tree needs at least one node')
  let at = new Map<string, Node>()
  for (let n of nodes) {
    if (!n.key?.trim()) refuse('every node needs a key')
    if (at.has(n.key)) refuse(`duplicate key: ${n.key}`)
    if (!n.title?.trim()) refuse(`${n.key} needs a title`)
    at.set(n.key, n)
  }
  let known = new Set(Object.values(tags))
  let bundles: Bundle[] = []
  for (let n of nodes) {
    let parent = up(n)
    if (parent && !at.has(parent)) {
      refuse(`no node ${parent} (parent of ${n.key})`)
    }
    let tag = tags[n.relation] ?? (known.has(n.relation) ? n.relation : '')
    if (!tag) {
      refuse(
        `${n.key}: ${n.relation} is not a relation here — say one of ${
          Object.keys(tags).sort().join(', ')
        }`,
      )
    }
    rooted(n, at)
    bundles.push(
      born(n, root.eid),
      stated(n, parent ? `$${parent}` : root.eid, tag),
    )
  }
  return { bundles, text: treeText(root, nodes) }
}

/**
 * The tree as it prints: the root, then one line per node saying the relation
 * it states, its local key, and its title.
 *
 * ```
 * P-19 Task Graph
 * ├─ requires [gate] The prerequisite
 * └─ wants [goal] The outcome
 *    └─ contains [leaf] A piece of it
 * ```
 */
export let treeText = (root: Root, nodes: Node[]): string => {
  let lines = [root.name]
  let walk = (parent: string | undefined, indent: string) => {
    let here = nodes.filter((n) => up(n) == parent)
    here.forEach((n, i) => {
      let last = i == here.length - 1
      lines.push(
        `${indent}${last ? '└─' : '├─'} ${n.relation} [${n.key}] ${n.title}`
          .trimEnd(),
      )
      walk(n.key, indent + (last ? '   ' : '│  '))
    })
  }
  walk(undefined, '')
  return lines.join('\n')
}

/** What a person calls the root: its human id and its title. */
export let named = (id: string, bundle: Bundle): string =>
  `${id} ${(bundle.doc as Comp | undefined)?.title ?? ''}`.trim()
