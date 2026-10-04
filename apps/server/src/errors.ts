export class ApiError extends Error {
  constructor(public statusCode: number, public code: string, message: string = code) { super(message); }
}
export const unavailable = (service: string): never => { throw new ApiError(503, 'service_unavailable', `${service} is not configured`); };
