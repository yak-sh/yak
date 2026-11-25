// Read the page's colours with the browser's CSS cascade, including linked
// sheets, custom properties and the active colour scheme. The manifest
// request carries the result so it can be kept by the installer for launch.
;(() => {
  let start = (doc: Document) => {
    let view = doc.defaultView
    let manifest = doc.querySelector<HTMLLinkElement>('link[data-yak-manifest]')
    let meta = doc.querySelector<HTMLMetaElement>('meta[data-yak-theme-color]')
    if (!view || (!manifest && !meta) || view.top != view) return

    let canvas = doc.createElement('canvas')
    canvas.width = canvas.height = 1
    let pixel = canvas.getContext('2d', { willReadFrequently: true })
    if (!pixel) return

    let scheme = view.matchMedia('(prefers-color-scheme: dark)')
    let root = doc.documentElement
    let swatch = doc.createElement('span')
    swatch.hidden = true

    let solid = (color: string) => {
      pixel.clearRect(0, 0, 1, 1)
      if (!view.CSS.supports('color', color)) return null
      pixel.fillStyle = color
      pixel.fillRect(0, 0, 1, 1)
      let [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data
      return a == 255
        ? [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
        : null
    }

    let token = (name: string) => {
      if (!view.getComputedStyle(swatch).getPropertyValue(name).trim()) {
        return null
      }
      swatch.style.color = `var(${name})`
      return solid(view.getComputedStyle(swatch).color)
    }

    let paint = () => {
      if (!doc.body) return
      doc.body.append(swatch)
      let page = view.getComputedStyle(root)
      let body = view.getComputedStyle(doc.body)
      // The root paints the canvas, or HTML propagates a transparent root's
      // body background. For an image or gradient use the declared canvas tone
      // when the app has one.
      let background = solid(page.backgroundColor) ??
        (page.backgroundImage == 'none' ? solid(body.backgroundColor) : null) ??
        token('--bg')
      swatch.style.color = 'Canvas'
      background ??= solid(view.getComputedStyle(swatch).color)

      let authored = Array.from(doc.querySelectorAll<HTMLMetaElement>(
        'meta[name="theme-color" i]:not([data-yak-theme-color])',
      )).find(({ media, content }) =>
        content && (!media || view.matchMedia(media).matches)
      )
      let theme = (authored && solid(authored.content)) ||
        token('--theme-color') || token('--accent') || background
      swatch.remove()

      if (!meta && manifest && !authored) {
        meta = doc.createElement('meta')
        meta.setAttribute('data-yak-theme-color', '')
        doc.head.append(meta)
      }
      if (meta && theme) {
        meta.media = `(prefers-color-scheme: ${
          scheme.matches ? 'dark' : 'light'
        })`
        meta.content = authored ? '' : '#' + theme
        meta.name = 'theme-color'
      }
      if (manifest) {
        let url = new URL(manifest.href)
        if (background) url.searchParams.set('background_color', background)
        if (theme) url.searchParams.set('theme_color', theme)
        if (manifest.href != url.href) manifest.href = url.href
      }
    }

    // Run before paint when the render-blocking CSS is ready, and again once
    // asynchronous sheets have loaded.
    view.requestAnimationFrame(paint)
    if (doc.readyState != 'complete') {
      view.addEventListener('load', paint, { once: true })
    }
    scheme.addEventListener('change', paint)
  }

  if (typeof document != 'undefined') {
    if (document.readyState == 'loading') {
      document.addEventListener('DOMContentLoaded', () => start(document), {
        once: true,
      })
    } else start(document)
  }
})()
