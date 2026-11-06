// The yak waiting (mascot.ts `idle`): an `<img data-idle="loop:ms …">` sits
// on his rest frame, and every 5 to 9 seconds plays one of his loops, in a
// shuffled order that plays each before any comes again. Every loop starts
// and ends on the rest frame, so going into one and back is seamless. While
// a page names one of his loops in his `data-doing` (the Operator's chat,
// for what it is doing, T-144829), he plays that one over and over instead.
// A person who asks for less motion keeps him at rest.
//
// Each loop is fetched once, just before it first plays, at the density the
// browser chose for the rest frame, and shown through its own object URL each
// time so it starts from its first frame. A loop that cannot be fetched
// rejects, which the page's reporter files (report.js), and he goes on
// waiting. A browser may refuse to decode ahead a loop that loads fine
// (Safari's "Loading error." on an animated picture), so a refusal only
// counts once the loop itself fails to load.
{
  let still = matchMedia('(prefers-reduced-motion: reduce)')
  // `names` in a random order that does not begin with `last`
  let shuffled = (names, last) => {
    let a = [...names]
    for (let i = a.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    if (a[0] == last) a.push(a.shift())
    return a
  }
  // `img` decoded, or at least loaded; rejects only when it cannot load
  let ready = (img, name) =>
    img.decode().catch(() =>
      new Promise((ok, no) => {
        let failed = () =>
          no(new Error(`The waiting yak's ${name} loop did not load`))
        if (img.complete) return img.naturalWidth ? ok() : failed()
        img.addEventListener('load', ok, { once: true })
        img.addEventListener('error', failed, { once: true })
      })
    )
  for (let img of document.querySelectorAll('img[data-idle]')) {
    let loops = new Map(img.dataset.idle.split(' ').map((l) => l.split(':')))
    let rest = {
      src: img.getAttribute('src'),
      srcset: img.getAttribute('srcset'),
    }
    let order = [], last
    let next = () => {
      if (!order.length) order = shuffled(loops.keys(), last)
      return last = order.shift()
    }
    let blobs = new Map()
    let fetched = (name) => {
      let file = (img.currentSrc || rest.src).replace(
        '/idle-rest-',
        `/idle-${name}-`,
      )
      if (!blobs.has(name)) {
        blobs.set(
          name,
          fetch(file).then((r) => {
            if (!r.ok) {
              throw new Error(
                `The waiting yak's ${name} loop answered ${r.status}`,
              )
            }
            return r.blob()
          }),
        )
      }
      return blobs.get(name)
    }
    let coming = next(), timer, playing = false, asked
    let doing = () => {
      let name = img.getAttribute('data-doing')
      return loops.has(name) ? name : undefined
    }
    // a loop asked for, or the one the page says he is doing, comes at once;
    // else he rests 5 to 9 seconds
    let wait = (soon = !still.matches && !!(asked ?? doing())) => {
      clearTimeout(timer)
      timer = setTimeout(play, soon ? 0 : 5000 + Math.random() * 4000)
      let name = asked ?? doing() ?? coming
      // fetched ahead; a failure is fetched and reported again when it plays
      if (!still.matches) fetched(name).catch(() => blobs.delete(name))
    }
    let play = async () => {
      if (!img.isConnected) return
      let name = asked ?? doing()
      asked = undefined
      if (!name) name = coming, coming = next()
      // with less motion asked for, or while he is out of sight (wander.js
      // hides him while he walks), he waits at rest
      if (
        still.matches ||
        img.checkVisibility?.({ visibilityProperty: true }) === false
      ) return wait(false)
      playing = true
      let url
      try {
        url = URL.createObjectURL(await fetched(name))
        let shown = new Image()
        shown.src = url
        await ready(shown, name)
      } catch (e) {
        blobs.delete(name)
        playing = false
        wait(false)
        throw e
      }
      img.removeAttribute('srcset')
      img.src = url
      setTimeout(() => {
        img.src = rest.src
        img.srcset = rest.srcset
        URL.revokeObjectURL(url)
        playing = false
        wait()
      }, +loops.get(name))
    }
    // a page asks for one of his loops, as wander.js does on a click: it
    // plays now, or as the one playing ends
    img.addEventListener('idle', (e) => {
      if (!loops.has(e.detail)) return
      asked = e.detail
      if (!playing) wait()
    })
    // what he is doing changed: he takes it up as the loop playing ends
    new MutationObserver(() => playing || wait()).observe(img, {
      attributeFilter: ['data-doing'],
    })
    // once the rest frame is in, so the loops are fetched at its density
    if (img.complete) wait()
    else img.addEventListener('load', () => wait(), { once: true })
  }
}
