/** @jsxImportSource preact */
// @ts-types="@yaks/ui/lucide"
import ArrowUpRight from 'lucide/dist/esm/icons/arrow-up-right.mjs'
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
// @ts-types="@yaks/ui/lucide"
import AlarmClock from 'lucide/dist/esm/icons/alarm-clock.mjs'
// @ts-types="@yaks/ui/lucide"
import BookOpen from 'lucide/dist/esm/icons/book-open.mjs'
// @ts-types="@yaks/ui/lucide"
import Activity from 'lucide/dist/esm/icons/activity.mjs'
// @ts-types="@yaks/ui/lucide"
import Bookmark from 'lucide/dist/esm/icons/bookmark.mjs'
// @ts-types="@yaks/ui/lucide"
import Bot from 'lucide/dist/esm/icons/bot.mjs'
// @ts-types="@yaks/ui/lucide"
import Box from 'lucide/dist/esm/icons/box.mjs'
// @ts-types="@yaks/ui/lucide"
import Braces from 'lucide/dist/esm/icons/braces.mjs'
// @ts-types="@yaks/ui/lucide"
import Bug from 'lucide/dist/esm/icons/bug.mjs'
// @ts-types="@yaks/ui/lucide"
import CircleAlert from 'lucide/dist/esm/icons/circle-alert.mjs'
// @ts-types="@yaks/ui/lucide"
import CircleX from 'lucide/dist/esm/icons/circle-x.mjs'
// @ts-types="@yaks/ui/lucide"
import Clock from 'lucide/dist/esm/icons/clock.mjs'
// @ts-types="@yaks/ui/lucide"
import Columns2 from 'lucide/dist/esm/icons/columns-2.mjs'
// @ts-types="@yaks/ui/lucide"
import Columns3 from 'lucide/dist/esm/icons/columns-3.mjs'
// @ts-types="@yaks/ui/lucide"
import Database from 'lucide/dist/esm/icons/database.mjs'
// @ts-types="@yaks/ui/lucide"
import Drama from 'lucide/dist/esm/icons/drama.mjs'
// @ts-types="@yaks/ui/lucide"
import EllipsisVertical from 'lucide/dist/esm/icons/ellipsis-vertical.mjs'
// @ts-types="@yaks/ui/lucide"
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
// @ts-types="@yaks/ui/lucide"
import Folder from 'lucide/dist/esm/icons/folder.mjs'
// @ts-types="@yaks/ui/lucide"
import Globe from 'lucide/dist/esm/icons/globe.mjs'
// @ts-types="@yaks/ui/lucide"
import Hash from 'lucide/dist/esm/icons/hash.mjs'
// @ts-types="@yaks/ui/lucide"
import History from 'lucide/dist/esm/icons/rotate-ccw-clock.mjs'
// @ts-types="@yaks/ui/lucide"
import House from 'lucide/dist/esm/icons/house.mjs'
// @ts-types="@yaks/ui/lucide"
import Image from 'lucide/dist/esm/icons/image.mjs'
// @ts-types="@yaks/ui/lucide"
import Kanban from 'lucide/dist/esm/icons/kanban.mjs'
// @ts-types="@yaks/ui/lucide"
import LayoutDashboard from 'lucide/dist/esm/icons/layout-dashboard.mjs'
// @ts-types="@yaks/ui/lucide"
import Lightbulb from 'lucide/dist/esm/icons/lightbulb.mjs'
// @ts-types="@yaks/ui/lucide"
import List from 'lucide/dist/esm/icons/list.mjs'
// @ts-types="@yaks/ui/lucide"
import Map from 'lucide/dist/esm/icons/map.mjs'
// @ts-types="@yaks/ui/lucide"
import Menu from 'lucide/dist/esm/icons/menu.mjs'
// @ts-types="@yaks/ui/lucide"
import MessageCircle from 'lucide/dist/esm/icons/message-circle.mjs'
// @ts-types="@yaks/ui/lucide"
import ScanSearch from 'lucide/dist/esm/icons/scan-search.mjs'
// @ts-types="@yaks/ui/lucide"
import Plus from 'lucide/dist/esm/icons/plus.mjs'
// @ts-types="@yaks/ui/lucide"
import Search from 'lucide/dist/esm/icons/search.mjs'
// @ts-types="@yaks/ui/lucide"
import Settings from 'lucide/dist/esm/icons/settings.mjs'
// @ts-types="@yaks/ui/lucide"
import Shapes from 'lucide/dist/esm/icons/shapes.mjs'
// @ts-types="@yaks/ui/lucide"
import SquareCheck from 'lucide/dist/esm/icons/square-check.mjs'
// @ts-types="@yaks/ui/lucide"
import Stamp from 'lucide/dist/esm/icons/stamp.mjs'
// @ts-types="@yaks/ui/lucide"
import Star from 'lucide/dist/esm/icons/star.mjs'
// @ts-types="@yaks/ui/lucide"
import Table from 'lucide/dist/esm/icons/table.mjs'
// @ts-types="@yaks/ui/lucide"
import Workflow from 'lucide/dist/esm/icons/workflow.mjs'
// @ts-types="@yaks/ui/lucide"
import X from 'lucide/dist/esm/icons/x.mjs'

let glyphs: Record<string, IconNode> = {
  'alarm-clock': AlarmClock,
  'square-check': SquareCheck,
  'circle-alert': CircleAlert,
  'circle-x': CircleX,
  lightbulb: Lightbulb,
  stamp: Stamp,
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
  'scan-search': ScanSearch,
  drama: Drama,
  search: Search,
  shapes: Shapes,
  'ellipsis-vertical': EllipsisVertical,
  bot: Bot,
  'book-open': BookOpen,
  box: Box,
  workflow: Workflow,
  settings: Settings,
  'arrow-up-right': ArrowUpRight,
  activity: Activity,
  bookmark: Bookmark,
  bug: Bug,
  clock: Clock,
  database: Database,
  folder: Folder,
  house: House,
  plus: Plus,
  star: Star,
  x: X,
}

/** Learn glyphs a package names for what it offers (its `./views` facet's
 * `icons`), beside the app's own; a name the app already draws keeps its
 * glyph. */
export let learnGlyphs = (more: Record<string, IconNode>): void => {
  for (let [name, glyph] of Object.entries(more)) glyphs[name] ??= glyph
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
