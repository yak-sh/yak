// The canvas, the cards on it, and where each client is looking.
import type { Plugin } from '@yaks/graph'
import { canvas, canvasDoc } from '@yaks/canvas'
export let vocab = canvasDoc
export let rules = (): Plugin[] => [canvas()]
