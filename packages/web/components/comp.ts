// Component names share one small colour vocabulary. Provenance reserves the
// warm end because it accompanies nearly every entity; other names hash into
// the remaining tones without a hand-kept component map to drift from types.ts.
export let compTone = (name: string) => {
  if (name == 'created') return '4'
  if (name == 'updated') return '5'
  let hash = 2166136261
  for (let ch of name) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619)
  return String((hash >>> 0) % 4)
}
