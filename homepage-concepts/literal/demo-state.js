export const initial = () => ({
  version: 1,
  published: false,
  checklist: false,
  receipts: [],
  reservations: [],
  items: [
    {
      id: 'projector',
      name: 'Projector',
      mark: '▣',
      note: 'For film nights and presentations.',
    },
    {
      id: 'speaker',
      name: 'Portable speaker',
      mark: '▥',
      note: 'Charged and ready to go.',
    },
    {
      id: 'screen',
      name: 'Outdoor screen',
      mark: '▱',
      note: 'Two people make setup easier.',
    },
  ],
})
export function reserve(state, item, person) {
  if (!state.items.some((i) => i.id === item) || !person.trim()) {
    return { state, message: 'Choose an item and enter your name.' }
  }
  if (state.reservations.some((r) => r.item === item)) {
    return {
      state,
      message: 'Already reserved for Saturday. Pick another item.',
    }
  }
  return {
    state: {
      ...state,
      reservations: [...state.reservations, {
        item,
        person: person.trim().slice(0, 40),
        returned: false,
      }],
    },
    message: 'Reservation saved for Saturday.',
  }
}
export function act(state, action) {
  if (action === 'publish') return { ...state, published: true }
  if (action === 'neighbor') {
    return reserve(state, 'speaker', 'Priya (demo neighbor)').state
  }
  if (action === 'checklist') return { ...state, checklist: true }
  return state
}
export function summary(state) {
  const missing = state.items.filter((i) =>
    !state.reservations.some((r) => r.item === i.id)
  ).map((i) => i.name.toLowerCase())
  return missing.length
    ? `Not everything is reserved yet. Still needed: ${
      missing.join(', ')
    }. Reserve them in the app to update this answer.`
    : 'All three items are reserved for Saturday. The people named on the reservations can coordinate pickup.'
}
