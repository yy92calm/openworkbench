/** Sensitive-value redaction for audit logs (provenance).
 *  Pure — no Node/Electron imports, unit-testable in isolation. */

/** Keys whose values must never reach the provenance log (AGENTS.md: API keys
 *  go to the app-private config dir, never into provenance/logs). */
const SENSITIVE_KEY_RE = /token|secret|password|authorization|api[_ -]?key|access[_ -]?key/i;
/** Inline credentials inside string values: sk-…, Bearer …, bare JWT fragments. */
const INLINE_SECRET_RE =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g;

const REDACTED = '[REDACTED]';

/**
 * Replace sensitive values with a placeholder, preserving the rest of the
 * structure. Walks arbitrary nested objects/arrays; a value is redacted when
 * its key matches {@link SENSITIVE_KEY_RE}, or when an inline credential
 * appears inside a string.
 */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : redactSensitive(val);
    }
    return out;
  }
  if (typeof value === 'string') {
    const redacted = value.replace(INLINE_SECRET_RE, REDACTED);
    return redacted === value ? value : redacted;
  }
  return value;
}
