# Music generation provenance

One JSON file per track, named by the SHA-256 used in `../music_tracks.ts`. The
`prompt` field is the exact recorded generation prompt, not a reconstruction.
The twenty tracks were generated with OpenRouter's `google/lyria-3-pro-preview`;
output was MP3. Request settings beyond the prompt and model were not recorded.
The surviving logs record the successful attempts (and three successful
retries), but not every request parameter or random seed. Generating again from
the prompt may make a different song. `request_parameters` explicitly marks the
settings we cannot recover.

Source: the temporary `scratchpad/songs/generation.json`, cross-checked against
`scratchpad/songs/manifest.json`, `retries.json`, and `music_tracks.ts` on
September 28, 2026. The manifest records duration and the listenability audit,
not generation settings. The MP3s themselves live in the Vale blob store.

Mossvale's two exact prompts were recovered from the original generation session
(entry references in their JSON files). Unlike the other eighteen, they say
“song one/two” rather than “song 1/2”.
