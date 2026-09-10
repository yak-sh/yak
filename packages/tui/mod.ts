/**
 * @yaks/tui renders a Preact tree to a terminal. Preact draws into a fake DOM
 * (`dom.ts`); a BACKEND turns that tree into what the screen shows. The
 * backend that ships is a hand-rolled ANSI painter which repaints only the
 * lines that changed, so a keystroke costs a line — swap it for another
 * renderer without touching a widget.
 *
 * ```ts
 * import { h } from 'preact'
 * import { Frame, Scroll, Textarea, run } from '@yaks/tui'
 *
 * let App = () =>
 *   h(Frame, { sidebar: [{ title: 'Status', Render: () => h('div', null, 'ok') }] },
 *     h(Scroll, { id: 'log', grow: '1' }, h('div', null, 'hello')),
 *     h(Textarea, { onSubmit: (text: string) => console.log(text) }))
 *
 * if (import.meta.main) await run(App)
 * ```
 *
 * @module
 */

export { doc, install, onPaint, TElement, TNode, touch, TText } from './dom.ts'
export { decode, feed, type Key, type Name } from './input.ts'
export {
  ansi,
  ansiBackend,
  type Backend,
  clip,
  clipboard,
  lay,
  type Line,
  type Metrics,
  screenful,
  type Seg,
  wrap,
} from './paint.ts'
export { everforest, type Sheet, type Style, theme } from './theme.ts'
export {
  clear,
  type Keys,
  measured,
  metrics,
  press,
  size,
  useKeys,
  useMetric,
} from './screen.ts'
export { quit, run } from './run.ts'
export { Scroll, scrolled, type View } from './Scroll.ts'
export { bol, type Edit, edit, eol, spot, Textarea } from './Textarea.ts'
export { Frame, type Panel } from './Frame.ts'
export {
  type Anchor,
  type VirtualItem,
  VirtualList,
  VirtualWindow,
} from './VirtualList.ts'

export { hit, type MouseEvent, routeMouse } from './mouse.ts'
export type { Input, Mouse } from './input.ts'
