import { useEffect, useRef } from 'preact/hooks'
import { useSignal } from '@preact/signals'
import { IS_BROWSER } from 'fresh/runtime'
import { send, sock } from '../live.ts'

// A card's titlebar: one tab per matching view. Picking one is client-side —
// patch the card comp over the sync socket, fetch the re-rendered view
// fragment, and swap it into the card's scroller. A card patch arriving from
// another client swaps ours the same way.
export let Tabs = ({ card, target, view, views }: {
  card: string
  target: string
  view: string
  views: string[]
}) => {
  let on = useSignal(view)
  let el = useRef<HTMLElement>(null)

  let show = async (v: string) => {
    on.value = v
    let html = await (await fetch(`/view/${target}?view=${v}`)).text()
    let scroll = el.current?.closest('.Card')?.querySelector('.Card_Scroll')
    if (scroll) scroll.innerHTML = html
  }

  let pick = (v: string) => {
    if (v == on.value) return
    show(v)
    send({ eid: card, name: 'card', comp: { view: v } })
  }

  useEffect(() => {
    if (!IS_BROWSER) return
    let s = sock()
    let hear = (m: MessageEvent) => {
      for (let c of JSON.parse(String(m.data))) {
        if (c.eid == card && c.name == 'card' && c.comp?.view) {
          show(c.comp.view)
        }
      }
    }
    s.addEventListener('message', hear)
    return () => s.removeEventListener('message', hear)
  }, [card])

  return (
    <header class='Card_Tabs' ref={el}>
      {views.map((v) => (
        <button
          type='button'
          class={v == on.value ? 'Tab Tab-on' : 'Tab'}
          onClick={() => pick(v)}
          key={v}
        >
          {v}
        </button>
      ))}
    </header>
  )
}
