// The app's icon vocabulary. Lucide owns the SVGs; this small name map keeps
// entity views data-driven and gives unknown views the document face.
//
// Each icon is its own module of Lucide's SVG nodes, imported by path. The
// package's barrel re-exports all ~1,800 icons, and a named import from it
// still loads every one: in each test process that renders a card, and in
// every bundle of the app, where esbuild resolved ~3,500 modules for these
// thirty-odd.
import { h } from 'preact'
import type { IconNode } from 'lucide'
import AlarmClock from 'lucide/dist/esm/icons/alarm-clock.mjs'
import BookOpen from 'lucide/dist/esm/icons/book-open.mjs'
import Bot from 'lucide/dist/esm/icons/bot.mjs'
import Box from 'lucide/dist/esm/icons/box.mjs'
import Braces from 'lucide/dist/esm/icons/braces.mjs'
import Bug from 'lucide/dist/esm/icons/bug.mjs'
import CircleAlert from 'lucide/dist/esm/icons/circle-alert.mjs'
import CircleX from 'lucide/dist/esm/icons/circle-x.mjs'
import Columns2 from 'lucide/dist/esm/icons/columns-2.mjs'
import Columns3 from 'lucide/dist/esm/icons/columns-3.mjs'
import Drama from 'lucide/dist/esm/icons/drama.mjs'
import EllipsisVertical from 'lucide/dist/esm/icons/ellipsis-vertical.mjs'
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
import Globe from 'lucide/dist/esm/icons/globe.mjs'
import Hash from 'lucide/dist/esm/icons/hash.mjs'
import History from 'lucide/dist/esm/icons/rotate-ccw-clock.mjs'
import Image from 'lucide/dist/esm/icons/image.mjs'
import Inbox from 'lucide/dist/esm/icons/inbox.mjs'
import Kanban from 'lucide/dist/esm/icons/kanban.mjs'
import LayoutDashboard from 'lucide/dist/esm/icons/layout-dashboard.mjs'
import Lightbulb from 'lucide/dist/esm/icons/lightbulb.mjs'
import List from 'lucide/dist/esm/icons/list.mjs'
import Map from 'lucide/dist/esm/icons/map.mjs'
import Menu from 'lucide/dist/esm/icons/menu.mjs'
import MessageCircle from 'lucide/dist/esm/icons/message-circle.mjs'
import Search from 'lucide/dist/esm/icons/search.mjs'
import Settings from 'lucide/dist/esm/icons/settings.mjs'
import Shapes from 'lucide/dist/esm/icons/shapes.mjs'
import SquareCheck from 'lucide/dist/esm/icons/square-check.mjs'
import Stamp from 'lucide/dist/esm/icons/stamp.mjs'
import Table from 'lucide/dist/esm/icons/table.mjs'
import Workflow from 'lucide/dist/esm/icons/workflow.mjs'

let glyphs: Record<string, IconNode> = {
  'alarm-clock': AlarmClock,
  'square-check': SquareCheck,
  'circle-alert': CircleAlert,
  'circle-x': CircleX,
  lightbulb: Lightbulb,
  stamp: Stamp,
  inbox: Inbox,
  table: Table,
  map: Map,
  'message-circle': MessageCircle,
  list: List,
  menu: Menu,
  'layout-dashboard': LayoutDashboard,
  'columns-2': Columns2,
  'columns-3': Columns3,
  kanban: Kanban,
  'file-text': FileText,
  globe: Globe,
  hash: Hash,
  history: History,
  image: Image,
  braces: Braces,
  bug: Bug,
  drama: Drama,
  search: Search,
  shapes: Shapes,
  'ellipsis-vertical': EllipsisVertical,
  bot: Bot,
  'book-open': BookOpen,
  box: Box,
  workflow: Workflow,
  settings: Settings,
}

/** One glyph as Lucide draws it: a 24-unit stroked SVG, sized in pixels. */
export let Icon = (
  { name, size = 14 }: { name: string; size?: number },
) => {
  let known = name in glyphs ? name : 'file-text'
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      stroke-width='2'
      stroke-linecap='round'
      stroke-linejoin='round'
      class={`lucide lucide-${known} Icon`}
      aria-hidden='true'
    >
      {glyphs[known].map(([tag, attrs]) => h(tag, attrs))}
    </svg>
  )
}
