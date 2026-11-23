// Clicking the hero's yak (T-2895). Each click plays the next step of his
// run, which the page lists in `[data-yak-run]` (mod.tsx `YakRun`): one of
// his home poses (parts.ts `RUN`), played once over his seat, and a line in
// a speech bubble beside him. The run leads to the idea box: the step marked
// `start` puts the caret in it and types the start of a sentence there, and
// the last step, which every click after the run plays again, puts the caret
// back in the box and nudges the Build it button. A person's own words in
// the box are never touched: then he says the step's other line and points
// at the box instead.
//
// He answers only in the hero: out in the margin he lets clicks through
// (wander.js). The click is his, so wander.js leaves it be (its nose lick
// waits for a click no page answers). For anyone who asks for less motion
// he stays still: the lines and the box are the same, the typing is at
// once, and nothing wiggles.

const KEY = 45 // ms a letter, as he types

/** Which step a click plays: the next, and the last one from then on. */
export let next = (at, count) => Math.min(at + 1, count - 1)

export let run = (root) => {
  let slot = root.querySelector('.Story_Hero [data-wander]')
  let list = root.querySelector('[data-yak-run]')
  let box = root.querySelector('#say')
  let go = box?.closest('form').querySelector('.Home_Build')
  if (!slot || !list || !box) return
  let calm = matchMedia('(prefers-reduced-motion: reduce)')
  let steps = [...list.children].map((li) => ({
    pose: li.dataset.pose,
    ms: Number(li.dataset.ms),
    act: li.dataset.act ?? '',
    say: li.querySelector('[data-say]').textContent,
    had: li.querySelector('[data-had]')?.textContent,
    type: li.querySelector('[data-type]')?.textContent ?? '',
  }))

  let bubble = document.createElement('span')
  bubble.className = 'Home_YakSays'
  bubble.setAttribute('aria-hidden', 'true')
  let figure = new Image()
  figure.className = 'Home_YakPose'
  figure.alt = ''
  slot.append(figure, bubble)

  // each pose fetched once, and shown from an address of its own each time,
  // so it plays from its first frame
  let poses = new Map()
  let fetched = (name) => {
    if (!poses.has(name)) {
      poses.set(
        name,
        fetch(`/home-mascot/${name}.webp`).then((r) => {
          if (!r.ok) {
            throw new Error(`The hero yak's ${name} pose answered ${r.status}`)
          }
          return r.blob()
        }),
      )
    }
    return poses.get(name)
  }
  let ahead = (step) =>
    step && !calm.matches &&
    fetched(step.pose).catch(() => poses.delete(step.pose))

  let at = -1, posed = 0, said = 0, typing = 0
  let rest = () => {
    clearTimeout(posed)
    delete figure.dataset.on
    if (figure.src) {
      URL.revokeObjectURL(figure.src), figure.removeAttribute('src')
    }
  }
  let hush = () => (clearTimeout(said), delete bubble.dataset.on)
  let pose = async (step) => {
    rest()
    if (calm.matches) return
    let url = URL.createObjectURL(await fetched(step.pose))
    if (steps[at] != step) return URL.revokeObjectURL(url)
    figure.src = url
    figure.dataset.on = ''
    posed = setTimeout(rest, step.ms)
  }
  let say = (line, ms) => {
    hush()
    bubble.textContent = line
    // read again, so the bubble pops in each time
    void bubble.offsetWidth
    bubble.dataset.on = ''
    said = setTimeout(hush, Math.max(3600, ms + 800))
  }
  let nudge = () => {
    if (!go) return
    delete go.dataset.nudge
    void go.offsetWidth
    go.dataset.nudge = ''
  }
  go?.addEventListener('animationend', () => delete go.dataset.nudge)
  // the box, its caret after its words, and its button nudged
  let point = () => {
    box.focus()
    box.setSelectionRange(box.value.length, box.value.length)
    nudge()
  }
  // `words` typed into the box a letter at a time, stopping if the person
  // takes over
  let type = (words) => {
    clearTimeout(typing)
    box.focus()
    let put = (n) => {
      box.value = words.slice(0, n)
      box.setSelectionRange(n, n)
      box.dispatchEvent(new Event('input', { bubbles: true }))
      if (n == words.length) return nudge()
      typing = setTimeout(() => {
        if (box.value == words.slice(0, n)) put(n + 1)
      }, KEY)
    }
    put(calm.matches ? words.length : 1)
  }

  let play = (step) => {
    pose(step).catch((e) => {
      poses.delete(step.pose)
      throw e
    })
    let own = step.act == 'start' && box.value.trim()
    say(own && step.had || step.say, step.ms)
    if (step.act == 'start' && !own) type(step.type)
    else if (step.act) point()
  }

  // his click, before wander.js hears it; only while he sits in his place
  slot.addEventListener('click', (e) => {
    let wander = slot.querySelector('.Wander')
    if (wander && !wander.querySelector('.Wander_Image[data-on]')) return
    e.preventDefault()
    at = next(at, steps.length)
    play(steps[at])
    ahead(steps[next(at, steps.length)])
  }, true)
  // back from the margin he sits quietly, his run where he left it
  slot.addEventListener('home', () => (rest(), hush()), true)
  addEventListener('load', () => ahead(steps[0]), { once: true })
}
