/** Paper, the default skin: yak.sh's sheet besides its colours, its grain
 * (paper/grain.css, which pencil shares) and its links and headings laid
 * over the kit's document defaults. Every part keeps the kit's rendering;
 * the skin only adds to the document's. */
import type { Skin } from './theme.ts'

export let paper: Skin = {
  base: {
    over: [
      new URL('./paper/grain.css', import.meta.url),
      new URL('./paper/base.css', import.meta.url),
    ],
  },
}
