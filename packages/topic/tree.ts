/**
 * A topic's tree: everything it holds (`contains`), and everything each
 * subtopic holds, all the way down, nested. Each level asks for its own
 * children as it draws, so the tree reads only what is open on the screen.
 * Only a topic is walked into: a project or a package a topic holds is a leaf
 * here, since what it contains is its own tree. A topic met again on its own
 * path is drawn and not walked, so a cycle ends; past `DEPTH` levels the
 * branch links to its own tree.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import * as ui from '@yaks/ui'
import {
  type Answer,
  type Bundle,
  type Io,
  mention,
  type Props,
} from '@yaks/inspect'
import { EDGES, title } from './page.ts'
import { TOPIC } from './topic.ts'

/** How many levels a tree draws before a branch links to its own tree. */
export let DEPTH = 8

let rows = (a?: Answer): Bundle[] => a?.rows ?? []
let to = (b: Bundle) => String((b.edge as { to?: unknown })?.to ?? '')

/** What a topic holds, each drawn by its own renderer, and below each
 * subtopic what it holds. */
let Twig = (
  { eid, io, path }: { eid: string; io: Io; path: string[] },
): JSX.Element | null => {
  let got = io.ask({
    edges: `.contains&.edge.from=${eid}&?edge&.order=edge.ord&.limit=${EDGES}`,
  }).edges
  let ids = [...new Set(rows(got).map(to).filter(Boolean))]
  let ends = io.ask(
    ids.length ? { ends: `.entity.eid=${ids.join(',')}&*` } : {},
  ).ends
  let held = new Map(rows(ends).map((b) => [b.entity.eid, b]))
  let root = path.length == 1
  if (got?.error) return h(ui.Rows.More, {}, got.error)
  if (!got?.ready && !ids.length) return root ? h(ui.Loading, {}) : null
  if (!ids.length) {
    return root ? h(ui.Rows.More, {}, 'it holds nothing yet') : null
  }
  return h(
    ui.Rows,
    { mod: root ? undefined : 'nested', role: 'list' },
    ids.map((id) => {
      let b = held.get(id)
      let walk = b?.[TOPIC] && !path.includes(id)
      return h(
        ui.Rows.Item,
        { key: id, role: 'listitem', 'data-held': id },
        b
          ? io.show(b, 'Topic.List.Tile', {})
          : ends?.ready
          ? h(ui.Rows.More, {}, mention(io, id), ' is gone')
          : h(ui.Loading, {}),
        !walk
          ? null
          : path.length < DEPTH
          ? h(Twig, { eid: id, io, path: [...path, id] })
          : h(ui.Rows.More, {}, h('a', { href: io.link(id) }, 'more below')),
      )
    }),
  )
}

/** A topic's tree. */
export let TopicTree = ({ e, io }: Props): JSX.Element => {
  let eid = e.entity.eid
  let cover = String((e.doc as { body?: unknown })?.body ?? '')
  return h(
    'div',
    { 'data-tree': eid },
    h(
      ui.Head,
      {},
      h(ui.Head.Title, {}, title(e), h(ui.Head.Kind, {}, 'topic')),
      cover ? h(ui.Head.Sub, {}, cover) : null,
    ),
    h(
      ui.Section,
      { 'data-section': 'Tree' },
      h(Twig, { eid, io, path: [eid] }),
    ),
  )
}
