// Read a whole request before acting on it. A cancelled upload is the
// caller's refusal; failures elsewhere keep their original error identity.
import { Refused } from '@yaks/graph'

/** Receive body bytes, distinguishing cancellation from a server failure. */
export let receiveBody = async <T>(
  request: Request,
  read: () => Promise<T>,
): Promise<T> => {
  try {
    return await read()
  } catch (error) {
    if (
      request.signal.aborted ||
      error instanceof Error && error.name == 'AbortError' ||
      error instanceof TypeError &&
        error.message ==
          "Can't read from request stream because client disconnected."
    ) throw new Refused('request body was interrupted')
    throw error
  }
}

/** Receive the complete body, refusing an upload its client interrupted. */
export let readBody = (request: Request): Promise<string> =>
  receiveBody(request, () => request.text())
