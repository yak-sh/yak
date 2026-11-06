// The `@yaks/pinnacle/routes` facet: `POST /pinnacle/webhook`, where pinnacle
// posts texts that arrived and what became of those sent, verified with the
// `door.key` the config passes this plugin.
import { type Routes, routes as doors } from '@yaks/phone/plugin'
import { provider } from './mod.ts'

export let routes: Routes = doors('pinnacle', provider)
