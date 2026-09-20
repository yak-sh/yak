import { signal } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'
import { favoritePin, navigationQuery, navigationView } from '../navigation.ts'
import { cache, ent, mode, mutate } from '../live.ts'
import { block } from './ui.tsx'
import { useQuery } from './useQuery.ts'
import { ConfigTab } from './Config.tsx'
import { Entity } from './Entity.tsx'
import { Icon } from './icons.tsx'
import { CARD_DATA, cardData } from './drag.ts'

let narrow = () => globalThis.matchMedia?.('(max-width: 700px)').matches
let remembered = globalThis.localStorage?.getItem('tasks-navigation')
export let navigationOpen = signal(
  remembered ? remembered == 'open' : !narrow(),
)

export let toggleNavigation = (open = !navigationOpen.value) => {
  navigationOpen.value = open
  globalThis.localStorage?.setItem('tasks-navigation', open ? 'open' : 'shut')
}

export let navigationKey = (
  key: string,
  repeat = false,
  typing = false,
  modified = false,
) => {
  if (mode.value != 'normal' || repeat || typing || modified || key != 'n') {
    return false
  }
  toggleNavigation()
  return true
}

let Frame = block('aside', 'Navigation', {
  Shade: 'button',
  Head: 'header',
  Title: 'span',
  Empty: 'p',
  Items: 'nav',
  Foot: 'footer',
})
let { Shade, Head, Title, Empty, Items, Foot } = Frame

export let NavigationToggle = () => (
  <button
    class='NavigationToggle Tab'
    type='button'
    aria-label={navigationOpen.value ? 'Close navigation' : 'Open navigation'}
    aria-expanded={navigationOpen.value}
    onClick={() => toggleNavigation()}
  >
    <Icon name='menu' />
  </button>
)

export let Navigation = () => {
  let favorites = useQuery(navigationQuery)
  let [over, setOver] = useState(false)
  useEffect(() => {
    let key = (e: KeyboardEvent) => {
      let typing = e.target instanceof HTMLElement &&
        e.target.matches('input, textarea, select, [contenteditable]')
      if (
        navigationKey(
          e.key,
          e.repeat,
          typing,
          e.metaKey || e.ctrlKey || e.altKey,
        )
      ) e.preventDefault()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  if (!navigationOpen.value) return null
  let closeMobile = () => narrow() && toggleNavigation(false)
  let accepts = (ev: DragEvent) =>
    !!ev.dataTransfer && Array.from(ev.dataTransfer.types).includes(CARD_DATA)
  let drop = (ev: DragEvent) => {
    let data = cardData(ev.dataTransfer?.getData(CARD_DATA) ?? '')
    setOver(false)
    if (!data || !cache.peek()[data.target]) return
    ev.preventDefault()
    ev.stopPropagation()
    let change = favoritePin(ent(data.target))
    if (change) mutate(change)
  }
  return (
    <>
      <Shade
        type='button'
        aria-label='Close navigation'
        onClick={closeMobile}
      />
      <Frame
        mod={over && 'drop'}
        onDragOver={(ev: DragEvent) => {
          if (!accepts(ev)) return
          ev.preventDefault()
          ev.dataTransfer!.dropEffect = 'link'
          setOver(true)
        }}
        onDragLeave={(ev: DragEvent) => {
          let to = ev.relatedTarget
          let from = ev.currentTarget as Node | null
          if (!(to instanceof Node) || !from?.contains(to)) {
            setOver(false)
          }
        }}
        onDrop={drop}
      >
        <Head>
          <Title>Navigation</Title>
        </Head>
        <Items>
          {favorites.map((e) => (
            <Entity
              key={e.eid}
              eid={e.eid}
              view={navigationView}
              onOpen={closeMobile}
            />
          ))}
          {!favorites.length && (
            <Empty>
              Drop an entity here, or right-click it and choose show in
              navigation.
            </Empty>
          )}
        </Items>
        <Foot>
          <ConfigTab text />
        </Foot>
      </Frame>
    </>
  )
}
