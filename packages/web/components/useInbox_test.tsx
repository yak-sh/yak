// Exercise the real view hooks/transport: absence is a server answer, not an
// empty RAM cache; counts share ownership and watch/mute keeps row policy.
import '../testing.ts'

type Frame = { sub?: string; unsub?: string; q?: string }
