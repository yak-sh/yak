// What packages offer the app's places from their `./views` facets, beside
// their renderers: the owner's home page, the tabs on what their views draw
// and the pages the sidebar lists. The door sets them once, before the app
// paints (./inspect.tsx `contribute`); a config whose packages offer none
// leaves `/` the host's own list and every entity on the app's own tabs.
import type { Bundle, Io } from '@yaks/inspect'
import type { Destination } from '../navigation.ts'

/** A view a package offers as a place: a tab on each entity it draws. */
export type Offer = {
  /** the view drawn there */
  view: string
  /** the glyph its tab or sidebar line wears, by name (./icons.tsx) */
  icon: string
  /** how many things wait there for the entity drawn: a hook, called as the
   * place paints, through the same `io` as the package's views; undefined
   * while it is unknown */
  waiting?: (e: Bundle, io: Io) => number | undefined
}

/** The owner's home page: `/` draws the owner in `view`, and the sidebar's
 * first line is `name`, wearing `icon` and what waits there. */
export type Home = Offer & { name: string }

let offered: { home?: Home; tabs: Offer[]; destinations: Destination[] } = {
  tabs: [],
  destinations: [],
}

/** Set what the configured packages offer: a home page, and every tab and
 * destination in the order the packages come. */
export let offerPlaces = (
  { home, tabs = [], destinations = [] }: {
    home?: Home
    tabs?: Offer[]
    destinations?: Destination[]
  },
): void => {
  offered = { home, tabs, destinations }
}

/** The home page a package offers, if one does. */
export let homeOffer = (): Home | undefined => offered.home

/** The tabs packages offer, ahead of the app's own. */
export let tabOffers = (): Offer[] => offered.tabs

/** The pages packages list in the sidebar. */
export let destinationOffers = (): Destination[] => offered.destinations
