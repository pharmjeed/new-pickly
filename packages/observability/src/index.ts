import { pino, type Logger } from "pino";
import { ERROR_CODES, type ErrorCode } from "@pickly/contracts";

/**
 * Logger موحد — JSON منظم في الإنتاج (Cloud Logging)،
 * pino-pretty في التطوير.
 */
export function createLogger(name: string): Logger {
  const isDev = process.env.NODE_ENV !== "production";
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
    ...(isDev
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss" }
          }
        }
      : {}),
    redact: {
      // لا أسرار ولا بيانات حساسة في اللوج (docs/17)
      paths: [
        "*.password",
        "*.pin",
        "*.code",
        "*.token",
        "*.refresh_token",
        "*.access_token",
        "*.plate_encrypted",
        "*.iban_encrypted",
        "req.headers.authorization"
      ],
      censor: "[REDACTED]"
    }
  });
}

/**
 * خطأ تطبيقي محمول بكود العقد — يتحول تلقائياً إلى غلاف الخطأ الموحد
 * {error: {code, message_ar, message_en, details?}} في error handler الـAPI.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, details?: Record<string, unknown>) {
    super(`${code}: ${ERROR_CODES[code].en}`);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.details = details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
