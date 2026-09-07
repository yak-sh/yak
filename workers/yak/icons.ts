// The public pages' icon vocabulary, drawn from Lucide's SVG nodes. Named
// imports keep the Worker bundle small; inline icons and the style guide's
// external sprite share the same paths without any browser JavaScript.
import {
  Bot,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronRight,
  CreditCard,
  Download,
  ExternalLink,
  type IconNode,
  LayoutGrid,
  Plus,
  Settings2,
  Trash2,
} from 'lucide'

export let icons = {
  'layout-grid': LayoutGrid,
  bot: Bot,
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
