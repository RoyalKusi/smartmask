export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
    public readonly technical = '',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function describeError(e: unknown): { code: string; message: string; technical: string } {
  if (e instanceof ApiError)
    return { code: e.code, message: e.message, technical: e.technical || `${e.name}: ${e.message}` };
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code;
    return {
      code: typeof code === 'string' ? code : 'SM-UI-001',
      message: e.message,
      technical: e.stack ?? e.message,
    };
  }
  return { code: 'SM-UI-001', message: 'Unexpected error', technical: String(e) };
}
