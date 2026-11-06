// The `@yaks/telnyx/graph` facet: the phone this plugin lends its host,
// named `telnyx`, which @yaks/phone selects with `sender: {"via": "telnyx"}`.
// The config passes this plugin its credentials (@yaks/phone/plugin `Lent`).
import { type Texters, texters as lending } from '@yaks/phone/plugin'
import { provider } from './mod.ts'

export let texters: Texters = lending('telnyx', provider)
