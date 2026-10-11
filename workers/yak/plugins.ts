// The Worker's application contributions, in door precedence order. Store
// graph and effects facets are composed independently from config.ts.
import { attributionPlugin } from './attribution.ts'
import { connectionsPlugin } from './connections.ts'
import { buildersPlugin } from './builders.ts'
import { gitPlugin } from './git.ts'
import { memoryPlugin } from './memory.ts'
import { meterPlugin } from './meter.ts'
import { modelsPlugin } from './models.ts'
import { outboundPlugin } from './outbound.ts'
import type { Plugin } from './plugin.ts'
import { rtcPlugin } from './rtc.ts'
import { seoPlugin } from './seo_door.ts'
import { trashPlugin } from './trash.ts'
import { tunnelPlugin } from './tunnel_door.ts'
import { viewsPlugin } from './views.ts'

export let PLUGINS: Plugin[] = [
  memoryPlugin,
  viewsPlugin,
  trashPlugin,
  meterPlugin,
  seoPlugin,
  gitPlugin,
  connectionsPlugin,
  outboundPlugin,
  tunnelPlugin,
  modelsPlugin,
  buildersPlugin,
  rtcPlugin,
  attributionPlugin,
]
