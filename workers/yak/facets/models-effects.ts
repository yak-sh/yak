// App model providers and the Worker-backed transcript runner.
import type { Handler, Handlers } from '@yaks/effects'
import { lazy } from '@yaks/fp'
import type { Options } from './store.ts'
import { planting } from '../provider-names.ts'
import { maintenance } from '@yaks/platform/lent'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (at.meta || !at.app) return {}
  // Writes can queue turns before the first effect needs the model runner.
  let asking = lazy(async () => (await import('../models.ts')).asking(at))
  let turn = (name: string): Handler => async (...args) =>
    (await asking())[name](...args)
  return {
    models_install: maintenance(async () => {
      let bundles = await planting(at.graph.read, at)
      if (bundles.length) await at.graph.apply(bundles, { trusted: true })
    }),
    session_input: turn('session_input'),
    session_run: turn('session_run'),
    session_resume: turn('session_resume'),
    session_result: turn('session_result'),
  }
}
