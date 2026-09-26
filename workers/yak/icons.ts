// The public pages' icon vocabulary, drawn from Lucide's SVG nodes. Each icon
// is its own module, imported by path: the package's barrel re-exports all
// ~1,800 icons, and every module that reaches this one (the kernel does) would
// load them all. Inline icons and the style guide's external sprite share the
// same paths without any browser JavaScript.
import type { IconNode } from 'lucide'
import Bot from 'lucide/dist/esm/icons/bot.mjs'
import ChartNoAxesColumnIncreasing from 'lucide/dist/esm/icons/chart-no-axes-column-increasing.mjs'
import Check from 'lucide/dist/esm/icons/check.mjs'
import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'
import CreditCard from 'lucide/dist/esm/icons/credit-card.mjs'
import Download from 'lucide/dist/esm/icons/download.mjs'
import ExternalLink from 'lucide/dist/esm/icons/external-link.mjs'
import LayoutGrid from 'lucide/dist/esm/icons/layout-grid.mjs'
import Plug from 'lucide/dist/esm/icons/plug.mjs'
import Plus from 'lucide/dist/esm/icons/plus.mjs'
import Settings2 from 'lucide/dist/esm/icons/settings-2.mjs'
import Trash2 from 'lucide/dist/esm/icons/trash-2.mjs'

export let icons = {
  'layout-grid': LayoutGrid,
  bot: Bot,
  plug: Plug,
  'chart-no-axes-column-increasing': ChartNoAxesColumnIncreasing,
  'credit-card': CreditCard,
  'settings-2': Settings2,
  'trash-2': Trash2,
  plus: Plus,
  'external-link': ExternalLink,
  check: Check,
  download: Download,
  'chevron-right': ChevronRight,
}
export type IconName = keyof typeof icons

let escaped = (value: string | number) =>
  String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;')

let body = (nodes: IconNode) =>
  nodes.map(([tag, attrs]) =>
    `<${tag}${
      Object.entries(attrs).filter(([, value]) => value !== undefined).map(
        ([name, value]) => ` ${name}="${escaped(value!)}"`,
      ).join('')
    }></${tag}>`
  ).join('')

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
