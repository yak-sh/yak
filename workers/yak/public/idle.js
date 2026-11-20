// The yak waiting (mascot.ts `idle`): an `<img data-idle="loop:ms …">` sits
// on his rest frame, and every 5 to 9 seconds plays one of his loops, in a
// shuffled order that plays each before any comes again. Every loop starts
// and ends on the rest frame, so going into one and back is seamless. While
// a page names one of his poses in his `data-pose` (the Operator's chat, for
// what it is doing: mascot.ts `MOVES`), he holds that pose, thinking with his
// light bulb or checking his list, its own loop playing over and over, and
// takes up his waiting again once it is gone. A person who asks for less
// motion keeps him at rest, or in the pose's still frame.
//
// Each loop is fetched once, just before it first plays, at the density the
// browser chose for the rest frame, and shown through its own object URL each
// time so it starts from its first frame. A loop yaks.app does not serve
// rejects, which the page's reporter files (report.js), and he goes on
// waiting. A browser may refuse to decode ahead a loop that loads fine
// (Safari's "Loading error." on an animated picture), so only the load
// counts; and a loop he was served that the browser will not load (some
// Safaris, from its object URL) is the browser's, not ours: he leaves that
// one out from then on and rests, still and quiet, where he would play it.
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
  // whether `img` loads: true once decoded, or at least loaded
  let shows = (img) =>
    img.decode().then(() => true, () =>
      new Promise((ok) => {
        if (img.complete) return ok(!!img.naturalWidth)
        img.addEventListener('load', () => ok(true), { once: true })
        img.addEventListener('error', () => ok(false), { once: true })
      }))
  for (let img of document.querySelectorAll('img[data-idle]')) {
    let loops = new Map(img.dataset.idle.split(' ').map((l) => l.split(':')))
    let rest = {
      src: img.getAttribute('src'),
      srcset: img.getAttribute('srcset'),
    }
    // the loops this browser would not show
    let gone = new Set()
    let order = [], last
    let next = () => {
      order = order.filter((n) => !gone.has(n))
      if (!order.length) {
        order = shuffled([...loops.keys()].filter((n) => !gone.has(n)), last)
      }
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
    let coming = next(), timer, playing = false, asked, posed = false
    let pose = () => img.getAttribute('data-pose') || undefined
    // his rest frame's files, with `name` in place of the rest's
    let as = (name) => ({
      src: rest.src.replace('/idle-rest-128', `/${name}`),
      srcset: rest.srcset?.replaceAll('/idle-rest-128', `/${name}`),
    })
    let put = ({ src, srcset }) => {
      img.src = src
      if (srcset) img.srcset = srcset
      else img.removeAttribute('srcset')
    }
    // the pose the page names, held, or once it is gone, his waiting again
    let posing = () => {
      let name = pose()
      if (name) {
        clearTimeout(timer)
        posed = true
        return put(as(still.matches ? `${name}-still` : name))
      }
      if (!posed) return playing || wait()
      posed = false
      if (!playing) put(rest), wait()
    }
    // a loop asked for comes at once; else he rests 5 to 9 seconds
    let wait = (soon = !still.matches && !!asked) => {
      clearTimeout(timer)
      if (pose()) return
      timer = setTimeout(play, soon ? 0 : 5000 + Math.random() * 4000)
      let name = asked ?? coming
      // fetched ahead; a failure is fetched and reported again when it plays
      if (!still.matches && name && !gone.has(name)) {
        fetched(name).catch(() => blobs.delete(name))
      }
    }
    let play = async () => {
      if (!img.isConnected || pose()) return
      let name = asked
      asked = undefined
      if (!name) name = coming, coming = next()
      // with less motion asked for, while he is out of sight (wander.js
      // hides him while he walks), or with no loop this browser shows, he
      // waits at rest
      if (
        !name || gone.has(name) || still.matches ||
        img.checkVisibility?.({ visibilityProperty: true }) === false
      ) return wait(false)
      playing = true
      let url
      try {
        url = URL.createObjectURL(await fetched(name))
      } catch (e) {
        blobs.delete(name)
        playing = false
        wait(false)
        throw e
      }
      let shown = new Image()
      shown.src = url
      if (!await shows(shown)) {
        URL.revokeObjectURL(url)
        blobs.delete(name)
        gone.add(name)
        if (coming == name) coming = next()
        playing = false
        return wait(false)
      }
      if (pose()) return URL.revokeObjectURL(url), playing = false
      put({ src: url })
      setTimeout(() => {
        URL.revokeObjectURL(url)
        playing = false
        if (pose()) return
        put(rest)
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
    // what he is doing changed: a pose comes at once, cutting a loop short
    new MutationObserver(posing).observe(img, {
      attributeFilter: ['data-pose'],
    })
    // once the rest frame is in, so the loops are fetched at its density
    if (img.complete) posing()
    else img.addEventListener('load', posing, { once: true })
  }
}
