/**
 * The links every page makes to the vocabulary: a package's page, a
 * component's, a property's and an effect's, by the eids their names derive
 * (@yaks/vocab identifies each `_package`, `_comp` and `_effect` by its name
 * and each `_prop` by its component and its name), so a name links to its page
 * without asking the graph where that is.
 *
 * @module
 */

import { type ComponentChildren, Fragment, h, type JSX } from 'preact'
import { identityEid } from '@yaks/graph/identity'
import { Body } from '@yaks/ui'
import type { Io } from './host.ts'

/** The eid of the package named `name`. */
export let packEid = (name: string): string => identityEid('_package', [name])

/** The eid of the component named `name`. */
export let compEid = (name: string): string => identityEid('_comp', [name])

/** The eid of the effect named `name`. */
export let effectEid = (name: string): string => identityEid('_effect', [name])

/** The eid of the property `prop` of the component named `name`. */
export let propEid = (name: string, prop: string): string =>
  identityEid('_prop', [compEid(name), prop])

/** A component's name in its hue, linked to its page. */
export let chip = (io: Io, name: string): JSX.Element => {
  let eid = compEid(name)
  let b = io.get(eid) ?? { entity: { eid }, _comp: { name } }
  return io.show(b, 'Inspect.Reference.Inline') as JSX.Element
}

/** The components a vocabulary marks as edge relations (@yaks/edge). */
export let relations = (io: Io): string[] =>
  io.vocab.all.filter((n) => io.vocab.comp(n)?.keywords.edge != null)

/** Components' names, each in its hue and linked, joined: `doc + task`. */
export let chips = (io: Io, names: string[]): JSX.Element =>
  h('span', {}, names.flatMap((n, i) => [i ? ' + ' : null, chip(io, n)]))

/** What a vocabulary entity's page says of it, as its head's sub: its words,
 * then its facts (its package, how it is kept) on a line of their own. */
export let described = (
  text: ComponentChildren,
  facts: ComponentChildren[],
): ComponentChildren[] => [text, h('br', {}), ...facts]

/** The same, as the body of a page another head tops (a Full page's): its
 * words read in the ink, its facts a quiet line under them. */
export let Described = (
  { text, facts }: { text: ComponentChildren; facts: ComponentChildren[] },
): JSX.Element =>
  h(
    Fragment,
    null,
    text ? h(Body, {}, text) : null,
    h(Body, { mod: 'short' }, ...facts),
  )
