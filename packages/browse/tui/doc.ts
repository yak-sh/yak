// The terminal's document: @yaks/tui's fake DOM, installed as `document` the
// moment this module loads, so import it before anything renders. `root` is
// what the app renders into and the painter reads.
import { install } from '@yaks/tui'

export let { root } = install()
