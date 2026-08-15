// The app's icon vocabulary. Lucide owns the SVGs; this small name map keeps
// entity views data-driven and gives unknown views the document face.
import {
  AlarmClock,
  Bot,
  Braces,
  Bug,
  CircleAlert,
  CircleX,
  Columns2,
  Columns3,
  Drama,
  EllipsisVertical,
  FileText,
  Globe,
  Hash,
  History,
  Inbox,
  Kanban,
  LayoutDashboard,
  Lightbulb,
  List,
  type LucideIcon,
  Map,
  Menu,
  MessageCircle,
  Search,
  Shapes,
  SquareCheck,
  Stamp,
  Table,
} from 'lucide-preact'

let glyphs: Record<string, LucideIcon> = {
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
  braces: Braces,
  bug: Bug,
  drama: Drama,
  search: Search,
  shapes: Shapes,
  'ellipsis-vertical': EllipsisVertical,
  bot: Bot,
}

export let Icon = (
  { name, size = 14 }: { name: string; size?: number },
) => {
  let Glyph = glyphs[name] ?? FileText
  return <Glyph class='Icon' size={size} />
}
