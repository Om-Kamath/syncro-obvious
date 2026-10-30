/**
 * Error carrying the HTTP status the app-level error handler should respond
 * with. The handler duck-types `status` (see server/app.ts errorStatus), so
 * thrown HttpErrors flow through to a JSON response automatically.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
