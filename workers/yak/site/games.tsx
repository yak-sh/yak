/** @jsxImportSource react */
// The landing page for people who would make a game to play with their
// friends: the home page's story (home.tsx `Told`) with its own words under
// `games` in the copy, its own demos and the features a game needs
// (@yaks/platform/home `GAMES`). It is a mockup until it is approved: no
// engine indexes it and nothing links to it. A sign-up offer goes under the
// hero's box once one is set: `offer: true` on GAMES and its words at
// `games.hello.offer`.
import { GAMES } from '@yaks/platform/home'
import { Told } from './home.tsx'

/** Where the page lives. */
export let PATH = '/games'

export let Games = () => (
  <Told copy='games' path={PATH} landing={GAMES} robots='noindex' />
)
