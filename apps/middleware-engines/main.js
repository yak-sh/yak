import {
  delay,
  engine,
  experiment,
  middleware,
  observe,
  passthrough,
  rename,
  send,
  store,
  transfer,
  watch,
} from './model.js'

export let status = (state) => {
  let row = state.uploads[0]
  if (!row) return 'Nothing queued'
  if (row.status === 'queued') return 'Queued · waiting to start'
  if (row.status === 'complete') return 'Upload complete'
  return `Uploading · ${row.progress}%`
}

let insights = [
  'Same input, different receipt. Middleware holds UPLOAD_QUEUED before the reducer. The engine has no interception hook: the reducer already received that exact action.',
  'The transfer is delayed on both sides. Middleware delays dispatch itself; the engine delays the work described by state. The original engine action has already committed.',
  'Middleware renames UPLOAD_QUEUED to SEND_FILE and consumes it. The engine observes the queued work and dispatches a separate UPLOAD_STARTED action.',
  'Both publish progress with new actions. Engines retain that flexibility: a new dispatch is allowed; changing the action already in flight is not.',
  'Both widgets read progress from their stores. Shared state is useful in either design; the engine’s narrower interface preserves the original dispatch.',
  'Same result, different trace. UPLOAD_QUEUED reached the engine reducer unchanged. In the intercepting middleware, it never arrived. Try “Watch state” to see middleware preserve it too.',
]
let observed = [
  'Both reducers receive the same UPLOAD_QUEUED immediately. Middleware can watch state too. Here it chooses to preserve dispatch; the engine has no interception hook at all.',
  'Both observers read queued intent from their stores. Waiting to perform a transfer does not require delaying the action that recorded it.',
  'Both observers start the shared transfer and dispatch a new UPLOAD_STARTED. Neither rewrites the original UPLOAD_QUEUED.',
  'Identical progress, identical actions. The distinction is the available interface, not whether state observation or side-effects are possible.',
  'The middleware behaves like an engine in this mode. It still has a next(action) interception point; the engine only has state access and new dispatches.',
  'The runs match. Middleware can follow this discipline; engines make it the interface. Switch back to “Intercept” to see the capability being removed.',
]

export let mount = (document, timers = globalThis) => {
  let mode = 'intercept', demo = experiment(mode), playing = null
  let one = (selector) => document.querySelector(selector)
  let text = (selector, value) => one(selector).textContent = value
  let button = (id) => one(`#${id}`)
  let list = (selector, rows) => {
    one(selector).replaceChildren(...rows.map((row) => {
      let item = document.createElement('li')
      item.textContent = row
      return item
    }))
  }
  let lane = (side, model) => {
    let state = model.getState(), row = state.uploads[0]
    text(`[data-state="${side}"]`, JSON.stringify(state, null, 2))
    text(
      `[data-count="${side}"]`,
      `${state.uploads.length} upload${state.uploads.length === 1 ? '' : 's'}`,
    )
    text(`[data-widget="${side}"]`, row ? status(state) : 'No upload in state')
    text(`[data-status="${side}"]`, status(state))
    one(`[data-progress="${side}"]`).value = row?.progress ?? 0
    text(`[data-total="${side}"]`, model.actions.length)
    let original = model.actions.find(({ action }) =>
      action.type === 'UPLOAD_QUEUED'
    )
    text(
      `[data-receipt="${side}"]`,
      !demo.started()
        ? 'Original action: not dispatched'
        : original
        ? 'UPLOAD_QUEUED → reducer · unchanged'
        : demo.time.now() < 2
        ? 'UPLOAD_QUEUED → held before reducer'
        : 'UPLOAD_QUEUED → renamed and consumed · never reached reducer',
    )
    list(
      `[data-actions="${side}"]`,
      model.actions.length
        ? model.actions.map(({ action }) =>
          action.type + (action.progress ? ` · ${action.progress}%` : '')
        )
        : ['No actions yet.'],
    )
    text(`[data-traces="${side}"]`, `${model.events.length} events`)
    list(
      `[data-trace="${side}"]`,
      model.events.map((event) =>
        `t${event.at} · ${event.where} — ${event.text}`
      ),
    )
    let runtime = model.pending?.length
      ? 'Held in middleware: UPLOAD_QUEUED (architecture.pdf).'
      : row?.status === 'queued'
      ? 'Observer reads the queue in state; no private queue.'
      : row?.status === 'uploading'
      ? 'Shared transfer simulator is running.'
      : 'No pending work.'
    text(`[data-runtime="${side}"]`, runtime)
  }
  let render = () => {
    lane('left', demo.left)
    lane('right', demo.right)
    button('start').disabled = demo.started()
    button('step').disabled = !demo.started() || demo.done() || playing !== null
    button('reset').disabled = !demo.started()
    button('play').disabled = demo.done()
    text(
      '#play',
      playing !== null
        ? 'Pause walkthrough'
        : demo.started()
        ? 'Play remaining steps'
        : 'Play walkthrough',
    )
    text('#clock', demo.started() ? `Tick ${demo.time.now()} / 5` : 'Ready')
    if (demo.started()) {
      text(
        '#insight',
        (mode === 'observe' ? observed : insights)[demo.time.now()],
      )
    } else {text(
        '#insight',
        'Queue an upload and compare the original action’s receipt. Then try the other middleware behavior.',
      )}
    document.querySelectorAll('[data-phase]').forEach((item) => {
      let current = demo.started() &&
        Number(item.dataset.phase) === demo.time.now()
      item.classList.toggle('current', current)
    })
  }
  let pause = () => {
    if (playing !== null) timers.clearInterval(playing)
    playing = null
  }
  button('start').onclick = () => {
    demo.start()
    render()
  }
  button('step').onclick = () => {
    demo.step()
    render()
  }
  button('reset').onclick = () => {
    pause()
    demo = experiment(mode)
    render()
  }
  button('play').onclick = () => {
    if (playing !== null) {
      pause()
      render()
      return
    }
    demo.start()
    playing = timers.setInterval(() => {
      demo.step()
      if (demo.done()) pause()
      render()
    }, 2600)
    render()
  }
  button('mode').onchange = () => {
    pause()
    mode = button('mode').value
    demo = experiment(mode)
    text(
      '#middleware-flow',
      mode === 'observe'
        ? 'Pass through · watch state'
        : 'Delay · rename · send',
    )
    one('.middleware .flow').setAttribute(
      'aria-label',
      mode === 'observe'
        ? 'Action passes unchanged to the store; middleware watches state and dispatches separate result actions'
        : 'Action flows through delay, rename, and transport middleware before lifecycle actions reach the reducer',
    )
    render()
  }
  text('#store-code', store.toString())
  text(
    '#middleware-code',
    [middleware, passthrough, delay, rename, send].map((fn) => fn.toString())
      .join('\n\n'),
  )
  text(
    '#engine-code',
    [engine, observe, watch].map((fn) => fn.toString()).join('\n\n'),
  )
  text('#transfer-code', transfer.toString())
  render()
  return { stop: pause }
}

if (typeof document !== 'undefined') mount(document)
