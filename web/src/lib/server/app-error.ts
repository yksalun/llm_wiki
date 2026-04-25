export interface AppErrorOptions extends ErrorOptions {
  details?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly publicMessage: string;
  readonly details?: unknown;

  constructor(code: string, status: number, publicMessage: string, options?: AppErrorOptions) {
    super(publicMessage, options);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
    this.details = options?.details;
  }
}
