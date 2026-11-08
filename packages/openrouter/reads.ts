// https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
// https://openrouter.ai/docs/guides/overview/multimodal/pdfs
// Native image/file support comes from each model's input_modalities. PDF
// parsing for other models is an OpenRouter service, not a native model input.
// OpenRouter publishes no common byte cap: its upstream model validates that
// limit. Infinity means no provider-wide byte ceiling has been documented.
/** Native inputs advertised by one model in OpenRouter's catalogue. */
export let reads = (modalities: string[]): Record<string, number> => ({
  ...modalities.includes('image')
    ? Object.fromEntries(
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].map((
        type,
      ) => [type, Infinity]),
    )
    : {},
  ...modalities.includes('file') ? { 'application/pdf': Infinity } : {},
})
