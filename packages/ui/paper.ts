/** Paper, the default skin: yak.sh's sheet besides its colours, its grain
 * (paper/grain.css, which pencil shares) and its links and headings laid
 * over the kit's document defaults. Every part keeps the kit's rendering;
 * the skin only adds to the document's. */
import { beside, type Skin } from './theme.ts'

let at = beside(import.meta.url)

export let paper: Skin = {
  base: {
    over: [
      at('./paper/grain.css'),
      at('./paper/base.css'),
    ],
  },
}
