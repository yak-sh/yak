import { fullscreenButton, screenStyle } from '@yaks/game/screen'

export let screen = (): () => void => {
  let manifest = document.querySelector<HTMLLinkElement>('link[rel=manifest]')!
  manifest.crossOrigin = 'use-credentials'
  manifest.href = new URL('manifest.webmanifest', location.href).href
  screenStyle(document)
  let button = document.querySelector<HTMLButtonElement>('#fullscreen')!
  return fullscreenButton(button, reportError)
}
