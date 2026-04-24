import { appendFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

export const AUDIT_LOG_PATH = resolve(
  process.env.PYXIS_AUDIT_LOG ?? "pyxis-audit.log"
);

export function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  if (out.password) out.password = "[redacted]";
  if (typeof out.pyxisAccess === "string") out.pyxisAccess = "[redacted]";
  if (typeof out.bearerToken === "string")
    out.bearerToken = out.bearerToken.slice(0, 8) + "...";
  if (out.accountInfo && typeof out.accountInfo === "object") {
    const ai = { ...(out.accountInfo as Record<string, unknown>) };
    if (typeof ai.accountNumber === "string" && ai.accountNumber.length > 10) {
      ai.accountNumber =
        ai.accountNumber.slice(0, 6) + "****" + ai.accountNumber.slice(-4);
    }
    out.accountInfo = ai;
  }
  return out;
}

export function auditLog(entry: {
  tool: string;
  args: Record<string, unknown>;
  status: string;
  errorCode?: string;
  errorMsg?: string;
  durationMs: number;
}): void {
  const line =
    JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  try {
    appendFileSync(AUDIT_LOG_PATH, line, "utf8");
  } catch {
    // Never crash the server over a logging failure
  }
}
