/** Browser boot: one local page graph, one shared-stream lease, no inspector. */
import { effect } from '@preact/signals'
import { h, render } from 'preact'
import { Atlas } from './Atlas.tsx'
import { atlas } from './model.ts'

export let boot = (): (() => void) => {
  let root = document.getElementById('visualize-root')
  if (!root) throw new Error('visualize root is missing')
  let model = atlas({
    scheme: matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  })
  let theme = document.getElementById('visualize-theme') as HTMLLinkElement | null
  let stop = effect(() => {
    let state = model.state
    document.documentElement.style.colorScheme = state.scheme
    document.documentElement.dataset.theme = state.theme
    document.documentElement.dataset.scheme = state.scheme
    let path = `/visualize/themes/${state.theme}.css`
    if (theme && theme.getAttribute('href') != path) theme.href = path
  })
  render(h(Atlas, { model }), root)
  let closed = false
  let close = () => {
    if (closed) return
    closed = true
    removeEventListener('pagehide', hide)
    removeEventListener('pageshow', show)
    stop()
    model.close()
    render(null, root)
  }
  let hide = (event: PageTransitionEvent) => {
    if (event.persisted) model.set({ paused: true })
    else close()
  }
  let show = (event: PageTransitionEvent) => {
    if (event.persisted && !closed) model.set({ paused: false })
  }
  addEventListener('pagehide', hide)
  addEventListener('pageshow', show)
  return close
}
