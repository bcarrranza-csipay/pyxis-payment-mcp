# Pyxis Payment API — MCP Server

A local Model Context Protocol (MCP) server that simulates the Pyxis Payment API.
Developers can run it locally, point their AI assistant at it, and build/test a full
Pyxis integration without touching a live endpoint.

**State is held in-memory and resets on server restart.** This is intentional — it keeps
the sandbox clean between sessions.

---

## Quick Start

### 1. Install & Build

```bash
cd pyxis-mcp
npm install
npm run build
```

### 2. Connect to Your AI Assistant

#### Claude Code (CLI)

Add the MCP server to your project:

```bash
claude mcp add pyxis node "/path/to/pyxis-mcp/dist/index.js"
```

Or add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "pyxis": {
      "command": "node",
      "args": ["/path/to/pyxis-mcp/dist/index.js"]
    }
  }
}
```

Then use it naturally in conversation:

```
> Build a checkout page that charges a credit card using the Pyxis Payment API

Claude will automatically call pyxis_get_token, pyxis_sale, etc.
```

#### Claude Desktop

Open your config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add:

```json
{
  "mcpServers": {
    "pyxis": {
      "command": "node",
      "args": ["/path/to/pyxis-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. The 14 Pyxis tools will appear in the tools menu.

#### Any MCP-Compatible Client

The server uses stdio transport (JSON-RPC over stdin/stdout). Any MCP client can connect:

```bash
node /path/to/pyxis-mcp/dist/index.js
```

---

## Available Tools

| Tool | Description |
|---|---|
| `pyxis_get_token` | Authenticate and get a Bearer token (~10-day TTL) |
| `pyxis_tokenize` | Store a card/bank account; returns a reusable token UUID |
| `pyxis_sale` | One-step auth + capture |
| `pyxis_account_verify` | Verify a card without charging it |
| `pyxis_authorize` | Create an auth hold (must follow with `pyxis_capture`) |
| `pyxis_capture` | Capture a prior authorization |
| `pyxis_void` | Cancel a transaction before settlement (~24hr window) |
| `pyxis_refund` | Refund a settled transaction (full or partial) |
| `pyxis_get_transaction` | Look up any transaction by ID |
| `pyxis_get_settled_transactions` | List settled transactions |
| `pyxis_convenience_fee` | Calculate processing fee before charging |
| `pyxis_bin_lookup` | Get card network/type info from BIN |
| `pyxis_settle_transactions` | Manually settle pending transactions for testing |
| `pyxis_sandbox_info` | Test cards, amount triggers, and API conventions |

---

## Typical Integration Flow

```
1. pyxis_get_token          → store the token
2. pyxis_tokenize           → store the returned token UUID against the customer
3. pyxis_sale (with token)  → charge the customer
4. pyxis_get_transaction    → confirm status
5. pyxis_void OR refund     → reverse if needed
```

### Authorize / Capture Flow

```
1. pyxis_authorize          → hold funds, save transactionId
2. pyxis_capture            → collect funds (pass transactionId from step 1)
```

### Recurring Payments

```
1. pyxis_sale (recurring: "First")     → save recurringScheduleTransId from response
2. pyxis_sale (recurring: "InTrack",
               recurringScheduleTransId: <saved id>)  → every subsequent charge
```

> **Note:** Recurring is not available with Authorize/Capture — use Sale only.

---

## Test Cards

### Success Cards

| Card Number | Type | Result |
|---|---|---|
| `4111111111111111` | Visa | Approved |
| `4012888888881881` | Visa | Approved |
| `5555555555554444` | MasterCard | Approved |
| `2223000000000023` | MasterCard | Approved |
| `378282246310005` | Amex (4-digit CVV) | Approved |
| `6011989578768275` | Discover | Approved |
| `4041639099002469` | Visa Debit | Approved |

### Failure Cards

| Card Number | Type | Decline Reason |
|---|---|---|
| `4000000000000002` | Visa | Do Not Honor |
| `5100000000000008` | MasterCard | Insufficient Funds |
| `4000000000000069` | Visa | Expired Card |
| `4000000000000127` | Visa | Incorrect CVV |

**Card expiry format:** `MM.YYYY` — e.g. `"05.2026"`

### Amount-Based Triggers

| Amount (cents) | Display | Result |
|---|---|---|
| `1` | $0.01 | Exceeds Approval Amount Limit |
| `23` | $0.23 | Network Error |
| `50` | $0.50 | Network Timeout |
| `51` | $0.51 | Processor Unavailable |
| `52` | $0.52 | Partial Approval (approves for half the amount) |
| `99` | $0.99 | Duplicate Transaction (on second attempt with same card + terminal + amount) |

### Test Credentials

| Username | Behavior |
|---|---|
| `expired_user` | Issues a token that is already expired (use to test token expiry handling) |
| `ratelimit_user` | Always returns rate limit error 713 (use to test retry/backoff logic) |

---

## Key API Conventions

| Rule | Detail |
|---|---|
| **Amounts** | Always in **cents** as a string. `"2530"` = $25.30 |
| **Expiry** | `MM.YYYY` format — e.g. `"05.2026"` |
| **Check status** | Always check `status` field. HTTP 200 can still return `"status": "Error"` |
| **Optional fields** | Omit entirely — do not send `null` or `""` |
| **Void vs Refund** | Void = before settlement; Refund = after settlement |
| **Token reuse** | Same card + same `terminalId` always returns the same token |

---

## Known Divergences from Production

This sandbox simulates the Pyxis Payment API but differs from production in these key ways:

- **Settlement is simulated (dual model).** Transactions auto-settle after ~24 hours via lazy timestamp check. You can also settle immediately using `pyxis_settle_transactions` — settle by specific ID, by age (`olderThanHours`), or settle all (`olderThanHours: 0`). Production uses real batch processing.
- **In-memory state resets on restart.** There is no persistent storage — all tokens, transactions, and state are lost when the server stops.
- **Amount values trigger specific test behaviors.** Certain cent amounts ($0.01, $0.23, etc.) force declines or errors. This does not happen in production.
- **Card masking uses a fixed pattern.** The simulator masks card numbers as `first6****last4`. Production masking may differ.
- **Fee calculation is a flat percentage (default 3%).** Production uses complex fee schedules per merchant, card type, and volume tier.
- **No real network calls.** All processing is local and deterministic — no processor communication, no AVS, no 3D Secure, no CVV validation.
- **Multi-currency is not supported.** The simulator is USD-only.
- **Webhooks and batch processing are not supported.** Production provides real-time transaction notifications and batch operations.

For the full divergence matrix, see `REQUIREMENTS.md` section 8.

---

## Environment Variables

All optional. By default, any credentials are accepted and defaults apply.

| Variable | Default | Description |
|---|---|---|
| `PYXIS_MCP_USERNAME` | _(any)_ | Lock down sandbox auth to a specific username |
| `PYXIS_MCP_PASSWORD` | _(any)_ | Lock down sandbox auth to a specific password |
| `PYXIS_AUDIT_LOG` | `pyxis-audit.log` | Path for JSON-lines audit log output |
| `PYXIS_FEE_RATE` | `0.03` | Convenience fee rate (0-1). Default 3% |

Pass env vars via your MCP config (`.mcp.json` or Claude Desktop config):

```json
{
  "mcpServers": {
    "pyxis": {
      "command": "node",
      "args": ["/path/to/pyxis-mcp/dist/index.js"],
      "env": {
        "PYXIS_MCP_USERNAME": "myuser",
        "PYXIS_MCP_PASSWORD": "mypass",
        "PYXIS_FEE_RATE": "0.03"
      }
    }
  }
}
```

Or set them in your shell before running Claude Code:

```bash
export PYXIS_FEE_RATE=0.025
claude
```

---

## Project Structure

```
src/
  index.ts              Entry point — creates MCP server, registers tools
  router.ts             Maps tool names to simulator functions
  auth-guard.ts         Bearer token validation middleware
  audit.ts              JSON-lines audit logger
  simulator.ts          All business logic (auth, transactions, settlement, BIN lookup)
  state.ts              In-memory state store (tokens, transactions, tokenized cards)
  tools/
    definitions.ts      Tool name/description/schema definitions (14 tools)
```

## Development

Run without building (uses `tsx`):

```bash
npm run dev
```

Rebuild after changes:

```bash
npm run build
```

---

## Usage Monitoring

The server writes JSON-lines audit logs to `pyxis-audit.log` (configurable via `PYXIS_AUDIT_LOG`). Each entry includes:
- Tool name, sanitized arguments, response status
- Error codes and messages (if any)
- Duration in milliseconds

Use these logs to track tool invocation patterns and detect adoption drop-off.

---

## Contributing

1. Fork and clone the repo
2. Create a feature branch from `develop`: `git checkout -b feature/your-feature develop`
3. Install dependencies: `npm install`
4. Make changes and add tests
5. Run tests: `npm test`
6. Build: `npm run build`
7. Commit with conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`
8. Open a PR against `develop`
