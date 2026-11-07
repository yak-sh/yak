// The `@yaks/voipms/routes` facet: `GET /voipms/<key>`, where a number's SMS
// URL callback brings the texts that arrived, the `door.key` the config
// passes this plugin in its path, since voip.ms signs nothing.
import { type Routes, routes as doors } from '@yaks/phone/plugin'
import { provider } from './mod.ts'

export let routes: Routes = doors('voipms', provider)
