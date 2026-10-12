// App model providers and the Worker-backed transcript runner.
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { asking, planting } from '../models.ts'
import { maintenance } from '../used.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (at.meta || !at.app) return {}
  return {
    models_install: maintenance(async () => {
      let bundles = await planting(at.graph.read, at)
      if (bundles.length) await at.graph.apply(bundles, { trusted: true })
    }),
    ...asking(at),
  }
}
