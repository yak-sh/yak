/** The scrolling body primitive: browser overflow or a terminal window. */
import { type ComponentChildren, type FunctionComponent, h } from 'preact'
export type ViewportProps = {
  id: string
  top?: number
  onScroll?: (top: number) => void
  class?: string
  children?: ComponentChildren
}
let Body: FunctionComponent<ViewportProps> = (
  { top: _top, onScroll: _onScroll, ...props },
) => h('div', props)
export let installViewport = (body: FunctionComponent<ViewportProps>): void => {
  Body = body
}
export let Viewport: FunctionComponent<ViewportProps> = (props) =>
  h(Body, props)
