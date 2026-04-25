export interface AppErrorOptions extends ErrorOptions {
  publicDetails?: Record<string, string | number | boolean | null>;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly publicMessage: string;
  readonly publicDetails?: Record<string, string | number | boolean | null>;

  constructor(code: string, status: number, publicMessage: string, options?: AppErrorOptions) {
    super(publicMessage, options);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
    this.publicDetails = options?.publicDetails;
  }
}
