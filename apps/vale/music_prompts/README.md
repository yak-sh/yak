# Music generation provenance

One JSON file per generated track, named by the SHA-256 of its MP3. The `prompt`
field is the exact recorded generation prompt, not a reconstruction.
`../music_tracks.ts` selects the tracks heard in the app. Earlier Tombsands and
Cinderreach takes remain here and in the Vale blob store for comparison. The
authored direction for each land is in `../music_direction.ts`; new prompts use
`../music_prompt.ts`. That direction does not alter any recorded prompt or song.
Tombsands and Cinderreach choose wordless choir for their own terrain and mood;
other lands choose a solo voice or no voice.

The first twenty tracks were generated with OpenRouter's
`google/lyria-3-pro-preview`; output was MP3. Request settings beyond the prompt
and model were not recorded. The surviving logs record the successful attempts
(and three successful retries), but not every request parameter or random seed.
Generating again from the prompt may make a different song. `request_parameters`
explicitly marks the settings we cannot recover.

Source: the temporary `scratchpad/songs/generation.json`, cross-checked against
`scratchpad/songs/manifest.json`, `retries.json`, and `music_tracks.ts` on
September 28, 2026. The manifest records duration and the listenability audit,
not generation settings. The MP3s themselves live in the Vale blob store.

Later tracks record the exact request settings, OpenRouter response ID and
selected byte hash. Each was decoded through its end, checked for duration,
interior silence and loudness, and read back from Vale's blob store to verify
the uploaded bytes. Where present, `audit` also records a model's listening
review for vocals and audible defects; this is a review aid, not a human
audition.

Mossvale's two exact prompts were recovered from the original generation session
(entry references in their JSON files). Unlike the other eighteen, they say
“song one/two” rather than “song 1/2”.
