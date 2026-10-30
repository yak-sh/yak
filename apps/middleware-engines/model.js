export let initial = () => ({ uploads: [] })

export let reduce = (state, action) => {
  let { type, id, file, progress, readyAt } = action
  let row = state.uploads.find((upload) => upload.id === id)
  let patch = {
    UPLOAD_QUEUED: { id, file, status: 'queued', progress: 0, readyAt },
    UPLOAD_STARTED: { id, file, status: 'uploading', progress: 0 },
    UPLOAD_PROGRESS: { progress },
    UPLOAD_COMPLETED: { status: 'complete', progress: 100 },
  }[type]
  if (!patch) return state
  return {
    uploads: row
      ? state.uploads.map((upload) =>
        upload.id === id ? { ...upload, ...patch } : upload
      )
      : [...state.uploads, patch],
  }
}

export let store = (record = () => {}) => {
  let state = initial(), actions = [], listeners = []
  let dispatch = (action) => {
    record(action)
    state = reduce(state, action)
    actions.push({ action, state })
    listeners.slice().forEach((listen) => listen(state))
  }
  return {
    getState: () => state,
    actions,
    dispatch,
    subscribe: (listen) => {
      listeners.push(listen)
      return () => listeners = listeners.filter((item) => item !== listen)
    },
  }
}

export let clock = () => {
  let time = 0, jobs = []
  return {
    now: () => time,
    after: (delay, run) => jobs.push({ at: time + delay, run }),
    step: () => {
      time++
      let ready = jobs.filter((job) => job.at <= time)
      jobs = jobs.filter((job) => job.at > time)
      ready.forEach((job) => job.run())
    },
  }
}

// Both designs use this identical, deterministic stand-in for a network upload.
export let transfer = (time, file, dispatch) => {
  dispatch({ type: 'UPLOAD_STARTED', ...file })
  time.after(
    1,
    () => dispatch({ type: 'UPLOAD_PROGRESS', id: file.id, progress: 33 }),
  )
  time.after(
    2,
    () => dispatch({ type: 'UPLOAD_PROGRESS', id: file.id, progress: 67 }),
  )
  time.after(3, () => dispatch({ type: 'UPLOAD_COMPLETED', id: file.id }))
}

export let delay = (time, pending, trace) => (next) => (action) => {
  if (action.type !== 'UPLOAD_QUEUED') return next(action)
  pending.push(action)
  trace('Delay', 'UPLOAD_QUEUED held for two ticks; reducer has not seen it.')
  time.after(2, () => {
    pending.splice(pending.indexOf(action), 1)
    trace('Delay', 'Released UPLOAD_QUEUED to the next middleware.')
    next(action)
  })
}

export let rename = (trace) => (next) => (action) => {
  if (action.type !== 'UPLOAD_QUEUED') return next(action)
  trace('Rename', 'UPLOAD_QUEUED → SEND_FILE')
  next({ ...action, type: 'SEND_FILE' })
}

export let send = (time, dispatch, trace) => (next) => (action) => {
  if (action.type !== 'SEND_FILE') return next(action)
  trace(
    'Transport',
    'Consumed SEND_FILE; emits named upload lifecycle actions.',
  )
  transfer(time, { id: action.id, file: action.file }, dispatch)
}

export let watch = ({ read, subscribe, dispatch }, time, trace) => {
  let examine = () => {
    let ready = read().uploads.filter((file) =>
      file.status === 'queued' && file.readyAt <= time.now()
    )
    ready.forEach((file) => {
      trace('Engine', `Observed queued upload ${file.id}; begins transfer.`)
      transfer(time, { id: file.id, file: file.file }, dispatch)
    })
  }
  let stop = subscribe(examine)
  examine()
  return { examine, stop }
}

export let observe = (state, time, trace) =>
  watch(
    {
      read: state.getState,
      subscribe: state.subscribe,
      dispatch: state.dispatch,
    },
    time,
    trace,
  )

export let passthrough = (next) => (action) => next(action)

export let middleware = (time, mode = 'intercept') => {
  let pending = [], events = []
  let trace = (where, text) => events.push({ at: time.now(), where, text })
  let state = store((action) => trace('Reducer', action.type))
  let dispatch = (action) => pipeline(action)
  let pipeline = mode === 'intercept'
    ? delay(time, pending, trace)(
      rename(trace)(send(time, dispatch, trace)(state.dispatch)),
    )
    : passthrough(state.dispatch)
  let observer = mode === 'observe'
    ? observe({ ...state, dispatch }, time, trace)
    : null
  return {
    ...state,
    dispatch,
    pending,
    events,
    examine: () => observer?.examine(),
  }
}

export let engine = (time) => {
  let events = []
  let trace = (where, text) => events.push({ at: time.now(), where, text })
  let state = store((action) => trace('Reducer', action.type))
  let observer = observe(state, time, trace)
  return { ...state, events, examine: observer.examine }
}

export let experiment = (mode) => {
  let time = clock(), left = middleware(time, mode), right = engine(time)
  let started = false
  return {
    time,
    left,
    right,
    started: () => started,
    done: () => time.now() >= 5,
    start: () => {
      if (started) return
      started = true
      let file = { id: 'upload-1', file: 'architecture.pdf' }
      let action = { type: 'UPLOAD_QUEUED', ...file, readyAt: 2 }
      left.dispatch(action)
      right.dispatch(action)
    },
    step: () => {
      if (!started || time.now() >= 5) return
      time.step()
      left.examine()
      right.examine()
    },
  }
}
