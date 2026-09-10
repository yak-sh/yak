/** Controlled, graph-free characterwise selection over opt-in text surfaces.
 * A virtual surface supplies one item, never its entire history. */
import { safe } from '@yaks/text'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { touch } from './dom.ts'
import type { Key } from './input.ts'
import type { Line } from './paint.ts'
import { visualRows, visualSpot } from './textRows.ts'

export type VisualState = {
  surface: string
  text: string
  anchor: number
  at: number
  yank: string
}
export type TextSurface = {
  id: string
  snapshot: () => { text: string; at?: number }
  enabled?: boolean
  width: () => number
  adjacent?: (delta: number) => { text: string; at?: number }
}
let surfaces = new Map<string, TextSurface>()
let widths = new Map<string, number>()
let controller:
  | { get: () => VisualState; set: (s: VisualState) => void }
  | undefined
let clipboard: (text: string) => void = () => {}
export let setClipboard = (write: (text: string) => void) => {
  clipboard = write
}
export let visualState = () => controller?.get()
export let emptyVisual = (): VisualState => ({
  surface: '',
  text: '',
  anchor: 0,
  at: 0,
  yank: '',
})
export let useVisualController = (
  get: () => VisualState,
  set: (s: VisualState) => void,
): void => {
  let ref = useRef({ get, set })
  ref.current = { get, set }
  useLayoutEffect(() => {
    let value = {
      get: () => ref.current.get(),
      set: (s: VisualState) => ref.current.set(s),
    }
    controller = value
    return () => {
      if (controller === value) controller = undefined
    }
  }, [])
}
export let useTextSurface = (surface: TextSurface): void => {
  let ref = useRef(surface)
  ref.current = surface
  useLayoutEffect(() => {
    let value = {
      id: surface.id,
      snapshot: () => ref.current.snapshot(),
      width: () => ref.current.width(),
      adjacent: (delta: number) =>
        ref.current.adjacent?.(delta) ?? ref.current.snapshot(),
    }
    if (surface.enabled === false) return
    surfaces.set(surface.id, value)
    return () => {
      surfaces.delete(surface.id)
      widths.delete(surface.id)
    }
  }, [surface.id, surface.enabled])
}
/** Start selection on a named text surface without depending on mount order. */
export let beginVisual = (id: string): boolean => {
  let target = surfaces.get(id)
  if (!controller || !target) return false
  let snap = target.snapshot()
  let at = snap.at ?? 0
  controller.set({
    ...controller.get(),
    surface: id,
    text: snap.text,
    anchor: at,
    at,
  })
  touch()
  return true
}
export let selectedText = (s: VisualState) =>
  s.text.slice(
    Math.min(s.anchor, s.at),
    Math.max(s.anchor, s.at) +
      ((s.text.codePointAt(Math.max(s.anchor, s.at)) ?? 0) > 0xffff ? 2 : 1),
  )
/** All visual keys are consumed, so editing/navigation cannot leak through. */
export let visualKey = (k: Key): boolean => {
  if (!controller || (k.ctrl && k.text == 'c')) return false
  if (
    controller.get().surface && k.name == 'char' && !k.alt && !k.ctrl &&
    (k.text?.length ?? 0) > 1
  ) {
    for (let text of k.text!) visualKey({ ...k, text })
    return true
  }
  let s = controller.get()
  let begin = k.name == 'char' && k.alt && k.text == 'v'
  if (!s.surface && !begin) return false
  let choices = [...surfaces.values()]
  if (begin || k.name == 'tab') {
    let index = choices.findIndex((v) => v.id == s.surface)
    let target = choices[(index + 1) % choices.length]
    if (!target) return true
    let value = target.snapshot()
    s = {
      ...s,
      surface: target.id,
      text: value.text,
      at: Math.min(value.at ?? 0, Math.max(0, value.text.length - 1)),
      anchor: Math.min(value.at ?? 0, Math.max(0, value.text.length - 1)),
    }
  } else if (k.name == 'char' && (k.text == '[' || k.text == ']')) {
    let value = surfaces.get(s.surface)?.adjacent?.(k.text == '[' ? -1 : 1)
    if (value) {
      s = { ...s, text: value.text, at: value.at ?? 0, anchor: value.at ?? 0 }
    }
  } else if (k.name == 'escape') s = { ...s, surface: '' }
  else if (k.name == 'char' && k.text == 'y' && !k.ctrl && !k.alt) {
    let text = selectedText(s)
    // Keep the local yank even if a host clipboard is unavailable.
    s = { ...s, surface: '', yank: text }
    controller.set(s)
    touch()
    clipboard(text)
    return true
  } else {
    let direction = k.name == 'char'
      ? k.text
      : ({ left: 'h', right: 'l', up: 'k', down: 'j' } as Record<
        string,
        string
      >)[k.name]
    let rows = visualRows(
      s.text,
      Math.max(
        1,
        widths.get(s.surface) ?? surfaces.get(s.surface)?.width() ?? 1,
      ),
    )
    let spot = visualSpot(rows, s.at)
    let at = s.at
    if (direction == 'h') {
      at -= s.at > 1 && /[\uDC00-\uDFFF]/.test(s.text[s.at - 1]) ? 2 : 1
    }
    if (direction == 'l') at += (s.text.codePointAt(s.at) ?? 0) > 0xffff ? 2 : 1
    if (direction == 'j' || direction == 'k') {
      let row = rows[
        Math.max(
          0,
          Math.min(rows.length - 1, spot.row + (direction == 'j' ? 1 : -1)),
        )
      ]
      at = Math.min(row.end, row.start + spot.col)
    }
    if (k.name == 'home') at = rows[spot.row].start
    if (k.name == 'end') {
      at = Math.max(rows[spot.row].start, rows[spot.row].end - 1)
    }
    s = { ...s, at: Math.max(0, Math.min(Math.max(0, s.text.length - 1), at)) }
  }
  controller.set(s)
  touch()
  return true
}
/** Selection presents exact source text, without markup, borders or soft-wrap newlines. */
export let visualLines = (
  id: string,
  width: number,
  height: number,
): Line[] | undefined => {
  let s = visualState()
  if (!s?.surface || s.surface != id) return
  widths.set(id, width)
  let rows = visualRows(s.text, Math.max(1, width))
  let spot = visualSpot(rows, s.at)
  let top = Math.max(0, spot.row - height + 1)
  let low = Math.min(s.anchor, s.at), high = Math.max(s.anchor, s.at)
  return rows.slice(top, top + height).map((row) => {
    let line: Line = []
    for (let i = row.start; i < row.end; i++) {
      line.push({
        text: safe(s.text[i]) || ' ',
        style: { inverse: i >= low && i <= high },
      })
    }
    return line.length
      ? line
      : [{ text: ' ', style: { inverse: row.start == s.at } }]
  })
}
