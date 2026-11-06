// The `@yaks/telnyx/routes` facet: `POST /telnyx/webhook`, where telnyx
// posts texts that arrived and what became of those sent, verified with the
// `door.key` the config passes this plugin.
import { type Routes, routes as doors } from '@yaks/phone/plugin'
import { provider } from './mod.ts'

export let routes: Routes = doors('telnyx', provider)
