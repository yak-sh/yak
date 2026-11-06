// The `@yaks/voipms/graph` facet: the texter this plugin lends its host,
// named `voipms`, which @yaks/phone selects with `sender: {"via": "voipms"}`.
// The config passes this plugin its credentials (@yaks/phone/plugin `Lent`).
import { type Texters, texters as lending } from '@yaks/phone/plugin'
import { provider } from './mod.ts'

export let texters: Texters = lending('voipms', provider)
