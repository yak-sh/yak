/** Paper, the default skin: yak.sh's sheet besides its colours, its grain
 * laid over the kit's document defaults. Every part keeps the kit's
 * rendering; the skin only adds to the document's. */
import type { Skin } from './theme.ts'

export let paper: Skin = {
  base: { over: new URL('./paper/base.css', import.meta.url) },
}
