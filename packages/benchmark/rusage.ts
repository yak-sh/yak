// getrusage's two leading timevals on 64-bit Linux and Darwin. Darwin uses
// a 32-bit suseconds_t followed by padding; Linux uses a 64-bit long.
// Apple declares these in xnu/bsd/sys/_types/_timeval.h and sys/_types.h.
export let layouts: Partial<
  Record<string, { library: string; micros: 32 | 64 }>
> = {
  linux: { library: 'libc.so.6', micros: 64 },
  darwin: { library: '/usr/lib/libSystem.B.dylib', micros: 32 },
}

/** User plus system CPU time, in milliseconds, from struct rusage's
 * leading two timevals. Both supported architectures are little endian. */
export let milliseconds = (usage: DataView, micros: 32 | 64): number => {
  let seconds = usage.getBigInt64(0, true) + usage.getBigInt64(16, true)
  let fraction = (at: number) =>
    micros == 32
      ? usage.getInt32(at, true)
      : Number(usage.getBigInt64(at, true))
  return Number(seconds) * 1000 + (fraction(8) + fraction(24)) / 1000
}
