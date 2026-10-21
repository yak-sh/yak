// What this package draws, as @yaks/render registrations: a topic's page,
// wherever a page is asked for (`Topic`, the tab it opens on, and
// `Inspect.Page`); its tree (`Tree`); and how it reads in a topic's lists
// (`Topic.List.Tile`). Loaded only by an interface that draws them
// (./views.ts).

import { parse } from '@yaks/query'
import type { View } from '@yaks/inspect'
import { asks, TopicPage, TopicTile } from './page.ts'
import { TopicTree } from './tree.ts'
import { TOPIC } from './topic.ts'

let topic = parse(`.${TOPIC}`)

/** The views this package draws. */
export let inspectViews: View[] = [
  { view: 'Topic', match: topic, asks, Render: TopicPage },
  { view: 'Inspect.Page', match: topic, asks, Render: TopicPage },
  { view: 'Tree', match: topic, Render: TopicTree },
  { view: 'Topic.List.Tile', match: topic, Render: TopicTile },
]
