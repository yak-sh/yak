/** Browser-safe game UI contribution: display-only HUD parts, their CSS,
 * terminal entries and specimens. Consumers choose a theme and skin. */
import { kit } from './hud.ts'

/** Installed plugins contribute the game HUD kit to the style guide. */
export let kits = { game: kit }
