/** UX kits describe controlled components and the page-only words they own.
 * A kit carries declarations, not a store: the page loads its vocabulary and
 * names each instance's entity. Drafts stay with the host, outside kit state.
 * @module
 */

import type { VNode } from 'preact'
import { storable, type VocabDoc } from '@yaks/vocab'

/** A labelled tree, drawn by the guide within its own composition. */
export type Specimen = [label: string, node: VNode]

/** Metadata for one controlled component. Props remain on its own export;
 * this erased component reference is for discovery, not invocation. */
export type Piece = {
  Component: (props: never) => VNode | null
  description: string
  specimens: () => Specimen[]
  /** CamelCase state and event components declared in this kit's vocabulary. */
  state: string[]
}

/** A bringer's components and vocabulary, usable without a plugin host. */
export type Kit = {
  description: string
  components: Record<string, Piece>
  vocab: VocabDoc
}

/** Check the kit boundary before exposing it to a page. Every state word
 * belongs to the bringer, is CamelCase, and stays off the wire. */
export let defineKit = <T extends Kit>(kit: T): T => {
  for (let [word, schema] of Object.entries(kit.vocab.$defs ?? {})) {
    if (schema.rule || schema.effect || schema.tool) {
      throw new Error(
        `${word}: a kit brings state, not rules, effects or tools`,
      )
    }
    if (!schema.component) continue
    if (!/^[A-Z][A-Za-z0-9]*$/.test(word)) {
      throw new Error(`${word}: kit state must be a CamelCase component`)
    }
    if (schema.sync != 'none') {
      throw new Error(`${word}: kit state must declare sync: none`)
    }
    if (!schema.durable || schema.durable == 'forever') {
      throw new Error(`${word}: kit state must declare a page lifetime`)
    }
  }
  let errors = storable(kit.vocab)
  if (errors.length) throw new Error(errors.join('; '))
  for (let [name, piece] of Object.entries(kit.components)) {
    for (let word of piece.state) {
      let schema = kit.vocab.$defs?.[word]
      if (!/^[A-Z][A-Za-z0-9]*$/.test(word) || !schema?.component) {
        throw new Error(`${name}: ${word} must declare a CamelCase component`)
      }
      if (schema.sync != 'none') {
        throw new Error(`${name}: ${word} must declare sync: none`)
      }
    }
  }
  return kit
}

/** The documents a page loads beside its domain vocabulary. */
export let kitDocs = (
  kits: Record<string, Kit>,
): VocabDoc[] => [
  ...new Set(Object.values(kits).map((kit) => defineKit(kit).vocab)),
]
