// Who serves a generation and what it cost.
import type { Plugin } from '@yaks/graph'
import { modelDoc, models } from '@yaks/model'
export let vocab = modelDoc
export let rules = (): Plugin[] => [models()]
