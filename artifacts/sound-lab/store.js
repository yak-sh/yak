import { song, tracks } from './music.js'

export let identities = () => ({
  composition: crypto.randomUUID(),
  patterns: Array.from({ length: 4 }, () => crypto.randomUUID()),
  channels: tracks.map(() => crypto.randomUUID()),
})

export let bundles = (value, ids) => [
  {
    entity: { eid: ids.composition },
    doc: { title: value.title },
    composition: { tempo: value.bpm, swing: value.swing },
    mix: { level: value.master, delay: value.delay },
    arrangement: { patterns: value.chain.map((i) => ids.patterns[i]) },
  },
  ...value.patterns.map((pattern, position) => ({
    entity: { eid: ids.patterns[position] },
    pattern: { composition: ids.composition, position, ...pattern },
  })),
  ...value.mix.map((settings, position) => ({
    entity: { eid: ids.channels[position] },
    channel: {
      composition: ids.composition,
      instrument: tracks[position].id,
      position,
      ...settings,
    },
  })),
]

export let restore = (rows, eid) => {
  let root = rows.find((row) => row.entity.eid === eid && row.composition)
  if (!root) throw new Error('This beat could not be found.')
  let patterns = rows.filter((row) => row.pattern).sort((a, b) =>
    a.pattern.position - b.pattern.position
  )
  let channels = rows.filter((row) => row.channel).sort((a, b) =>
    a.channel.position - b.channel.position
  )
  if (patterns.length !== 4 || channels.length !== 8) {
    throw new Error(
      'This beat is still saving. Try opening it again in a moment.',
    )
  }
  let value = song('blank')
  Object.assign(value, {
    title: root.doc?.title || 'Untitled beat',
    bpm: root.composition.tempo,
    swing: root.composition.swing,
    master: root.mix.level,
    delay: root.mix.delay,
  })
  value.patterns = patterns.map(({ pattern }) => ({
    length: pattern.length,
    steps: pattern.steps,
  }))
  value.mix = channels.map((
    { channel: { volume, pan, tone, mute, solo } },
  ) => ({ volume, pan, tone, mute, solo }))
  value.chain = root.arrangement.patterns.map((id) =>
    patterns.findIndex((row) => row.entity.eid === id)
  )
  return validate(value)
}

export let validate = (value) => {
  let number = (n, low, high) =>
    typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high
  let valid = value && typeof value.title === 'string' &&
    value.title.length <= 80 && number(value.bpm, 50, 190) &&
    number(value.swing, 0, .6) && number(value.master, 0, 1) &&
    number(value.delay, 0, .65) &&
    Array.isArray(value.patterns) && value.patterns.length === 4 &&
    value.patterns.every((p) =>
      [16, 32].includes(p.length) && Array.isArray(p.steps) &&
      p.steps.length === 8 && p.steps.every((lane) =>
        Array.isArray(lane) && lane.length === 32 && lane.every((step) =>
          step === null ||
          (typeof step === 'object' && number(step.velocity, 0, 1) &&
            (step.note === undefined || number(step.note, 24, 95)))
        )
      )
    ) &&
    Array.isArray(value.mix) && value.mix.length === 8 &&
    value.mix.every((m) =>
      number(m.volume, 0, 1) && number(m.pan, -1, 1) && number(m.tone, 0, 1) &&
      typeof m.mute === 'boolean' && typeof m.solo === 'boolean'
    ) &&
    Array.isArray(value.chain) && value.chain.length === 8 &&
    value.chain.every((p) => Number.isInteger(p) && p >= 0 && p < 4)
  if (!valid) {
    throw new Error(
      'That file is not a Sound Lab project, or contains unsupported values.',
    )
  }
  return {
    ...structuredClone(value),
    pattern:
      Number.isInteger(value.pattern) && value.pattern >= 0 && value.pattern < 4
        ? value.pattern
        : 0,
    mode: value.mode === 'chain' ? 'chain' : 'pattern',
  }
}

export let persistence = ({ apply, query, status, saved }) => {
  let ids = null, pending = null, timer = null, writing = null, revision = 0
  let flush = () => {
    clearTimeout(timer)
    if (writing) return writing.then(() => pending ? flush() : undefined)
    if (!pending) return Promise.resolve()
    ids ||= identities()
    let value = pending, version = revision, target = ids
    pending = null
    status('Saving your beat…')
    writing = apply(bundles(value, target)).then((result) => {
      if (version === revision) {
        status(
          result.pending
            ? 'Saved for recovery. Sync will finish when the studio reconnects.'
            : 'All changes saved. Your beat has its own link.',
        )
        saved(target.composition)
      }
    }).catch((error) => {
      pending ||= value
      status(
        'Save interrupted. Your beat is still here — retry Save or export a project file.',
        true,
      )
      throw error
    }).finally(() => writing = null)
    return writing
  }
  return {
    change: (value) => {
      pending = structuredClone(value)
      revision++
      clearTimeout(timer)
      timer = setTimeout(() => flush().catch(() => {}), 500)
    },
    flush,
    fork: async () => {
      await flush()
      ids = null
    },
    dirty: () => !!pending || !!writing,
    load: async (eid) =>
      restore(
        await query(
          `.entity.eid=${eid}&*|.pattern.composition=${eid}&*|.channel.composition=${eid}&*`,
        ),
        eid,
      ),
    list: () =>
      query('.composition&?doc&?created&.order=-created.at&.limit=40'),
  }
}
