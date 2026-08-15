import { useLayoutEffect, useRef } from 'preact/hooks'
import { ent, type Peeked } from '../live.ts'
import { block, el } from './ui.tsx'
import { cardMenuAt, peek } from './nav.tsx'
import { applicable, resolve } from './registry.ts'
import { dragData } from './drag.ts'
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

export let peekMove = (left: number, top: number, dx: number, dy: number) => ({
  left: Math.round(left + dx),
  top: Math.round(top + dy),
})

export let peekSize = (w: number, h: number, dx: number, dy: number) => ({
  w: Math.max(340, Math.round(w + dx)),
  h: Math.max(80, Math.round(h + dy)),
})

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
    let sx = e.clientX
    let sy = e.clientY
    let dx = 0
    let dy = 0
    let dragging = false
    let wasFree = free.current
    let drag = (e: PointerEvent) => {
      dx = e.clientX - sx
      dy = e.clientY - sy
      if (!dragging) {
        if (Math.hypot(dx, dy) < 3) return
        dragging = true
        free.current = true
        box.setPointerCapture(e.pointerId)
        box.style.willChange = 'transform'
      }
      box.style.transform = `translate(${dx}px, ${dy}px)`
    }
    let quit = () => {
      removeEventListener('pointermove', drag)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', cancel)
      box.style.transform = ''
      box.style.willChange = ''
    }
    let cancel = () => {
      quit()
      free.current = wasFree
    }
    let up = () => {
      quit()
      if (!dragging) return
      let next = peekMove(left, top, dx, dy)
      box.style.left = `${next.left}px`
      box.style.top = `${next.top}px`
      patch(next)
    }
    addEventListener('pointermove', drag)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', cancel)
  }

  let resize = (e: PointerEvent) => {
    e.stopPropagation()
    if (e.button != 0) return
    let box = root.current!
    let w = box.offsetWidth
    let h = box.offsetHeight
    let sx = e.clientX
    let sy = e.clientY
    let next = { w, h }
    let moved = false
    let wasFree = free.current
    let before = {
      width: box.style.width,
      height: box.style.height,
      maxWidth: box.style.maxWidth,
      maxHeight: box.style.maxHeight,
    }
    free.current = true
    box.setPointerCapture(e.pointerId)
    box.style.maxWidth = 'none'
    box.style.maxHeight = 'none'
    let size = (e: PointerEvent) => {
      moved = true
      next = peekSize(w, h, e.clientX - sx, e.clientY - sy)
      box.style.width = `${next.w}px`
      box.style.height = `${next.h}px`
    }
    let quit = () => {
      removeEventListener('pointermove', size)
      removeEventListener('pointerup', up)
      removeEventListener('pointercancel', cancel)
    }
    let cancel = () => {
      quit()
      Object.assign(box.style, before)
      free.current = wasFree
    }
    let up = () => {
      quit()
      if (!moved) return cancel()
      patch({
        left: box.offsetLeft,
        top: box.offsetTop,
        ...next,
      })
    }
    addEventListener('pointermove', size)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', cancel)
  }

  let style = [
    p.left != null && `left:${p.left}px`,
    p.top != null && `top:${p.top}px`,
    p.w != null && `width:${p.w}px;max-width:none`,
    p.h != null && `height:${p.h}px;max-height:none`,
  ].filter(Boolean).join(';')

  return (
    <Frame elRef={root} style={style} onContextMenu={cardMenuAt(e)}>
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
      <div class='Peek_Resize' onPointerDown={resize} />
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
