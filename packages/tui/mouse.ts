import { TElement } from './dom.ts'
import type { Mouse } from './input.ts'
import type { Line } from './paint.ts'

/** DOM-compatible event delivered to Preact onWheel/onMouseDown/onMouseUp. */
export type MouseEvent = Mouse & {
  target: TElement
  currentTarget: TElement | null
  defaultPrevented: boolean
  cancelBubble: boolean
  preventDefault(): void
  stopPropagation(): void
}

/** Hit only cells present in the most recent clipped paint, not logical bounds. */
export let hit = (
  lines: Line[],
  x: number,
  y: number,
): TElement | undefined => {
  if (x < 0 || y < 0 || !Number.isInteger(x) || !Number.isInteger(y)) return
  let left = 0
  for (let seg of lines[y] ?? []) {
    left += seg.text.length
    if (x < left) return seg.owner
  }
}

/** Return true when consumed. A missed report never falls into keyboard focus. */
export let routeMouse = (report: Mouse, lines: Line[]): boolean => {
  let target = hit(lines, report.x, report.y)
  if (!target) return false
  let event: MouseEvent = {
    ...report,
    target,
    currentTarget: null,
    defaultPrevented: false,
    cancelBubble: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {
      this.cancelBubble = true
    },
  }
  for (let node: TElement | null = target; node; node = node.parentNode) {
    event.currentTarget = node
    let handler = node.handlers.get(event.type)
    if (typeof handler == 'function' && handler.call(node, event) === true) {
      event.preventDefault()
    }
    if (event.defaultPrevented || event.cancelBubble) break
  }
  event.currentTarget = null
  return event.defaultPrevented || event.cancelBubble
}
