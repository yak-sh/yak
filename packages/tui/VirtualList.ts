import { scrollbar as drawScrollbar, type ScrollPosition } from './scrollbar.ts'
import type { MouseEvent } from './mouse.ts'
/** An identity-anchored, lazily measured viewport. No total-height pass. */
import { type ComponentChildren, h, render } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { TElement, touch } from './dom.ts'
import { lay, type Line } from './paint.ts'
import { type Sheet, type Style } from './theme.ts'
import { useKeys } from './screen.ts'
import type { Key } from './input.ts'

export type VirtualItem = { id: string }
type Cached = { version: string; width: number; style: string; lines: Line[] }
export type Anchor = { id: string; offset: number }

/** Also usable without Preact: measure is called only for visited items.
 * Cache is bounded by item count; one very large item still costs its full size.
 */
export class VirtualWindow<T extends VirtualItem> {
  anchor?: Anchor
  follow: boolean
  private items: readonly T[] = []
  private indices = new Map<string, number>()
  private cache = new Map<string, Cached>()
  private height = 0
  private movement = 0
  private start = false
  private oldIndex = 0
  private style = ''
  stats = { measured: 0, hits: 0 }
  constructor(
    private measure: (item: T, width: number) => Line[],
    private version: (item: T) => string,
    follow = false,
    private capacity = 256,
  ) {
    this.follow = follow
  }

  update(items: readonly T[]) {
    if (items === this.items) return
    this.oldIndex = this.anchor
      ? this.indices.get(this.anchor.id) ?? this.oldIndex
      : 0
    this.items = items
    this.indices = new Map(items.map((item, i) => [item.id, i]))
    // A removed anchor falls to its former successor (or the last remaining item).
    if (this.anchor && !this.indices.has(this.anchor.id)) {
      let item = items[Math.min(this.oldIndex, items.length - 1)]
      this.anchor = item ? { id: item.id, offset: 0 } : undefined
    }
  }

  key(key: Key): boolean {
    let page = Math.max(1, this.height - 1)
    let delta = key.name == 'up'
      ? -1
      : key.name == 'down'
      ? 1
      : key.name == 'wheelup'
      ? -3
      : key.name == 'wheeldown'
      ? 3
      : key.name == 'pageup'
      ? -page
      : key.name == 'pagedown'
      ? page
      : null
    if (key.ctrl && key.name == 'end') {
      this.follow = true
      this.movement = 0
      return true
    }
    if (key.ctrl && key.name == 'home') {
      this.follow = false
      this.start = true
      this.movement = 0
      return true
    }
    if (delta == null) return false
    // Wheel can bubble to an enclosing scroll region at a known boundary.
    if (key.name == 'wheeldown' && this.follow) return false
    if (
      key.name == 'wheelup' && !this.follow && this.movement == 0 &&
      this.anchor?.id == this.items[0]?.id && this.anchor?.offset == 0
    ) return false
    if (delta < 0) this.follow = false
    this.movement += delta
    return true
  }

  /** Estimate unvisited heights from the bounded measurement cache. No layout. */
  position(width: number): ScrollPosition {
    let known = [...this.cache].filter(([, c]) =>
      c.width == width && c.style == this.style
    )
    let average = known.length
      ? known.reduce((n, [, c]) => n + c.lines.length, 0) / known.length
      : 1
    let index = this.anchor ? this.indices.get(this.anchor.id) ?? 0 : 0
    let total = this.items.length * average
    let top = index * average + (this.anchor?.offset ?? 0)
    for (let [id, cached] of known) {
      let at = this.indices.get(id)
      if (at == null) continue
      let correction = cached.lines.length - average
      total += correction
      if (at < index) top += correction
    }
    return { total, top, height: this.height, bottom: this.follow }
  }

  layout(width: number, height: number, style = ''): Line[] {
    this.height = height
    this.style = style
    if (!this.items.length || height <= 0 || width <= 0) return []
    let get = (i: number): Line[] => {
      let item = this.items[i], version = this.version(item)
      let cached = this.cache.get(item.id)
      if (
        !cached || cached.version != version || cached.width != width ||
        cached.style != this.style
      ) {
        let lines = this.measure(item, width)
        cached = {
          version,
          width,
          style: this.style,
          lines: lines.length ? lines : [[]],
        }
        this.stats.measured++
      } else this.stats.hits++
      this.cache.delete(item.id)
      this.cache.set(item.id, cached)
      while (this.cache.size > this.capacity) {
        this.cache.delete(this.cache.keys().next().value!)
      }
      return cached.lines
    }
    let i = this.anchor ? this.indices.get(this.anchor.id) ?? 0 : 0
    let offset = this.anchor?.offset ?? 0
    if (this.follow) {
      i = this.items.length - 1
      let remaining = height
      while (i > 0 && get(i).length < remaining) {
        remaining -= get(i).length
        i--
      }
      offset = Math.max(0, get(i).length - remaining)
    } else {
      if (this.start) {
        i = 0
        offset = 0
        this.start = false
      }
      offset = Math.min(offset, get(i).length - 1)
      offset += this.movement
      while (offset < 0 && i > 0) {
        i--
        offset += get(i).length
      }
      offset = Math.max(0, offset)
      while (offset >= get(i).length && i < this.items.length - 1) {
        offset -= get(i).length
        i++
      }
      offset = Math.min(offset, get(i).length - 1)
    }
    let exhausted = false
    let out: Line[] = [], end = i, local = offset
    while (end < this.items.length && out.length < height) {
      let lines = get(end)
      exhausted = end == this.items.length - 1 &&
        lines.length - local <= height - out.length
      out.push(...lines.slice(local, local + height - out.length))
      local = 0
      end++
    }
    // Scrolling down into the end snaps; an append while detached never does.
    if (!this.follow && this.movement > 0 && exhausted) {
      this.follow = true
      this.movement = 0
      return this.layout(width, height, style)
    }
    this.movement = 0
    this.anchor = { id: this.items[i].id, offset }
    return out.concat(
      Array.from({ length: Math.max(0, height - out.length) }, () => []),
    )
  }
}

/** The viewport owns a bounded line cache, not thousands of mounted components.
 * Width/style changes invalidate lazily, so resize only measures visible items.
 */
export let VirtualList = <T extends VirtualItem>(
  { items, renderItem, version = JSON.stringify, follow = false, ...attrs }: {
    items: readonly T[]
    renderItem: (item: T) => ComponentChildren
    version?: (item: T) => string
    scrollbar?: boolean
    follow?: boolean
    id?: string
    grow?: string
  },
) => {
  let props = useRef({ renderItem, version })
  props.current = { renderItem, version }
  let env = useRef<{ style: Style; sheet: Sheet }>()
  let state = useRef<VirtualWindow<T>>()
  let trees = useRef(new Map<string, { version: string; root: TElement }>())
  let clearTrees = () => {
    for (let { root } of trees.current.values()) {
      render(null, root as unknown as Element)
    }
    trees.current.clear()
  }
  useLayoutEffect(() => clearTrees, [])
  let identity = useRef(attrs.id)
  if (identity.current != attrs.id) {
    let old = [...trees.current.values()]
    trees.current = new Map()
    queueMicrotask(() => {
      for (let { root } of old) render(null, root as unknown as Element)
    })
    state.current = undefined
    identity.current = attrs.id
  }
  if (!state.current) {
    state.current = new VirtualWindow<T>(
      (item, width) => {
        let version = props.current.version(item)
        let cached = trees.current.get(item.id)
        if (!cached || cached.version != version) {
          if (cached) render(null, cached.root as unknown as Element)
          let root = new TElement('div')
          render(
            h('div', null, props.current.renderItem(item)),
            root as unknown as Element,
          )
          cached = { version, root }
        }
        trees.current.delete(item.id)
        trees.current.set(item.id, cached)
        while (trees.current.size > 256) {
          let key = trees.current.keys().next().value!
          render(null, trees.current.get(key)!.root as unknown as Element)
          trees.current.delete(key)
        }
        let lines = lay(cached.root, env.current!.style, width, null, {
          sheet: env.current!.sheet,
          metrics: {},
        })
        return lines
      },
      (item) => props.current.version(item),
      follow,
    )
  }
  state.current.update(items)
  useKeys((key) => {
    if (!state.current!.key(key)) return false
    touch()
    return true
  })
  useLayoutEffect(() => {
    touch()
  }, [items, renderItem])
  return h('div', {
    ...attrs,
    onWheel: (event: MouseEvent) => {
      if (
        !event.deltaY || event.release || event.ctrl || event.alt || event.shift
      ) return
      if (
        state.current!.key({ name: event.deltaY < 0 ? 'wheelup' : 'wheeldown' })
      ) {
        touch()
        event.preventDefault()
      }
    },
    ref: (el: unknown) => {
      if (!el) return
      ;(el as TElement).viewport = (width, height, style, sheet) => {
        env.current = { style, sheet }
        let inner = attrs.scrollbar && width >= 2 ? width - 1 : width
        let lines = state.current!.layout(
          inner,
          height,
          JSON.stringify([style, sheet]),
        )
        return attrs.scrollbar
          ? drawScrollbar(lines, width, state.current!.position(inner), sheet)
          : lines
      }
    },
  })
}
