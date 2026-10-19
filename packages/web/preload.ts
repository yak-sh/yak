// Page metadata starts while its application module is still being fetched.
// Same-origin credentials and fetch destination match the module's own reads.
export let preload = (response: Response): Response => {
  response.headers.set(
    'link',
    '</vocab>; rel=preload; as=fetch; crossorigin=anonymous, ' +
      '</web/owner>; rel=preload; as=fetch; crossorigin=anonymous',
  )
  return response
}
