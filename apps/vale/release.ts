// The release notice belongs to the glass, not a sheet: it leaves the
// scene and any draft usable, and reloads only when its button is pressed.
export let releaseNotice = (
  glass: HTMLElement,
  gate: HTMLElement,
  reload = () => location.reload(),
) => {
  let latest = -1
  let box: HTMLElement | undefined
  let measured = new ResizeObserver(() => size())
  let size = () => {
    let height = box ? `${box.getBoundingClientRect().height}px` : '0px'
    glass.style.setProperty('--release-height', glass.hidden ? '0px' : height)
    gate.style.setProperty('--release-height', glass.hidden ? height : '0px')
  }
  let place = () => {
    if (box) (glass.hidden ? gate : glass).append(box)
    size()
  }
  let visibility = new MutationObserver(place)
  visibility.observe(glass, { attributes: true, attributeFilter: ['hidden'] })
  let key = (version: number) =>
    `yak-release:${new URL('api/release', location.href).pathname}:${version}`
  let dismissed = (version: number) => {
    try {
      return sessionStorage.getItem(key(version)) == 'dismissed'
    } catch {
      return false // A notice still works when storage is unavailable.
    }
  }
  let clear = () => {
    if (box) measured.unobserve(box)
    box?.remove()
    box = undefined
    size()
  }
  let receive = (event: Event) => {
    let release = (event as CustomEvent).detail
    if (
      !release || !Number.isSafeInteger(release.version) ||
      release.version < 0 ||
      !['optional', 'required'].includes(release.reload)
    ) return
    event.preventDefault()
    if (release.version <= latest) return
    latest = release.version
    clear()
    if (release.reload == 'optional' && dismissed(release.version)) return
    box = document.createElement('div')
    box.className = 'Release'
    box.setAttribute('role', 'status')
    let words = document.createElement('span')
    words.textContent = release.reload == 'required'
      ? 'This app has changed. Reload to keep using it'
      : 'A new version of this app is out'
    box.append(words)
    let button = (text: string, action: () => void, primary = false) => {
      let b = document.createElement('button')
      b.type = 'button'
      b.className = `Btn Btn-small${primary ? ' Btn-go' : ''}`
      b.textContent = text
      b.addEventListener('click', action)
      box!.append(b)
    }
    button('Reload', reload, true)
    if (release.reload == 'optional') {
      button('Dismiss', () => {
        try {
          sessionStorage.setItem(key(release.version), 'dismissed')
        } catch {
          // Dismiss this notice even if the tab cannot keep the choice.
        }
        clear()
      })
    }
    // Native button keys belong to the notice, not the game's shortcuts.
    box.addEventListener('keydown', (e) => e.stopPropagation())
    box.addEventListener('keyup', (e) => e.stopPropagation())
    place()
    measured.observe(box)
  }
  addEventListener('yak-release', receive)
  return () => {
    removeEventListener('yak-release', receive)
    visibility.disconnect()
    measured.disconnect()
    clear()
  }
}
