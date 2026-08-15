import { useLayoutEffect, useRef } from 'preact/hooks'
import { ent, type Peeked } from '../live.ts'
import { block, el } from './ui.tsx'
import { cardMenuAt, peek } from './nav.tsx'
import { applicable, resolve } from './registry.ts'
import {
  dragData,
  moved,
  moveEl,
  resetSize,
  resizeDirs,
  resizeEl,
} from './drag.ts'
import { Entity } from './Entity.tsx'
import { TabFace } from './Card.tsx'
import { place } from './overlay.tsx'

// The Peek: what a clicked link opens on desktop — a temporary card in a
// popover just above the pointer, clamped to the viewport (overlay.tsx
// place). Reading AND clicking are free; the head moves the temporary card
// around the viewport and the corner sizes it. View tabs remain native drag
// sources: dropping one on the canvas pins that view. Esc, q, or a click
// anywhere else dismisses it unpinned.

let Frame = block('div', 'Peek', { Head: 'div', Body: 'div' })
let { Head, Body } = Frame
let Tab = el('button', 'Tab')

export let peekKey = (key: string, typing: boolean) =>
  !typing && (key == 'Escape' || key == 'q')

export let popPeek = (stack: Peeked[]) => stack.slice(0, -1)

let PeekCard = ({ p }: { p: Peeked }) => {
  let root = useRef<HTMLDivElement>(null)
  let free = useRef(p.left != null)

  useLayoutEffect(() => {
    let el = root.current!
    if (p.left != null && p.top != null) return
    let anchor = new DOMRect(p.x - 8, p.y - 8, 16, 16)
    let put = () => !free.current && place(el, anchor, 'above')
    put()
    let ro = new ResizeObserver(put)
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [p.x, p.y])

  let e = ent(p.eid)
  let tabs = applicable(e)
  let view = p.view && tabs.includes(p.view) ? p.view : resolve(e).view

  // Every drag out of the head ends here (dragend bubbles): a landed
  // drop means the peek lives on the canvas now, so it closes; a
  // cancelled drag keeps it floating.
  let flown = (ev: DragEvent) => {
    if (ev.dataTransfer?.dropEffect != 'none') {
      peek.value = peek.peek().filter((v) => v != p)
    }
  }

  let patch = (comp: Partial<Peeked>) => {
    peek.value = peek.peek().map((v) => v == p ? { ...v, ...comp } : v)
  }

  let move = (e: PointerEvent & { currentTarget: HTMLDivElement }) => {
    if (e.button != 0 || !(e.target instanceof Element)) return
    if (e.target.closest('button, a, input, textarea, [contenteditable]')) {
      return
    }
    let box = root.current!
    let left = box.offsetLeft
    let top = box.offsetTop
    let wasFree = free.current
    moveEl(
      e,
      box,
      () => 1,
      () => {
        free.current = true
      },
      (dx, dy) => {
        let next = moved(left, top, dx, dy)
        patch({ left: next.x, top: next.y })
      },
      () => (free.current = wasFree),
    )
  }

  let resize = (e: PointerEvent, d: string) => {
    e.stopPropagation()
    if (e.button != 0) return
    let box = root.current!
    let wasFree = free.current
    let wasSized = box.classList.contains('Peek-sized')
    free.current = true
    box.classList.add('Peek-sized')
    resizeEl(
      e,
      e.currentTarget as HTMLElement,
      box,
      {
        x: box.offsetLeft,
        y: box.offsetTop,
        w: box.offsetWidth,
        h: box.offsetHeight,
      },
      d,
      () => 1,
      (next) =>
        patch({
          left: next.x ?? box.offsetLeft,
          top: next.y ?? box.offsetTop,
          w: next.w ?? p.w,
          h: next.h ?? p.h,
        }),
      () => {
        free.current = wasFree
        if (!wasSized) box.classList.remove('Peek-sized')
      },
    )
  }

  let reset = (d: string) => patch(resetSize(d))

  let style = [
    p.left != null && `left:${p.left}px`,
    p.top != null && `top:${p.top}px`,
    p.w ? `width:${p.w}px` : false,
    p.h ? `height:${p.h}px` : false,
  ].filter(Boolean).join(';')

  return (
    <Frame
      elRef={root}
      mod={!!(p.w || p.h) && 'sized'}
      style={style}
      onContextMenu={cardMenuAt(e)}
    >
      <Head
        onPointerDown={move}
        onDragEnd={flown}
      >
        <Entity eid={p.eid} view='Card.Title' />
        {tabs.map((v) => (
          <Tab
            type='button'
            mod={v == view && 'on'}
            draggable
            // a tab flies its OWN view: stop the head's dragstart from
            // overwriting the payload with the current one
            onDragStart={(ev: DragEvent) => {
              ev.stopPropagation()
              dragData(ev, p.eid, v)
            }}
            onClick={() => {
              if (v == view) return
              peek.value = peek.peek().map((x) =>
                x == p ? { ...p, view: v } : x
              )
            }}
            key={v}
            aria-label={v}
            data-tip={v}
          >
            <TabFace view={v} eid={p.eid} />
          </Tab>
        ))}
      </Head>
      <Body>
        <Entity eid={p.eid} view={`Card.${view}`} />
      </Body>
      {resizeDirs.map((d) => (
        <div
          key={d}
          class={`Handle Handle-${d}`}
          onPointerDown={(e: PointerEvent) => resize(e, d)}
          onDblClick={() => reset(d)}
        />
      ))}
    </Frame>
  )
}

export let Peek = () => {
  let stack = peek.value

  useLayoutEffect(() => {
    if (!stack.length) return
    let away = (ev: PointerEvent) => {
      // Popout editors portal into a body-mounted .Overlay (overlay.tsx),
      // so containment can't see them — pressing one is USING the stack,
      // and dismissing here would unmount the control before its click.
      if (
        ev.target instanceof Element && !ev.target.closest('.Peek, .Overlay') &&
        !stack.some((p) => p.from?.contains(ev.target as Node))
      ) peek.value = []
    }
    let key = (ev: KeyboardEvent) => {
      let typing = ev.target instanceof HTMLElement &&
        ev.target.matches('input, textarea, [contenteditable]')
      if (peekKey(ev.key, typing)) {
        ev.stopPropagation()
        peek.value = popPeek(peek.peek())
      }
    }
    addEventListener('pointerdown', away)
    addEventListener('keydown', key, true)
    return () => {
      removeEventListener('pointerdown', away)
      removeEventListener('keydown', key, true)
    }
  }, [stack])

  return <>{stack.map((p, i) => <PeekCard p={p} key={`${p.eid}:${i}`} />)}</>
}
