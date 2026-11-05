// The yak waiting (mascot.ts `idle`): an `<img data-idle="loop:ms …">` sits
// on his rest frame, and every 5 to 9 seconds plays one of his loops, in a
// shuffled order that plays each before any comes again. Every loop starts
// and ends on the rest frame, so going into one and back is seamless. A
// person who asks for less motion keeps him at rest.
//
// Each loop is fetched once, just before it first plays, at the density the
// browser chose for the rest frame, and shown through its own object URL each
// time so it starts from its first frame. A loop that cannot be fetched
// rejects, which the page's reporter files (report.js), and he goes on
// waiting.
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
    let coming = next(), timer, playing = false
    let wait = () => {
      timer = setTimeout(play, 5000 + Math.random() * 4000)
      let name = coming
      // fetched ahead; a failure is fetched and reported again when it plays
      if (!still.matches) fetched(name).catch(() => blobs.delete(name))
    }
    // `asked` is a loop someone asked for now (an `idle` event's detail);
    // else the next in the order
    let play = async (asked) => {
      if (!img.isConnected) return
      let name = asked ?? coming
      if (!asked) coming = next()
      // with less motion asked for, or while he is out of sight (wander.js
      // hides him while he walks), he waits at rest
      if (
        still.matches ||
        img.checkVisibility?.({ visibilityProperty: true }) === false
      ) return wait()
      playing = true
      let url
      try {
        url = URL.createObjectURL(await fetched(name))
        let shown = new Image()
        shown.src = url
        await shown.decode()
      } catch (e) {
        blobs.delete(name)
        playing = false
        wait()
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
    // a page asks for one of his loops now, as wander.js does on a click
    img.addEventListener('idle', (e) => {
      if (playing || !loops.has(e.detail)) return
      clearTimeout(timer)
      play(e.detail)
    })
    // once the rest frame is in, so the loops are fetched at its density
    if (img.complete) wait()
    else img.addEventListener('load', wait, { once: true })
  }
}
