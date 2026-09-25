// The keywords every host understands whether or not a plugin brings them: the
// series letter an id is printed with (`prefix`, @yaks/id), the property
// that is a name somebody may type (`by_name`, @yaks/names), and the relation
// an edge states (`edge`, @yaks/edge). Every package uses
// them in its `$vocabulary`, none registers them — and an unregistered keyword
// is silently ignored, so a host that skipped these would mint `entity.num` and
// then render `P-1` for a persona that declared `N`, having fallen back to the
// component's first letter. Minting the number and printing human-readable ids
// are both a host's doing, so registering the keywords that shape them is too:
// a graph this process composed (./host.ts), and a vocabulary a server reported
// to draw its answers with (./answer.ts). A plugin that supplies its own copy
// wins; this adds only the difference, never a second registration.

import { edgeKeywords } from '@yaks/edge/vocab'
import { idKeywords } from '@yaks/id'
import { nameKeywords } from '@yaks/names'
import type { Keywords } from '@yaks/vocab'

/** The keywords brought, and the ones every host understands beside them. */
export let understood = (brought: Keywords[] = []): Keywords[] => {
  let taken = new Set(brought.map((k) => k.uri))
  return [
    ...brought,
    ...[idKeywords, nameKeywords, edgeKeywords].filter((k) =>
      !taken.has(k.uri)
    ),
  ]
}
