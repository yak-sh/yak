/** The scrolling body primitive: browser overflow or a terminal window. Each
 * `id` starts scrolled to `start`, such as where a page was left, and
 * `onScroll` hears where a person moves it. */
import { type ComponentChildren, type FunctionComponent, h } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
export type ViewportProps = {
  id: string
  start?: number
  onScroll?: (top: number) => void
  class?: string
  children?: ComponentChildren
}
// A page returned to may draw its rows after it mounts, so the browser's body
// reaches for its start as they arrive, until it gets there, a person scrolls
// it themselves, or a moment has passed.
let Body: FunctionComponent<ViewportProps> = (
  { start = 0, onScroll, ...props },
) => {
  let ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    let el = ref.current
    if (!el) return
    el.scrollTop = start
    if (!start || typeof MutationObserver != 'function') return
    let reach = () => {
      el.scrollTop = start
      if (el.scrollTop >= start) stop()
    }
    let grown = new MutationObserver(reach)
    let stop = () => {
      grown.disconnect()
      clearTimeout(timer)
      for (let type of ['wheel', 'touchstart', 'keydown']) {
        el.removeEventListener(type, stop)
      }
    }
    let timer = setTimeout(stop, 2000)
    grown.observe(el, { childList: true, subtree: true })
    for (let type of ['wheel', 'touchstart', 'keydown']) {
      el.addEventListener(type, stop)
    }
    return stop
  }, [props.id])
  return h('div', {
    ...props,
    ref,
    onScroll: onScroll &&
      ((e: Event) => onScroll((e.currentTarget as HTMLElement).scrollTop)),
  })
}
export let installViewport = (body: FunctionComponent<ViewportProps>): void => {
  Body = body
}
export let Viewport: FunctionComponent<ViewportProps> = (props) =>
  h(Body, props)
