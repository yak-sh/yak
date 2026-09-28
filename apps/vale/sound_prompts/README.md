# Sound generation provenance

Each JSON file names a WAV blob in the Vale store by its SHA-256 hash. It
records the exact Seed Audio request prompt, model, endpoint and format, plus
the deterministic trim or overlap crossfade used to make the game asset.
`../samples.ts` selects the six sounds heard in the app. The WAV bytes stay in
the blob store. The two ambient recordings are crossfaded into seamless loops.
