import { signal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { navigationQuery } from '../navigation.ts'
import { mode } from '../live.ts'
import { block } from './ui.tsx'
import { useQuery } from './useQuery.ts'
import { follow } from './nav.tsx'
import { idOf } from '../types.ts'
import { AccountTab } from './Account.tsx'
import { Icon } from './icons.tsx'

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
  Item: 'a',
  Foot: 'footer',
})
let { Shade, Head, Title, Empty, Items, Item, Foot } = Frame

export let NavigationToggle = () => (
  <button
    class='NavigationToggle Tab'
    type='button'
    aria-label={navigationOpen.value ? 'Close navigation' : 'Open navigation'}
    aria-expanded={navigationOpen.value}
    onClick={() => toggleNavigation()}
  >
    <Icon name='list' />
  </button>
)

export let Navigation = () => {
  let favorites = useQuery(navigationQuery)
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
  return (
    <>
      <Shade
        type='button'
        aria-label='Close navigation'
        onClick={closeMobile}
      />
      <Frame>
        <Head>
          <Title>Navigation</Title>
        </Head>
        <Items>
          {favorites.map((e) => {
            let href = `/${idOf(e)}`
            return (
              <Item
                key={e.eid}
                href={href}
                onClick={(ev: MouseEvent) => {
                  follow(href)(ev)
                  closeMobile()
                }}
              >
                <span>{e.doc?.title ?? e.kind}</span>
                <code>{idOf(e)}</code>
              </Item>
            )
          })}
          {!favorites.length && (
            <Empty>Right-click an entity and choose show in navigation.</Empty>
          )}
        </Items>
        <Foot>
          <AccountTab text />
        </Foot>
      </Frame>
    </>
  )
}
