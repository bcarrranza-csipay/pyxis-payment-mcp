# Pyxis Payment MCP

MCP server providing a local sandbox simulation of the Pyxis Payment API (Constellation Payments / CSIPay).

## Operating Rules Version
operating-rules-version: 2025-03-15-v3

## Active Rules

| # | Rule | Active | Notes |
|---|------|--------|-------|
| 1 | No secrets in repos | Yes | `.env` for optional credentials, `.gitignore` |
| 2 | PCI + SOC2 | No | Sandbox simulator, no real payment data |
| 3 | Everything as code | No | Local dev tool |
| 4 | Pipeline security | No | No CI/CD yet (planned) |
| 5 | Internal vs customer facing | No | Local tool |
| 6 | Centralized SSO | No | Local tool |
| 7 | Change control | No | No database migrations (in-memory state) |
| 8 | Optimize costs | Yes | No paid dependencies, free-tier only |
| 9 | DB snapshots | No | In-memory state, resets on restart |
| 10 | Event-driven | No | Single-process MCP server |
| 11 | Final compliance review | Yes | Check before every commit |
| 12 | Tenant config | No | Single-user dev tool |
| 13 | Headless API | No | MCP protocol is the interface |
| 14 | Cost-to-serve | No | Local tool, zero cost |
| 15 | Least privilege IAM | No | No cloud IAM |
| 16 | Repos private | Yes | Private GitHub repo |
| 17 | Unit tests | Yes | All tools must have tests |
| 18 | Documentation | Yes | README + REQUIREMENTS.md + DESIGN.md |
| 19 | Req → Design → Panel → Tasks → Build | Yes | Full delivery workflow |
| 20 | Git Flow | Yes | `main` → `develop` → `feature/<name>` |

## Delivery Workflow

Per Rule 19, the delivery sequence for this project is:
1. REQUIREMENTS.md → sub-agent review → iterate until clean
2. DESIGN.md → sub-agent review → iterate until clean
3. TASKS.md (living document — tracks completed + remaining; each task includes its tests) → sub-agent review → iterate until clean
4. Mastermind Panel review (review all three documents)
5. Build (implement each task + its tests; tests pass before moving to next task)

## Project Context
- **Stack**: TypeScript, Node.js ES2022, `@modelcontextprotocol/sdk`
- **Purpose**: Local sandbox for developers integrating with Pyxis Payment API
- **Consumers**: Claude Desktop, Claude Code CLI
- **State**: In-memory only, resets on server restart
- **13 tools**: auth, tokenize, sale, authorize, capture, void, refund, transaction queries, convenience fee, BIN lookup, sandbox info

## Key Rules
- Simulator behavior must match real Pyxis API conventions (response codes, field names, transaction lifecycle)
- Document all divergences from production Pyxis behavior
- Test cards and amount triggers must be deterministic
