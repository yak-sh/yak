// The provider-neutral spawn default. Every door inherits a calling session
// first; without one, they meet here so a comment, command bar, CLI, and tool
// cannot silently choose different agents.

type Provider = { name: string; models: string[] }
type Spawn = { provider?: string; model?: string }

let first = 'gpt-5.6-sol'

export let modelOrder = (a: string, b: string) =>
  Number(b == first) - Number(a == first)

export let spawnDefault = (
  ps: Provider[],
  want: Spawn = {},
): Spawn => {
  let model = want.model
  let p = want.provider
    ? ps.find((p) => p.name == want.provider)
    : model
    ? ps.find((p) => p.models.includes(model))
    : ps.find((p) => p.models.includes(first)) ?? ps[0]
  return {
    provider: want.provider ?? p?.name,
    model: want.model ?? (p?.models.includes(first) ? first : p?.models[0]),
  }
}
