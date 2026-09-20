// An agent at work: the transcript it leaves, the lease it holds, and the
// status read off its entries rather than stored.
import type { Plugin } from '@yaks/graph'
import { sessionDerived, sessionDoc, sessions } from '@yaks/session'
import type { Derived } from '@yaks/sql'

export let vocab = sessionDoc
export let derived = (): Derived => sessionDerived
export let rules = (): Plugin[] => [sessions()]
