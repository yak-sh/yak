// The routes facet, exported as `@yaks/tunnel/routes`: the machine's end of a
// tunnel, imported by its `yak` wherever it serves `web`. Its server then
// answers a request the tunnel's gateway marked only at the paths the config
// opens (`routes`, URLPattern pathnames), and refuses the rest before any
// route sees them (./filter.ts). `/apply` and `/query` stay closed to the
// tunnel unless the machine's owner lists them; a request that did not come
// through the tunnel is untouched.
import { filter as only } from './filter.ts'

/** What a config file can set for this facet. */
export type Options = {
  /** the paths the tunnel answers, as URLPattern pathnames; none opens
   * nothing */
  routes?: string[]
}

/** The tunnel's filter, over the paths the config opens. */
export let filter = (
  _host: unknown,
  options: Options = {},
): (req: Request) => void => only(options.routes)
