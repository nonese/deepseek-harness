/** Bounded, secret-redacted diagnostics for desktop startup and child-process lifecycle. */

import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LOG_BYTES = 1024 * 1024

type DiagnosticValue = string | number | boolean | null

/** Durable startup logger that never records raw credentials or process tokens. */
export interface DesktopStartupLogger {
  readonly path: string
  /**
   * Append one bounded JSONL event.
   *
   * @param event - Stable event name.
   * @param details - Scalar diagnostic fields without credential values.
   */
  record(event: string, details?: Readonly<Record<string, DiagnosticValue>>): void
}

/**
 * Redact common credential and authenticated-URL forms from one diagnostic value.
 *
 * @param value - Untrusted diagnostic text.
 * @returns Text safe for the local startup log.
 */
export function redactDesktopDiagnostic(value: string): string {
  return value
    .replace(/([?&](?:access_token|api_key|client_secret|refresh_token|token)=)[^&\s]+/giu, '$1[redacted]')
    .replace(/\bBearer\s+[^\s]+/giu, 'Bearer [redacted]')
    .replace(/("(?:access_token|api_key|apiKey|client_secret|clientSecret|password|refresh_token|token)"\s*:\s*")[^"]*/giu, '$1[redacted]')
}

/**
 * Create a bounded JSONL startup logger inside the supplied directory.
 *
 * @param directory - Private Electron user-data log directory.
 * @returns A logger that rotates by replacing logs larger than one MiB.
 */
export function createDesktopStartupLogger(directory: string): DesktopStartupLogger {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'desktop-startup.jsonl')
  return {
    path,
    record(event, details = {}) {
      const safeDetails = Object.fromEntries(Object.entries(details).map(([key, value]) => [
        key,
        typeof value === 'string' ? redactDesktopDiagnostic(value) : value,
      ]))
      const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...safeDetails })}\n`
      try {
        writeDiagnosticLine(path, line)
      } catch (error) {
        // Swallow only local diagnostics I/O failures; application startup must remain recoverable.
        void error
      }
    },
  }
}

function writeDiagnosticLine(path: string, line: string): void {
  let replace = false
  try {
    replace = statSync(path).size + Buffer.byteLength(line) > MAX_LOG_BYTES
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (replace) writeFileSync(path, line, { encoding: 'utf8', mode: 0o600 })
  else appendFileSync(path, line, { encoding: 'utf8', mode: 0o600 })
}
