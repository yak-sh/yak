/**
 * A session drawn as its conversation, wherever a host asks the registry for
 * its `Conversation` view: it asks for the session's entries, makes them
 * lines with `joined`, draws each with the kinds of ./conversation.ts, and
 * hands them to @yaks/ux's `Conversation`, which holds where its reader is.
 * A host with words of its own (the Operator's) registers a more specific
 * `Conversation` view of its own.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { parse } from '@yaks/query/core'
import type { Props, View } from '@yaks/inspect'
import { Conversation, conversationAt } from '@yaks/ux'
import { draw, joined, kinds, namer } from './conversation.ts'
import { ENTRY } from './native.ts'
import { SESSION } from './comp.ts'

/** What it asks for: the session's entries, in its order. */
export let asked = (session: string): string =>
  `.${ENTRY}.session=${session}&*&.order=${ENTRY}.seq`

// The session's entries, each line drawn as every transcript draws it.
let Talk = ({ e, io }: Props): JSX.Element => {
  let session = e.entity.eid
  let got = io.ask({ entries: asked(session) })
  let names = namer({})
  let lines = joined(got.entries?.rows ?? []).flatMap(({ entry, result }) => {
    let said = draw(kinds, entry, { result, names })
    return said ? [{ id: entry.entity.eid, node: said.node }] : []
  })
  let at = conversationAt('session', session)
  return h(Conversation, {
    e: io.state(at) ?? { entity: { eid: at } },
    onChange: (b) => io.set([b]),
    state: io.state,
    lines,
  })
}

/** A session as its conversation. */
export let conversationViews: View[] = [
  { view: 'Conversation', match: parse(`.${SESSION}`), Render: Talk },
]
