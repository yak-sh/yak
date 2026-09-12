import {
  clampPoint,
  copyRendered,
  cursorLine,
  type RenderedCursor,
  stepColumn,
} from './RenderedCursor.ts'
import { useTextSurface } from './visual.ts'
import { scrollbar as drawScrollbar, type ScrollPosition } from './scrollbar.ts'
import type { MouseEvent } from './mouse.ts'
/** An identity-anchored, lazily measured viewport. No total-height pass. */
import { type ComponentChildren, h, render, type VNode } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { TElement, touch } from './dom.ts'
import { lay, type Line } from './paint.ts'
import { type Sheet, type Style } from './theme.ts'
import { terminalFocused, useKeys } from './screen.ts'
import type { Key } from './input.ts'

export type ListRange = { before: boolean; after: boolean }
export type RangeRequest = { anchor?: string; edge?: 'start' | 'end' }

export type VirtualItem = { id: string }
type Cached = { version: string; width: number; style: string; lines: Line[] }
export type Anchor = { id: string; offset: number }
export type ViewportState = { anchor?: Anchor; follow: boolean }

/** Also usable without Preact: measure is called only for visited items.
 * Cache is bounded by item count; one very large item still costs its full size.
 */
export class VirtualWindow<T extends VirtualItem> {
  anchor?: Anchor
  cursor?: RenderedCursor
  cursorStyle: Style = { inverse: true }
  cursorVisible = true
  private cursorStamp = ''
  private reader?: (id: string) => Line[] | undefined
  selected?: string
  selectionVisible = true
  selectionStyle: Style = { bg: '#343f44' }
  follow: boolean
  private items: readonly T[] = []
  private indices = new Map<string, number>()
  private retainedOrder: string[] = []
  private cache = new Map<string, Cached>()
  private height = 0
  private movement = 0
  private start = false
  private oldIndex = 0
  private style = ''
  private revealedSelection?: string
  private revealedWidth = 0
  private revealedHeight = 0
  range: ListRange = { before: false, after: false }
  visibleEnd = 0
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
    // Keep bounded ordering metadata across overlapping loaded pages for selection.
    const nextIds = items.map((item) => item.id)
    const firstOverlap = nextIds.findIndex((id) =>
      this.retainedOrder.includes(id)
    )
    if (firstOverlap < 0) this.retainedOrder = nextIds
    else {
      const oldAt = this.retainedOrder.indexOf(nextIds[firstOverlap])
      this.retainedOrder = [
        ...new Set([
          ...this.retainedOrder.slice(0, oldAt),
          ...nextIds,
          ...this.retainedOrder.slice(oldAt).filter((id) =>
            !nextIds.includes(id)
          ),
        ]),
      ]
      if (this.retainedOrder.length > 512) {
        this.retainedOrder = this.retainedOrder.slice(-512)
      }
    }
    this.items = items
    this.indices = new Map(items.map((item, i) => [item.id, i]))
    // A removed anchor falls to its former successor (or the last remaining item).
    if (this.anchor && !this.indices.has(this.anchor.id)) {
      let item = items[Math.min(this.oldIndex, items.length - 1)]
      this.anchor = item ? { id: item.id, offset: 0 } : undefined
    }
  }

  /** Item navigation uses only cached heights, never measures intervening history. */
  selectionKey(key: Key, selected: string | undefined): string | undefined {
    if (key.alt || key.shift) return undefined
    let average = this.cache.size
      ? [...this.cache.values()].reduce((n, item) => n + item.lines.length, 0) /
        this.cache.size
      : 1
    let page = Math.max(1, Math.floor(this.height / average))
    let half = Math.max(1, Math.floor(this.height / average / 2))
    let delta = key.ctrl
      ? key.text == 'u' ? -half : key.text == 'd' ? half : undefined
      : key.name == 'up'
      ? -1
      : key.name == 'down'
      ? 1
      : key.name == 'pageup'
      ? -page
      : key.name == 'pagedown'
      ? page
      : undefined
    let index = this.indices.get(selected ?? this.anchor?.id ?? '') ?? -1
    if (key.name == 'home') {
      index = 0
      this.follow = false
    } else if (key.name == 'end') {
      index = this.items.length - 1
      this.follow = true
    } else if (delta !== undefined) index = index < 0 ? 0 : index + delta
    else return undefined
    return this.items[Math.max(0, Math.min(this.items.length - 1, index))]?.id
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

  /** Move a rendered cursor; only visited items are measured. */
  moveCursor(key: Key, point: RenderedCursor): RenderedCursor | undefined {
    if (!this.reader) return
    let index = this.indices.get(point.id)
    if (index == null) return
    let lines = this.reader(point.id)!, p = clampPoint(point, lines)
    let row = p.row, col = p.col
    if (key.name == 'left' || key.name == 'right') {
      col = stepColumn(lines[row], col, key.name == 'left' ? -1 : 1)
    } else if (key.name == 'up') row--
    else if (key.name == 'down') row++
    else if (key.name == 'pageup' || key.name == 'pagedown') {
      row += (key.name == 'pageup' ? -1 : 1) * Math.max(1, this.height - 1)
    } else if (key.ctrl && (key.text == 'u' || key.text == 'd')) {
      row += (key.text == 'u' ? -1 : 1) *
        Math.max(1, Math.floor(this.height / 2))
    } else if (key.name == 'home' && !key.ctrl) col = 0
    else if (key.name == 'end' && !key.ctrl) {
      col = lines[row].reduce((n, s) => n + s.text.length, 0) - 1
    } else return
    while (row < 0 && index > 0) {
      index--
      lines = this.reader(this.items[index].id)!
      row += lines.length
    }
    while (row >= lines.length && index < this.items.length - 1) {
      row -= lines.length
      index++
      lines = this.reader(this.items[index].id)!
    }
    return {
      ...point,
      ...clampPoint({ id: this.items[index].id, row, col }, lines),
    }
  }
  copyCursor(point: RenderedCursor): string {
    return copyRendered(
      point,
      this.retainedOrder,
      (id) => this.reader?.(id) ?? this.cache.get(id)?.lines,
    )
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
    // Unknown ranges are estimated as another loaded page; the scrollbar is
    // deliberately approximate and never controls the logical anchor.
    let unknown = Math.max(this.height, this.items.length * average)
    if (this.range.before) {
      top += unknown
      total += unknown
    }
    if (this.range.after) total += unknown
    return {
      total,
      top,
      height: this.height,
      bottom: this.follow && !this.range.after,
    }
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
    this.reader = (id) => {
      const index = this.indices.get(id)
      return index == null ? undefined : get(index)
    }
    if (this.cursor && this.indices.has(this.cursor.id)) {
      this.cursor = {
        ...this.cursor,
        ...clampPoint(this.cursor, get(this.indices.get(this.cursor.id)!)),
      }
      this.selected = this.cursor.id
      const stamp = JSON.stringify([
        this.cursor.id,
        this.cursor.row,
        this.cursor.col,
        width,
      ])
      if (stamp != this.cursorStamp) {
        this.cursorStamp = stamp
        const startIndex = this.anchor
          ? this.indices.get(this.anchor.id)
          : undefined
        let distance = -(this.anchor?.offset ?? 0)
        let index = startIndex ?? this.indices.get(this.cursor.id)!
        const target = this.indices.get(this.cursor.id)!
        let visible = target >= index
        while (visible && index < target && distance < height) {
          distance += get(index++).length
        }
        distance += this.cursor.row
        visible = visible && index == target && distance >= 0 &&
          distance < height
        if (!visible) {
          this.anchor = {
            id: this.cursor.id,
            offset: Math.max(0, this.cursor.row - height + 1),
          }
        }
        this.follow = false
        this.revealedSelection = this.cursor.id
        this.revealedWidth = width
        this.revealedHeight = height
      }
    }
    let i = this.anchor ? this.indices.get(this.anchor.id) ?? 0 : 0
    let offset = this.anchor?.offset ?? 0
    if (this.follow && !this.range.after) {
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
    // Probe only the existing viewport. Jump directly to a distant selection,
    // then measure at most one screen backwards to reveal its trailing edge.
    let selected = this.selected === undefined
      ? undefined
      : this.indices.get(this.selected)
    const reveal = this.selected != this.revealedSelection ||
      width != this.revealedWidth || height != this.revealedHeight
    this.revealedSelection = this.selected
    this.revealedWidth = width
    this.revealedHeight = height
    if (selected !== undefined && !this.follow && reveal) {
      let end = i, remaining = height + offset, seen = false
      while (end < this.items.length && remaining > 0) {
        remaining -= get(end).length
        if (end == selected) {
          seen = true
          break
        }
        end++
      }
      if (selected < i || (selected == i && offset > 0)) {
        i = selected
        offset = 0
        this.follow = false
      } else if (!seen || remaining < 0) {
        i = selected
        let room = height - get(i).length
        while (i > 0 && room > 0) {
          i--
          room -= get(i).length
        }
        offset = Math.max(0, -room)
        // Oversized entries show their beginning, not just their final lines.
        if (i == selected) offset = 0
        this.follow = false
      }
    }
    let exhausted = false
    let out: Line[] = [], end = i, local = offset
    while (end < this.items.length && out.length < height) {
      let lines = get(end)
      exhausted = end == this.items.length - 1 &&
        lines.length - local <= height - out.length
      let visible = lines.slice(local, local + height - out.length)
      if (this.cursor) {
        visible = visible.map((line, row) =>
          cursorLine(
            line,
            this.items[end].id,
            row + local,
            this.cursor!,
            this.retainedOrder,
            this.cursorVisible ? this.cursorStyle : {},
          )
        )
      }
      out.push(
        ...(this.selectionVisible && end == selected
          ? visible.map((line) =>
            line.map((seg) => ({
              ...seg,
              style: { ...seg.style, ...this.selectionStyle },
            }))
          )
          : visible),
      )
      local = 0
      end++
    }
    // Scrolling down into the end snaps; an append while detached never does.
    if (
      !this.range.after && !this.follow && this.movement > 0 && exhausted
    ) {
      this.follow = true
      this.movement = 0
      return this.layout(width, height, style)
    }
    this.visibleEnd = end
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
  {
    items,
    renderItem,
    textOf,
    version = JSON.stringify,
    follow = false,
    pending = false,
    value,
    onViewportChange,
    selected,
    cursor,
    onCursor,
    onYank,
    selectionVisible = true,
    selectionClass = 'List_Selected',
    onSelect,
    range,
    onRange,
    ...attrs
  }: {
    items: readonly T[]
    /** Unloaded neighbors. Boundary requests never imply the data is empty. */
    range?: ListRange
    onRange?: (request: RangeRequest) => void
    /** Controlled selected item; onSelect enables item-navigation keys. */
    selected?: string
    cursor?: RenderedCursor
    onCursor?: (cursor: RenderedCursor) => void
    onYank?: (text: string, error?: boolean) => void
    /** Keep the logical selection while hiding its painted highlight. */
    selectionClass?: string
    selectionVisible?: boolean
    onSelect?: (id: string) => void
    textOf?: (item: T) => string
    renderItem: (item: T) => ComponentChildren
    version?: (item: T) => string
    scrollbar?: boolean
    follow?: boolean
    /** Loading is not an authoritative empty item collection. */
    pending?: boolean
    /** Controlled logical position; measurements and caches remain internal. */
    value?: ViewportState
    onViewportChange?: (value: ViewportState) => void
    id?: string
    grow?: string
  },
): VNode<{
  onWheel: (event: MouseEvent) => void
  ref: (el: unknown) => void
  scrollbar?: boolean
  id?: string
  grow?: string
}> => {
  let rangeRequest = useRef<string>()
  let rangeItems = useRef(items)
  if (rangeItems.current !== items) {
    rangeRequest.current = undefined
    rangeItems.current = items
  }
  let requestRange = (request: RangeRequest) => {
    if (!onRange) return
    let key = JSON.stringify(request)
    if (rangeRequest.current === key) return
    rangeRequest.current = key
    queueMicrotask(() => onRange(request))
  }
  let props = useRef({ renderItem, version })
  props.current = { renderItem, version }
  let selectionWidth = useRef(80)
  let selectedIndex = useRef<number>()
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
  if (value) {
    state.current.anchor = value.anchor
    state.current.follow = value.follow
  }
  let publish = () => {
    if (pending) return
    let next = { anchor: state.current!.anchor, follow: state.current!.follow }
    if (
      next.follow != value?.follow || next.anchor?.id != value?.anchor?.id ||
      next.anchor?.offset != value?.anchor?.offset
    ) onViewportChange?.(next)
  }
  if (!pending) state.current.update(items)
  useTextSurface({
    id: attrs.id ?? 'list',
    enabled: Boolean(textOf) && !onCursor,
    snapshot: () => {
      selectedIndex.current = items.findIndex((i) =>
        i.id == (selected ?? state.current!.anchor?.id)
      )
      let item = items[selectedIndex.current] ?? items.at(-1)
      return { text: item && textOf ? textOf(item) : '' }
    },
    width: () => selectionWidth.current,
    adjacent: (delta) => {
      let index = Math.max(
        0,
        Math.min(items.length - 1, (selectedIndex.current ?? 0) + delta),
      )
      selectedIndex.current = index
      let item = items[index]
      return { text: item && textOf ? textOf(item) : '' }
    },
  })
  state.current.selectionVisible = selectionVisible
  state.current.range = range ?? { before: false, after: false }
  state.current.selected = selected
  state.current.cursor = cursor
  useKeys((key) => {
    const cursor = state.current!.cursor
    if (cursor && onCursor) {
      const text = key.name == 'char' && !key.ctrl && !key.alt
        ? key.text
        : undefined
      if (text == 'v') {
        const next = {
          ...cursor,
          anchor: { id: cursor.id, row: cursor.row, col: cursor.col },
        }
        state.current!.cursor = next
        onCursor(next)
        return true
      }
      if (key.name == 'escape') {
        state.current!.cursor = { ...cursor, anchor: undefined }
        onCursor(state.current!.cursor)
        return true
      }
      if (text == 'y' && cursor.anchor) {
        try {
          onYank?.(state.current!.copyCursor(cursor))
          state.current!.cursor = { ...cursor, anchor: undefined }
          onCursor(state.current!.cursor)
        } catch (error) {
          onYank?.(String(error), true)
        }
        return true
      }
      const down = key.name == 'down' || key.name == 'pagedown' ||
        key.ctrl && key.text == 'd'
      const up = key.name == 'up' || key.name == 'pageup' ||
        key.ctrl && key.text == 'u'
      const index = items.findIndex((item) => item.id == cursor.id)
      if (
        range &&
        (down && range.after && index >= items.length - 2 ||
          up && range.before && index < 2)
      ) {
        requestRange({ anchor: cursor.id })
      }
      const moved = state.current!.moveCursor(key, cursor)
      if (moved) {
        state.current!.cursor = moved
        state.current!.selected = moved.id
        onCursor(moved)
        touch()
        return true
      }
    }
    if (
      range && (key.name == 'home' || key.name == 'end') &&
      (key.ctrl || onSelect)
    ) {
      let edge: 'start' | 'end' = key.name == 'home' ? 'start' : 'end'
      if (edge == 'start' ? range.before : range.after) {
        requestRange({ edge })
        return true
      }
    }
    if (range && selected) {
      let index = items.findIndex((item) => item.id == selected)
      let up = key.name == 'up' || key.name == 'pageup' ||
        key.ctrl && key.text == 'u'
      let down = key.name == 'down' || key.name == 'pagedown' ||
        key.ctrl && key.text == 'd'
      if (
        up && range.before && index <= 1 ||
        down && range.after && index >= items.length - 2
      ) {
        requestRange({ anchor: selected })
        return true
      }
    }
    if (onSelect) {
      let id = state.current!.selectionKey(key, selected)
      if (id !== undefined) {
        // Ordinary selection detaches; End explicitly resumes following.
        if (key.name != 'end') state.current!.follow = false
        publish()
        onSelect(id)
        if (cursor && onCursor) {
          onCursor({
            id,
            row: key.name == 'end' ? Number.MAX_SAFE_INTEGER : 0,
            col: 0,
            anchor: cursor.anchor,
          })
        }
        return true
      }
    }
    if (!state.current!.key(key)) return false
    touch()
    return true
  }, String(attrs.id))
  useLayoutEffect(() => {
    touch()
  }, [items, renderItem, selected, selectionVisible, selectionClass, cursor])
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
        selectionWidth.current = width
        env.current = { style, sheet }
        state.current!.cursorVisible = terminalFocused.value
        state.current!.selectionStyle = sheet[selectionClass] ??
          { bg: '#343f44' }
        let inner = attrs.scrollbar && width >= 2 ? width - 1 : width
        if (pending) return []
        let lines = state.current!.layout(
          inner,
          height,
          JSON.stringify([style, sheet]),
        )
        publish()
        if (range && items.length) {
          let at = items.findIndex((item) =>
            item.id == state.current!.anchor?.id
          )
          if (
            range.before && at < 8 ||
            range.after && state.current!.visibleEnd > items.length - 8
          ) {
            requestRange({
              anchor: range.before && at < 8
                ? state.current!.anchor?.id
                : items[
                  Math.min(items.length - 1, state.current!.visibleEnd - 1)
                ].id,
            })
          }
        }
        return attrs.scrollbar
          ? drawScrollbar(lines, width, state.current!.position(inner), sheet)
          : lines
      }
    },
  })
}
