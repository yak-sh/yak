/**
 * What an entity says, where it stands: `Words`. A body (`comp.prop`, its
 * markdown) reads as markdown, and a double-click types over its source in
 * place (@yaks/ux `Edit.Text`), as every body in browse is edited; leaving it
 * writes what was typed. Where the host takes no edits it is only read. One
 * with nothing written says so, so a double-click has somewhere to land.
 * Where typing is what a page is for (`click`), one click types into it, a
 * link in it still opens, and it says so under the pointer.
 *
 * ```ts ignore
 * h(Words, { io, e, comp: 'doc', prop: 'body' })
 * ```
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { Markdown } from '@yaks/markdown'
import * as ui from '@yaks/ui'
import { Edit, useEdit } from '@yaks/ux'
import type { Bundle, Io } from './host.ts'
import { str } from './read.ts'

/** What `Words` is drawn with. */
export type WordsProps = {
  io: Io
  e: Bundle
  comp: string
  prop: string
  /** its `Edit` state's eid, where one entity's words show twice */
  at?: string
  /** what it says when nothing is written */
  empty?: string
  /** one click types into it, rather than a double-click */
  click?: boolean
}

/** A body read as markdown, typed over where it stands. */
export let Words = (
  { io, e, comp, prop, at, empty = 'nothing is written yet', click }:
    WordsProps,
): JSX.Element => {
  let text = str(e, comp, prop)
  let edit = useEdit(e.entity.eid, comp, prop, { at, value: text })
  let open = io.edits && edit.open
  let typed = io.edits && !open
  return h(
    ui.Body,
    {
      'data-words': `${comp}.${prop}`,
      mod: io.edits && click ? 'typed' : undefined,
      onDblClick: typed ? edit.begin : undefined,
      onClick: typed && click
        ? (ev: MouseEvent) =>
          (ev.target as Element).closest?.('a') || edit.begin()
        : undefined,
    },
    open
      ? h(Edit.Text, { e, comp, prop, at: edit.at, multi: true })
      : text
      ? h(Markdown, { source: text })
      : h(
        ui.Rows.More,
        {},
        io.edits
          ? `${empty}: ${click ? 'click' : 'double-click'} to write`
          : empty,
      ),
  )
}
