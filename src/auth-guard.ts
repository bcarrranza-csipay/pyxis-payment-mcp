import { state } from "./state.js";

// ---------------------------------------------------------------------------
// Auth guard helper
// ---------------------------------------------------------------------------

export function requireValidToken(
  token: string | undefined
): { valid: true } | { valid: false; response: object } {
  if (!token) {
    return {
      valid: false,
      response: {
        status: "Error",
        errors: [
          {
            errorSource: "Security",
            errorCode: "700",
            errorMsg: "Missing Bearer token. Call pyxis_get_token first.",
          },
        ],
      },
    };
  }
  const check = state.validateToken(token);
  if (!check.valid) {
    return {
      valid: false,
      response: {
        status: "Error",
        errors: [
          {
            errorSource: "Security",
            errorCode: "712",
            errorMsg: check.reason ?? "The token has expired!",
          },
        ],
      },
    };
  }
  return { valid: true };
}
