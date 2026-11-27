/**
 * The site the page React is drawing is on (@yaks/markdown/away `Site`), for
 * a page drawn where there is no `location` to read it from: a server gives
 * it once at the page's edge, and every Markdown link and kit part beneath
 * opens another site's address in a new tab by it.
 *
 * @module
 */
import { type Context, createContext } from 'react'
import type { Site as Hosts } from './away.ts'

/** The hosts that are the page's own site; unset, the location's. */
export let Site: Context<Hosts | undefined> = createContext<
  Hosts | undefined
>(undefined)
