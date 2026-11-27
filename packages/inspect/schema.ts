/**
 * The links every page makes to the vocabulary: a namespace's page, a
 * component's, a property's and an effect's, by the rows the vocabulary
 * describes them in (@yaks/vocab `rowsOf`): each word's identity, or where its
 * labels derive for a word without one, so a name links to its page without
 * asking the graph where that is.
 *
 * @module
 */

import { type ComponentChildren, Fragment, h, type JSX } from 'preact'
import { derivedEid } from '@yaks/graph/identity'
import { rowsOf, type Vocab } from '@yaks/vocab'
import { Body } from '@yaks/ui'
import type { Io } from './host.ts'

// Each vocabulary's rows, worked out once.
let held = new WeakMap<Vocab, ReturnType<typeof rowsOf>>()
let rows = (vocab: Vocab) =>
  held.get(vocab) ?? held.set(vocab, rowsOf(vocab, derivedEid)).get(vocab)!

/** The eid of the namespace labelled `name`. */
export let packEid = (vocab: Vocab, name: string): string =>
  rows(vocab).namespace(name)

/** The eid of the component named `name`. */
export let compEid = (vocab: Vocab, name: string): string =>
  rows(vocab).comp(name)

/** The eid of the effect named `name`. */
export let effectEid = (vocab: Vocab, name: string): string =>
  rows(vocab).effect(name)

/** The eid of the property `prop` of the component named `name`. */
export let propEid = (vocab: Vocab, name: string, prop: string): string =>
  rows(vocab).prop(name, prop)

/** A component's name in its hue, linked to its page. */
export let chip = (io: Io, name: string): JSX.Element => {
  let eid = compEid(io.vocab, name)
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
