// The public pages' icon vocabulary, drawn from Lucide's SVG nodes. Each icon
// is its own module, imported by path: the package's barrel re-exports all
// ~1,800 icons, and every module that reaches this one (the kernel does) would
// load them all. Inline icons and the style guide's external sprite share the
// same paths without any browser JavaScript.
import type { IconNode } from 'lucide'
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
import Globe from 'lucide/dist/esm/icons/globe.mjs'
// @ts-types="@yaks/ui/lucide"
import House from 'lucide/dist/esm/icons/house.mjs'
// @ts-types="@yaks/ui/lucide"
import LayoutGrid from 'lucide/dist/esm/icons/layout-grid.mjs'
// @ts-types="@yaks/ui/lucide"
import Plug from 'lucide/dist/esm/icons/plug.mjs'
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
import Trash2 from 'lucide/dist/esm/icons/trash-2.mjs'
// @ts-types="@yaks/ui/lucide"
import User from 'lucide/dist/esm/icons/user.mjs'
// @ts-types="@yaks/ui/lucide"
import Users from 'lucide/dist/esm/icons/users.mjs'

export let icons = {
  house: House,
  'layout-grid': LayoutGrid,
  globe: Globe,
  bot: Bot,
  plug: Plug,
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

// Lucide's nodes are static; inline icons and the sprite reuse their markup.
let bodies = new WeakMap<IconNode, string>()
let body = (nodes: IconNode) => {
  let html = bodies.get(nodes)
  if (html == undefined) bodies.set(nodes, html = drawn(nodes))
  return html
}

let stroke = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

export let icon = (name: IconName) =>
  `<svg xmlns="http://www.w3.org/2000/svg" class="Icon" aria-hidden="true" ` +
  `focusable="false" width="24" height="24" ${stroke}>${
    body(icons[name])
  }</svg>`

export let sprite = () =>
  `<svg xmlns="http://www.w3.org/2000/svg">${
    Object.entries(icons).map(([name, nodes]) =>
      `<symbol id="${name}" ${stroke}>${body(nodes)}</symbol>`
    ).join('')
  }</svg>`
