// The Peek: what a pressed link to an entity opens where a fine pointer reads
// (nav.tsx openAt). The entity floats over the page it was pressed on, whole,
// in the Full view its own page draws, with its title and body typed into
// right there; the page beneath stays where it was. One at a time: a link
// pressed inside it shows its entity in its place. Its Id and the head's open
// button go to the entity's page; Esc, q, the close button or a press anywhere
// else put it away. The head moves it and the corner sizes it. It is a layer
// (role dialog) to vim's keys (App.tsx, @yaks/ux/keys): Enter on a link opens
// it, the cursor walks inside it while it is up, and Esc or q sends it
// `cancel`, which puts it away and hands the cursor back to the link.
import { useLayoutEffect, useRef } from 'preact/hooks'
import { Loading, Peek as Frame, place, Tabs } from '@yaks/ui'
import { Ux } from '@yaks/ux'
import { ent, type Peeked, peeked, row, useHold } from '../live.ts'
import { entityPath } from '../url.ts'
import { idOf } from '../types.ts'
import { navigate, route } from './nav.tsx'
import { applicable, Entity, resolve } from './Entity.tsx'
import { Id } from './views/Inline.tsx'
import { Icon } from './icons.tsx'
import { moved, moveEl, resizeEl } from './drag.ts'

let { Head, Body, Grip } = Frame
let { Tab } = Tabs

let close = () => {
  peeked.value = null
}

let patch = (p: Peeked, change: Partial<Peeked>) => {
  if (peeked.peek() == p) peeked.value = { ...p, ...change }
}

// Where it floats: under the link pressed, or over it where only that side
// has room, and again as what it shows loads and its height settles, until
// it is moved or sized by hand. Opened without a link, it hangs from the top
// of the viewport's middle.
let usePlace = (el: { current: HTMLElement | null }, p: Peeked) =>
  useLayoutEffect(() => {
    let box = el.current
    if (!box || p.left != null) return
    let anchor = p.from?.getBoundingClientRect?.() ??
      { left: innerWidth / 2, top: 48, bottom: 48, width: 0 } as DOMRect
    let put = () => place(box, anchor, 'below')
    put()
    if (typeof ResizeObserver != 'function') return
    let watch = new ResizeObserver(put)
    watch.observe(box)
    return () => watch.disconnect()
  }, [p.from, p.left])

// While it is up, a press outside it (and outside the popovers and menus
// opened from it, which float in an Overlay of their own) puts it away. The
// link that opened it is not outside: pressing it again opens the entity's
// page.
let useDismiss = (p: Peeked) =>
  useLayoutEffect(() => {
    let away = (ev: Event) => {
      let at = ev.target as Element | null
      if (at?.closest?.('.Peek, .Overlay') || p.from?.contains(at)) return
      close()
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [p])

let Card = ({ p }: { p: Peeked }) => {
  let root = useRef<HTMLDivElement>(null)
  useHold({ entity: p.eid })
  usePlace(root, p)
  useDismiss(p)
  let e = ent(p.eid)
  let view = applicable(e).includes('Full') ? 'Full' : resolve(e).view
  let open = () => navigate(entityPath(idOf(e)))

  // The head carries it; a press on one of its links or buttons is that
  // control's.
  let move = (ev: PointerEvent) => {
    let box = root.current!
    if (ev.button != 0 || (ev.target as Element).closest('a, button')) return
    let { offsetLeft: left, offsetTop: top } = box
    moveEl(ev, box, () => 1, () => {}, (dx, dy) => {
      let to = moved(left, top, dx, dy)
      patch(p, { left: to.x, top: to.y })
    })
  }

  let size = (ev: PointerEvent) => {
    if (ev.button != 0) return
    ev.stopPropagation()
    let box = root.current!
    let was = box.classList.contains('Peek-sized')
    box.classList.add('Peek-sized')
    let { offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h } = box
    resizeEl(
      ev,
      ev.currentTarget as HTMLElement,
      box,
      { x, y, w, h },
      'se',
      () => 1,
      (to) => patch(p, { left: x, top: y, w: to.w ?? w, h: to.h ?? h }),
      () => was || box.classList.remove('Peek-sized'),
    )
  }

  return (
    <Frame
      elRef={root}
      role='dialog'
      aria-label={`${idOf(e)}, peeked`}
      onCancel={close}
      mod={!!(p.w || p.h) && 'sized'}
      style={{
        left: p.left == null ? undefined : `${p.left}px`,
        top: p.top == null ? undefined : `${p.top}px`,
        width: p.w ? `${p.w}px` : undefined,
        height: p.h ? `${p.h}px` : undefined,
      }}
    >
      <Head onPointerDown={move}>
        <Id e={e} />
        <Tabs>
          <Tab
            type='button'
            aria-label='Open'
            data-tip='open its page'
            onClick={open}
          >
            <Icon name='arrow-up-right' />
          </Tab>
          <Tab
            type='button'
            aria-label='Close'
            data-tip='close (Esc)'
            onClick={close}
          >
            <Icon name='x' />
          </Tab>
        </Tabs>
      </Head>
      <Body>
        {row(p.eid).value
          ? (
            // Its own owner, so its editors keep apart from the page's
            // editors of the same values (@yaks/ux).
            <Ux at='Peek'>
              <Entity eid={p.eid} view={view} talkback={false} />
            </Ux>
          )
          : <Loading />}
      </Body>
      <Grip
        onPointerDown={size}
        onDblClick={() => patch(p, { w: undefined, h: undefined })}
      />
    </Frame>
  )
}

/** The peek over this page, if one is up. */
export let Peek = () => {
  let p = peeked.value
  return p && p.at == route.value ? <Card key='peek' p={p} /> : null
}
