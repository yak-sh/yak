// The keywords every host understands whether or not a plugin brings them: the
// property that is a name somebody may type (`by_name`, @yaks/names), and the
// relation an edge states (`edge`, @yaks/edge), with the id vocabulary's URI
// (@yaks/id). Every package uses them in its `$vocabulary`, none registers them,
// and an unregistered keyword is silently ignored. Registering the keywords
// that shape what a host draws is a host's doing: a graph this process composed
// (@yaks/host), and a vocabulary a server reported to draw its answers with (the
// caller's renderer). A plugin that supplies its own copy wins; this adds only
// the difference, never a second registration.

import { edgeKeywords } from '@yaks/edge/vocab'
import { idKeywords } from '@yaks/id/vocab'
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
