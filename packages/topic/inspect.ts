// What this package draws, as @yaks/render registrations: the shelves of
// every topic (`Topics.Page`, the page the sidebar offers); a topic's page
// beside them (`Topic`, the tab it opens on), and alone wherever a page is
// asked for without the shelves (`Inspect.Page`, `Card.Topic`); its tree
// (`Tree`); and how it reads in a topic's lists (`Topic.List.Tile`). Loaded
// only by an interface that draws them (./views.ts).

import { parse } from '@yaks/query'
import type { View } from '@yaks/inspect'
import { ShelvedPage, TopicsPage } from './catalogue.ts'
import { asks, TopicPage, TopicTile } from './page.ts'
import { TopicTree } from './tree.ts'
import { TOPIC } from './topic.ts'

let topic = parse(`.${TOPIC}`)

/** The views this package draws. */
export let inspectViews: View[] = [
  { view: 'Topics.Page', match: true, Render: TopicsPage },
  { view: 'Topic', match: topic, asks, Render: ShelvedPage },
  { view: 'Card.Topic', match: topic, asks, Render: TopicPage },
  { view: 'Inspect.Page', match: topic, asks, Render: TopicPage },
  { view: 'Tree', match: topic, Render: TopicTree },
  { view: 'Topic.List.Tile', match: topic, Render: TopicTile },
]
