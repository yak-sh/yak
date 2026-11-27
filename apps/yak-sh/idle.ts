// The painted yak idling (site.ts `IDLE`): the logo sits as the painting, and
// every 5 to 9 seconds plays one of its drawn loops, in a shuffled order that
// plays each before any comes again. Every loop starts and ends on the
// painting, and plays once, so going into one and back is seamless. A person
// who asks for less motion keeps it still.
//
// The next loop is fetched while the logo waits for it, at the width the
// browser chose for the painting, and decoded before it is shown, so nothing
// flickers. A loop that cannot be fetched rejects, and is fetched again when
// it next comes round.
import { createElement as h, useEffect, useRef } from 'react'
import { IDLE, LOGO, painted } from './site.ts'

/** `items` in a random order that does not begin with `last`. */
export let shuffled = <T>(items: T[], last?: T, random = Math.random) => {
  let a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    let j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  if (a.length > 1 && a[0] == last) a.push(a.shift()!)
  return a
}

/** The painting at `src` as its `loop` at the same width. */
export let loopOf = (src: string, loop: string) =>
  src.replace(/yak(-\d+)?\.webp$/, (_, w = '') => `yak-${loop}${w}.webp`)

/** Restore the painting's source attributes after a loop, if it has one. */
export let resting = (img: HTMLImageElement) => {
  let sources = {
    src: img.getAttribute('src'),
    srcset: img.getAttribute('srcset'),
  }
  if (!sources.src?.trim() && !sources.srcset?.trim()) return
  return () => {
    for (let [attr, value] of Object.entries(sources)) {
      if (value?.trim()) img.setAttribute(attr, value)
      else img.removeAttribute(attr)
    }
  }
}

/** Idle `img` until the returned function stops it. */
let idle = (img: HTMLImageElement, still: MediaQueryList) => {
  let restore = resting(img)
  if (!restore) return
  let order: string[] = [], last: string | undefined
  let next = () => {
    if (!order.length) order = shuffled(Object.keys(IDLE), last)
    return last = order.shift()!
  }
  let blobs = new Map<string, Promise<Blob>>()
  let fetched = (loop: string) => {
    if (!blobs.has(loop)) {
      let src = img.currentSrc || img.src
      let file = loopOf(src, loop)
      if (file == src) return
      blobs.set(
        loop,
        fetch(file).then((r) => {
          if (!r.ok) {
            throw new Error(`yak.sh's ${loop} loop answered ${r.status}`)
          }
          return r.blob()
        }),
      )
    }
    return blobs.get(loop)!
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false, url = ''
  let coming = next()
  let wait = () => {
    timer = setTimeout(play, 5000 + Math.random() * 4000)
    let loop = coming
    if (!still.matches) fetched(loop)?.catch(() => blobs.delete(loop))
  }
  let play = async () => {
    let loop = coming
    coming = next()
    if (still.matches) return wait()
    let loaded = fetched(loop)
    if (!loaded) return wait()
    try {
      url = URL.createObjectURL(await loaded)
      let frames = new Image()
      frames.src = url
      await frames.decode()
    } catch (e) {
      blobs.delete(loop)
      URL.revokeObjectURL(url)
      if (!stopped) wait()
      throw e
    }
    if (stopped) return URL.revokeObjectURL(url)
    img.removeAttribute('srcset')
    img.src = url
    timer = setTimeout(() => {
      restore()
      URL.revokeObjectURL(url)
      wait()
    }, IDLE[loop])
  }
  wait()
  return () => {
    stopped = true
    clearTimeout(timer)
    if (img.src == url) restore()
    URL.revokeObjectURL(url)
  }
}

/** The painted yak, idling once it has loaded. */
export let Logo = (
  props: {
    className: string
    sizes: string
    width: number
    height: number
    loading?: 'lazy'
  },
) => {
  let ref = useRef<HTMLImageElement>(null)
  useEffect(() => {
    let img = ref.current
    let still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!img || !still) return
    let stop: (() => void) | undefined
    let begin = () => stop = idle(img, still)
    if (img.complete) begin()
    else img.addEventListener('load', begin, { once: true })
    return () => {
      img.removeEventListener('load', begin)
      stop?.()
    }
  }, [])
  return h('img', { ref, src: painted(), srcSet: LOGO, alt: '', ...props })
}
