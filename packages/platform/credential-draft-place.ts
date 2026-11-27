/** The single-key and multi-field controls of a connection paste form. */
export let credentialDraftPlace = (place: unknown): place is string =>
  typeof place == 'string' && place.startsWith('settings:') &&
  /:(?:key|own)-[^:]+:key(?:\..+)?$/.test(place)
