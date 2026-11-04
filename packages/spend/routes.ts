/**
 * `/spend`: the Spend page at an address a person can type, and the line
 * `yak serve` prints beside it when it starts listening, so someone who came
 * for the page finds it without knowing the browsing app's `/?page=spend`
 * (./views.ts `destinations`).
 *
 * @module
 */
import type { Route } from '@yaks/api'

/// routes()[0].handle(new Request('http://x/spend')).headers.get('location') -> '/?page=spend'
/** The page's address, sent on to the browsing app. */
export let routes = (): Route[] => [{
  method: 'GET',
  path: '/spend',
  handle: () =>
    new Response(null, { status: 302, headers: { location: '/?page=spend' } }),
  says: 'what your agents spent: Claude Code and Codex, by day and model',
}]
