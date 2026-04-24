export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly publicMessage: string;

  constructor(code: string, status: number, publicMessage: string, options?: ErrorOptions) {
    super(publicMessage, options);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}
