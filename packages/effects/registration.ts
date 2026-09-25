import type { Plugin } from '@yaks/graph'
import type { Handler, Slot } from './registry.ts'

/** What an observer says about itself. */
export type Policy = {
  /** What it does, available from registry introspection. */
  doc?: string
  /** Additional reads to gather for it before the batch commits. */
  wants?: Plugin['wants']
}

/** A component's related observers, registered and documented together. */
export type Registration = Policy & {
  /** The component appeared. */
  created?: Handler
  /** A patch carried one of these properties. */
  changed?: Record<string, Handler>
  /** The component went away. */
  removed?: Handler
}

/** One entry in the registry's documentation, derived from its slots. */
export type Description = {
  comp: string
  hooks: string[]
  doc?: string
}

/** Read grouped hooks back from the slots, not from a second list. */
export let describe = (slots: Slot[]): Description[] => {
  let groups = new Map<string, Description>()
  for (let s of slots) {
    let key = s.group ?? s.id
    let d = groups.get(key)
    if (!d) {
      d = { comp: s.comp, hooks: [], doc: s.doc }
      groups.set(key, d)
    }
    let props = s.props?.length ? `(${s.props.join(', ')})` : ''
    d.hooks.push(`${s.kind}${props}`)
  }
  return [...groups.values()]
}
