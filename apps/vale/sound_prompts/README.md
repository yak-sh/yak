# Sound generation provenance

Each JSON file names a sound blob in the Vale store by its SHA-256 hash and
records the exact Seed Audio request prompt, model, endpoint and format. The
listening set was processed into WAV; hosted builders keep the MP3 they receive.
`../samples.ts` selects the five pinned recordings and reads hosted builder
outputs for the rest. The village fire uses procedural crackles; its trial
recording remains here for provenance. Ambient recordings are crossfaded into
seamless loops when played.
