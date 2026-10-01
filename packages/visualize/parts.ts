/** Client projection of a supplied contract, never another composition mapper. */
import type { Event } from '@yaks/trace'
import { GROUPS, type Snapshot } from './snapshot.ts'

export type Node = {
  id: string
  name: string
  group: string
  package?: string
  facet?: string
  declared: boolean
  loaded: boolean
  bound: boolean
  description?: string
  detail: Record<string, unknown>
}
export type Edge = { id: string; from: string; to: string; kind: string }
export let phases = [
  'normalize',
  'admit',
  'mint',
  'prepare',
  'precondition',
  'rules',
  'mutate',
  'cascade',
  'stamp',
  'journal',
  'commit',
  'effect',
  'audit',
] as const

/** These labels explain the pipeline. They are not observed bound handlers. */
export let spine = (): Node[] =>
  phases.map((name, order) => ({
    id: `phase:${name}`,
    name,
    group: 'phases',
    declared: true,
    loaded: false,
    bound: false,
    description: name == 'audit'
      ? 'Rollback notification, not the continuation of a successful apply.'
      : 'A pipeline label, not a claim that a handler is bound.',
    detail: {
      phase: name,
      order,
      path: name == 'audit' ? 'rollback' : 'apply',
    },
  }))

export let parts = (source: Snapshot): Node[] => [
  ...GROUPS.flatMap((group) =>
    source.anatomy[group].map((part): Node => {
      let {
        id,
        name,
        package: owner,
        facet,
        declared,
        loaded,
        bound,
        description,
        ...detail
      } = part
      return {
        id,
        name,
        group,
        package: owner,
        facet,
        declared,
        loaded,
        bound,
        description,
        detail: {
          ...detail,
          observed: source.coverage.observed[group] === true,
        },
      }
    })
  ),
  ...spine(),
]

/** Resolve only exact, unambiguous declared names. Unknown is not inferred. */
export let located = (event: Event, nodes: Node[]): string | undefined => {
  if (event.kind == 'phase') {
    let name = event.name.split('.').at(-1)
    if (phases.some((p) => p == name)) return `phase:${name}`
    return
  }
  let group =
    ({ rule: 'rules', effect: 'effects', request: 'routes' } as Record<
      string,
      string
    >)[event.kind]
  let candidates = group
    ? nodes.filter((n) =>
      n.group == group && n.name == event.name &&
      (!event.package || n.package == event.package)
    )
    : []
  if (candidates.length == 1) return candidates[0].id
  if (event.plugin || event.package) {
    let owners = nodes.filter((n) =>
      n.group == 'packages' &&
      n.name == (event.package ?? event.plugin)
    )
    if (owners.length == 1) return owners[0].id
  }
}
