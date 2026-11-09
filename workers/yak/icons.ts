// The public pages' icon vocabulary, drawn from Lucide's SVG nodes. Each icon
// is its own module, imported by path: the package's barrel re-exports all
// ~1,800 icons, and every module that reaches this one (the kernel does) would
// load them all. The kit's Icon draws one inline from its nodes, and the style
// guide's external sprite shares the same paths, without any browser
// JavaScript.
import type { IconNode } from 'lucide'
// @ts-types="@yaks/ui/lucide"
import Bell from 'lucide/dist/esm/icons/bell.mjs'
// @ts-types="@yaks/ui/lucide"
import Bot from 'lucide/dist/esm/icons/bot.mjs'
// @ts-types="@yaks/ui/lucide"
import ChartNoAxesColumnIncreasing from 'lucide/dist/esm/icons/chart-no-axes-column-increasing.mjs'
// @ts-types="@yaks/ui/lucide"
import Check from 'lucide/dist/esm/icons/check.mjs'
// @ts-types="@yaks/ui/lucide"
import ChevronLeft from 'lucide/dist/esm/icons/chevron-left.mjs'
// @ts-types="@yaks/ui/lucide"
import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'
// @ts-types="@yaks/ui/lucide"
import ChevronsUpDown from 'lucide/dist/esm/icons/chevrons-up-down.mjs'
// @ts-types="@yaks/ui/lucide"
import CreditCard from 'lucide/dist/esm/icons/credit-card.mjs'
// @ts-types="@yaks/ui/lucide"
import Download from 'lucide/dist/esm/icons/download.mjs'
// @ts-types="@yaks/ui/lucide"
import ExternalLink from 'lucide/dist/esm/icons/external-link.mjs'
// @ts-types="@yaks/ui/lucide"
import Eye from 'lucide/dist/esm/icons/eye.mjs'
// @ts-types="@yaks/ui/lucide"
import EyeOff from 'lucide/dist/esm/icons/eye-off.mjs'
// @ts-types="@yaks/ui/lucide"
import Globe from 'lucide/dist/esm/icons/globe.mjs'
// @ts-types="@yaks/ui/lucide"
import House from 'lucide/dist/esm/icons/house.mjs'
// @ts-types="@yaks/ui/lucide"
import LayoutGrid from 'lucide/dist/esm/icons/layout-grid.mjs'
// @ts-types="@yaks/ui/lucide"
import MessageCircle from 'lucide/dist/esm/icons/message-circle.mjs'
// @ts-types="@yaks/ui/lucide"
import MessageSquare from 'lucide/dist/esm/icons/message-square.mjs'
// @ts-types="@yaks/ui/lucide"
import Mail from 'lucide/dist/esm/icons/mail.mjs'
// @ts-types="@yaks/ui/lucide"
import Mic from 'lucide/dist/esm/icons/mic.mjs'
// @ts-types="@yaks/ui/lucide"
import Phone from 'lucide/dist/esm/icons/phone.mjs'
// @ts-types="@yaks/ui/lucide"
import CircleQuestionMark from 'lucide/dist/esm/icons/circle-question-mark.mjs'
// @ts-types="@yaks/ui/lucide"
import LogOut from 'lucide/dist/esm/icons/log-out.mjs'
// @ts-types="@yaks/ui/lucide"
import PanelLeftClose from 'lucide/dist/esm/icons/panel-left-close.mjs'
// @ts-types="@yaks/ui/lucide"
import PanelLeftOpen from 'lucide/dist/esm/icons/panel-left-open.mjs'
// @ts-types="@yaks/ui/lucide"
import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
// @ts-types="@yaks/ui/lucide"
import Plug from 'lucide/dist/esm/icons/plug.mjs'
// @ts-types="@yaks/ui/lucide"
import Play from 'lucide/dist/esm/icons/play.mjs'
// @ts-types="@yaks/ui/lucide"
import Plus from 'lucide/dist/esm/icons/plus.mjs'
// @ts-types="@yaks/ui/lucide"
import QrCode from 'lucide/dist/esm/icons/qr-code.mjs'
// @ts-types="@yaks/ui/lucide"
import Receipt from 'lucide/dist/esm/icons/receipt.mjs'
// @ts-types="@yaks/ui/lucide"
import Settings2 from 'lucide/dist/esm/icons/settings-2.mjs'
// @ts-types="@yaks/ui/lucide"
import Share2 from 'lucide/dist/esm/icons/share-2.mjs'
// @ts-types="@yaks/ui/lucide"
import Shield from 'lucide/dist/esm/icons/shield.mjs'
// @ts-types="@yaks/ui/lucide"
import SlidersHorizontal from 'lucide/dist/esm/icons/sliders-horizontal.mjs'
// @ts-types="@yaks/ui/lucide"
import Trash2 from 'lucide/dist/esm/icons/trash-2.mjs'
// @ts-types="@yaks/ui/lucide"
import User from 'lucide/dist/esm/icons/user.mjs'
// @ts-types="@yaks/ui/lucide"
import Users from 'lucide/dist/esm/icons/users.mjs'
// @ts-types="@yaks/ui/lucide"
import X from 'lucide/dist/esm/icons/x.mjs'

export let icons = {
  eye: Eye,
  'eye-off': EyeOff,
  house: House,
  'layout-grid': LayoutGrid,
  globe: Globe,
  bot: Bot,
  bell: Bell,
  'sliders-horizontal': SlidersHorizontal,
  shield: Shield,
  plug: Plug,
  play: Play,
  users: Users,
  user: User,
  'share-2': Share2,
  'qr-code': QrCode,
  receipt: Receipt,
  'chart-no-axes-column-increasing': ChartNoAxesColumnIncreasing,
  'credit-card': CreditCard,
  'settings-2': Settings2,
  'trash-2': Trash2,
  plus: Plus,
  'external-link': ExternalLink,
  check: Check,
  download: Download,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevrons-up-down': ChevronsUpDown,
  'message-circle': MessageCircle,
  'message-square': MessageSquare,
  mail: Mail,
  mic: Mic,
  phone: Phone,
  'triangle-alert': TriangleAlert,
  'circle-question-mark': CircleQuestionMark,
  'log-out': LogOut,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  x: X,
}
export type IconName = keyof typeof icons

let escaped = (value: string | number) =>
  String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;')

let drawn = (nodes: IconNode) =>
  nodes.map(([tag, attrs]) =>
    `<${tag}${
      Object.entries(attrs).filter(([, value]) => value !== undefined).map(
        ([name, value]) => ` ${name}="${escaped(value!)}"`,
      ).join('')
    }></${tag}>`
  ).join('')

// Lucide's nodes are static; the sprite reuses their markup.
let bodies = new WeakMap<IconNode, string>()
let body = (nodes: IconNode) => {
  let html = bodies.get(nodes)
  if (html == undefined) bodies.set(nodes, html = drawn(nodes))
  return html
}

let stroke = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

export let sprite = () =>
  `<svg xmlns="http://www.w3.org/2000/svg">${
    Object.entries(icons).map(([name, nodes]) =>
      `<symbol id="${name}" ${stroke}>${body(nodes)}</symbol>`
    ).join('')
  }</svg>`
