/**
 * The links every page makes to the vocabulary: a package's page, a
 * component's and a property's, by the eids their names derive (@yaks/vocab
 * identifies each `_package` and `_comp` by its name and each `_prop` by its
 * component and its name), so a name links to its page without asking the
 * graph where that is.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { identityEid } from '@yaks/graph'
import { Chip } from '@yaks/ui'
import type { Io } from './host.ts'
import { tone } from './read.ts'

/** The eid of the package named `name`. */
export let packEid = (name: string): string => identityEid('_package', [name])

/** The eid of the component named `name`. */
export let compEid = (name: string): string => identityEid('_comp', [name])

/** The eid of the property `prop` of the component named `name`. */
export let propEid = (name: string, prop: string): string =>
  identityEid('_prop', [compEid(name), prop])

/** A component's name in its hue, linked to its page. */
export let chip = (io: Io, name: string): JSX.Element =>
  h(Chip, { mod: tone(name), href: io.link(compEid(name)) }, name)

/** The components a vocabulary marks as edge relations (@yaks/edge). */
export let relations = (io: Io): string[] =>
  io.vocab.all.filter((n) => io.vocab.comp(n)?.keywords.edge != null)

/** Components' names, each in its hue and linked, joined: `doc + task`. */
export let chips = (io: Io, names: string[]): JSX.Element =>
  h('span', {}, names.flatMap((n, i) => [i ? ' + ' : null, chip(io, n)]))
