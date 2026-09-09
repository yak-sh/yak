// THE list. Every domain of this Worker that says what it contributes as data
// (plugin.ts) is named here, once, and the host modules read the list instead
// of naming a domain each: vocab.ts folds in the words, tools.ts the rows,
// guide.ts the pages, apps.ts the doors at an app's address and the watchers,
// index.ts the doors at a root, graph.ts the rules and the effects.
//
// Order is precedence where two plugins could answer the same thing, so the
// list is read top to bottom and a new plugin goes at the end unless it means
// to come first.
//
// This module is nothing but the list, on purpose: everything it imports is a
// domain, and everything that imports it is a host, so the one file that knows
// both sides knows nothing else.
import { gitPlugin } from './git.ts'
import { memoryPlugin } from './memory.ts'
import { meterPlugin } from './meter.ts'
import { outboxPlugin } from './outbox.ts'
import type { Plugin } from './plugin.ts'
import { seoPlugin } from './seo_door.ts'
import { trashPlugin } from './trash.ts'
import { viewsPlugin } from './views.ts'

export let PLUGINS: Plugin[] = [
  memoryPlugin,
  viewsPlugin,
  trashPlugin,
  meterPlugin,
  outboxPlugin,
  seoPlugin,
  gitPlugin,
]
