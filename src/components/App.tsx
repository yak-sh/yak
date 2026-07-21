import { ent } from '../live.ts'
import { block, el } from './ui.tsx'
import { filterable, FilterInput } from './Filter.tsx'
import { applicable } from './registry.ts'
import { icons } from './Card.tsx'
import { Icon } from './icons.tsx'
import { Menu, menu, navigate, route, screenTarget } from './nav.tsx'
import { Peek } from './Peek.tsx'
import { Run, run } from './Run.tsx'
import { Status } from './Status.tsx'
import { View } from './View.tsx'
import { tips } from './overlay.tsx'

tips() // mount the one delegated [data-tip] tooltip (idempotent)

let Frame = block('main', 'App', { Bar: 'header', Brand: 'a', Body: 'div' })
let { Bar, Brand, Body } = Frame
let Tab = el('button', 'Tab')

// The URL names the root: `/` = the root canvas, `/T-123` = that entity
// fullscreened, `?v=` picks the view. The bar is chrome — brand, the
// compact Card.Title, the view tabs — and the body renders the ROOT face
// (no context: a doc-carrier gets the document h1 from Show, and the
// bar's title text sleeps until that h1 scrolls away). The vim statusbar
// keeps the floor.
export let App = () => {
  let t = screenTarget()
  if (!t) return <Frame />
  let e = ent(t.eid)
  let tabs = applicable(e)
  let view = t.view && tabs.includes(t.view) ? t.view : tabs[0]
  let show = (v: string) => {
    let url = new URL(route.value, 'http://x')
    if (v == tabs[0]) url.searchParams.delete('v')
    else url.searchParams.set('v', v)
    navigate(url.pathname + url.search)
  }
  return (
    <Frame
      onPointerDown={() => {
        if (menu.value) menu.value = null
        if (run.value) run.value = null // a press outside is a cancel
      }}
    >
      <Bar>
        <Brand href='/'>Tasks</Brand>
        <View eid={e.eid} view='Card.Title' />
        {filterable.has(view) && <FilterInput eid={e.eid} />}
        {tabs.map((v) => (
          <Tab
            type='button'
            key={v}
            mod={v == view && 'on'}
            aria-label={v}
            data-tip={v}
            onClick={() => v != view && show(v)}
          >
            <Icon name={icons[v]} />
          </Tab>
        ))}
      </Bar>
      <Body>
        <View eid={e.eid} view={view} />
      </Body>
      <Menu />
      <Peek />
      <Run />
      <Status />
    </Frame>
  )
}
