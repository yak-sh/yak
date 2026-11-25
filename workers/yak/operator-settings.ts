import type { Space } from './directory.ts'
import type { Settings as PageSettings } from '@yaks/platform/operator-settings'

/** The Operator's settings, as its page and its door speak them. Its persona
 * keeps them as its own words: the name is its `doc{title}`, the voice its
 * @yaks/speech `speech{voice, pace, model, backend}`, and the cache its
 * @yaks/model `cache{retention}`; none, the platform's own. */
export type Settings = PageSettings & { cache_retention?: number | null }

/** `space` as its Operator's settings say: theirs where the persona holds
 * them, a setting it does not hold being the platform's own. */
export let worn = (space: Space, own: Settings): Space => ({
  ...space,
  operator: own.name || space.operator,
  voice: own.voice ?? null,
  voice_speed: own.voice_speed ?? null,
  voice_model: own.voice_model ?? null,
  voice_backend: own.voice_backend ?? null,
  cache_retention: own.cache_retention ?? null,
})

/** The settings `space` wears (`worn`), as its settings page draws them
 * (@yaks/platform/operator-settings). */
export let wearing = (space: Space) => ({
  name: space.operator,
  voice: space.voice ?? null,
  voice_speed: space.voice_speed ?? null,
  voice_model: space.voice_model ?? null,
  voice_backend: space.voice_backend ?? null,
})
