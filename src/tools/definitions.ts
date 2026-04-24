// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TOOLS = [
  // -- Auth ----------------------------------------------------------------
  {
    name: "pyxis_get_token",
    description:
      "Authenticate with the Pyxis API and receive a Bearer token. The token is valid for ~10 days. Store it and pass it to every other tool. Do NOT call this on every transaction.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "API username (any value in sandbox mode)" },
        password: { type: "string", description: "API password (any value in sandbox mode)" },
        pyxisAccess: { type: "string", description: "Shared secret / PyxisAccess header value (any value in sandbox mode)" },
      },
      required: ["username", "password"],
    },
  },

  // -- Tokenize ------------------------------------------------------------
  {
    name: "pyxis_tokenize",
    description:
      "Securely store a card or bank account and receive a reusable token UUID. The same card + terminalId always returns the same token. Use the token in place of raw card data for future transactions.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string", description: "Bearer token from pyxis_get_token" },
        terminalId: { type: "string", description: "Terminal GUID" },
        accountHolder: {
          type: "object",
          properties: {
            holderFirstName: { type: "string" },
            holderLastName: { type: "string" },
          },
        },
        accountInfo: {
          type: "object",
          properties: {
            accountNumber: { type: "string", description: "Full card/account number" },
            accountType: {
              type: "string",
              enum: ["Visa", "MasterCard", "Discover", "Amex", "DinersClub", "DebitCard", "JCB", "Checking", "Savings"],
            },
            accountAccessory: { type: "string", description: "Expiry in MM.YYYY format (e.g. '05.2026')" },
          },
          required: ["accountNumber", "accountType"],
        },
      },
      required: ["bearerToken", "terminalId", "accountInfo"],
    },
  },

  // -- Sale ----------------------------------------------------------------
  {
    name: "pyxis_sale",
    description:
      "Process a one-step auth + capture. Provide either a 'token' (from pyxis_tokenize) OR raw card details in 'accountInfo'. Amount is in CENTS (integer). Check the 'status' field in the response — HTTP 200 can still return status: 'Error'.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string", description: "Bearer token from pyxis_get_token" },
        terminalId: { type: "string", description: "Terminal GUID" },
        token: { type: "string", description: "Tokenized card UUID (alternative to accountInfo)" },
        accountInfo: {
          type: "object",
          description: "Raw card details (use when you don't have a token yet)",
          properties: {
            accountNumber: { type: "string" },
            accountType: {
              type: "string",
              enum: ["Visa", "MasterCard", "Discover", "Amex", "DinersClub", "DebitCard", "JCB", "Checking", "Savings"],
            },
            accountAccessory: { type: "string", description: "Expiry MM.YYYY" },
          },
        },
        accountHolder: {
          type: "object",
          properties: {
            holderFirstName: { type: "string" },
            holderLastName: { type: "string" },
            holderStreet: { type: "string" },
            holderPostal: { type: "string" },
          },
        },
        totalAmount: {
          type: "string",
          description: "Amount in cents as a string, e.g. '2530' for $25.30",
        },
        externalTransactionId: { type: "string", description: "Your internal transaction reference" },
        saleWithTokenize: {
          type: "boolean",
          description: "If true, also tokenizes the card and returns generatedToken",
        },
        recurring: {
          type: "string",
          enum: ["None", "NoTrack", "First", "InTrack"],
          description: "Recurring payment type. Use 'First' for the first charge; save recurringScheduleTransId from response and pass it with 'InTrack' on subsequent charges.",
        },
        recurringScheduleTransId: {
          type: "string",
          description: "Required for recurring='InTrack'. The recurringScheduleTransId returned from the 'First' transaction.",
        },
      },
      required: ["bearerToken", "terminalId", "totalAmount"],
    },
  },

  // -- Account Verify ------------------------------------------------------
  {
    name: "pyxis_account_verify",
    description:
      "Verify that a card account is valid without charging it (zero-dollar authorization). Cards only, not ACH. Returns status 'Success' if the card is valid. Failure cards (e.g. 4000000000000069) will return status 'Error' with a decline reason.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string" },
        terminalId: { type: "string" },
        accountInfo: {
          type: "object",
          properties: {
            accountNumber: { type: "string" },
            accountType: { type: "string" },
            accountAccessory: { type: "string", description: "Expiry MM.YYYY" },
          },
          required: ["accountNumber", "accountType"],
        },
        accountHolder: {
          type: "object",
          properties: {
            holderFirstName: { type: "string" },
            holderLastName: { type: "string" },
          },
        },
      },
      required: ["bearerToken", "terminalId", "accountInfo"],
    },
  },

  // -- Authorize -----------------------------------------------------------
  {
    name: "pyxis_authorize",
    description:
      "Create an authorization hold without capturing funds. You MUST follow this with pyxis_capture to collect the funds. Uncaptured authorizations become Abandoned automatically. Note: recurring payments are not available with Authorize/Capture — use pyxis_sale instead.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string" },
        terminalId: { type: "string" },
        token: { type: "string", description: "Tokenized card UUID" },
        accountInfo: {
          type: "object",
          properties: {
            accountNumber: { type: "string" },
            accountType: { type: "string" },
            accountAccessory: { type: "string", description: "Expiry MM.YYYY" },
          },
        },
        totalAmount: { type: "string", description: "Amount in cents" },
        externalTransactionId: { type: "string" },
      },
      required: ["bearerToken", "terminalId", "totalAmount"],
    },
  },

  // -- Capture -------------------------------------------------------------
  {
    name: "pyxis_capture",
    description:
      "Capture a previously created authorization. Pass the transactionId from pyxis_authorize. Optionally provide a different totalAmount to capture a partial amount.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string" },
        terminalId: { type: "string" },
        transactionId: {
          type: "string",
          description: "The transactionId returned from pyxis_authorize",
        },
        totalAmount: {
          type: "string",
          description: "Amount in cents. Defaults to the authorized amount if omitted.",
        },
      },
      required: ["bearerToken", "terminalId", "transactionId"],
    },
  },

  // -- Void ----------------------------------------------------------------
  {
    name: "pyxis_void",
    description:
      "Cancel a transaction before it settles (~24-hour window). If the transaction has already settled, use pyxis_refund instead. Check status='Error' + errorCode='351' to detect the settled-transaction case.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string" },
        terminalId: { type: "string" },
        transactionToVoidId: {
          type: "string",
          description: "transactionId of the transaction to cancel",
        },
      },
      required: ["bearerToken", "terminalId", "transactionToVoidId"],
    },
  },

  // -- Refund --------------------------------------------------------------
  {
    name: "pyxis_refund",
    description:
      "Refund a settled transaction. For unsettled transactions, use pyxis_void instead. Optionally provide totalAmount for a partial refund.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string" },
        terminalId: { type: "string" },
        transactionToRefundId: {
          type: "string",
          description: "transactionId of the settled transaction to refund",
        },
        totalAmount: {
          type: "string",
          description: "Amount in cents. Defaults to full amount if omitted.",
        },
      },
      required: ["bearerToken", "terminalId", "transactionToRefundId"],
    },
  },

  // -- Get Transaction -----------------------------------------------------
  {
    name: "pyxis_get_transaction",
    description: "Look up a transaction by its transactionId. Returns the full transaction record including status, amounts, and timestamps. Returns status 'Error' with errorCode '350' if the transaction is not found.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string" },
        transactionId: { type: "string" },
      },
      required: ["bearerToken", "transactionId"],
    },
  },

  // -- Settled Transactions ------------------------------------------------
  {
    name: "pyxis_get_settled_transactions",
    description:
      "List settled (batched) transactions. Returns an array of transactions that have been settled. Optionally filter by terminalId, startDate, or endDate (YYYY-MM-DD). Returns an empty array if no settled transactions match.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string" },
        terminalId: { type: "string" },
        startDate: { type: "string", description: "YYYY-MM-DD" },
        endDate: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["bearerToken"],
    },
  },

  // -- Convenience Fee -----------------------------------------------------
  {
    name: "pyxis_convenience_fee",
    description:
      "Calculate the convenience/processing fee for a given amount and card type before charging the customer. Returns the fee amount in cents. In sandbox mode this is a flat 3% (configurable via PYXIS_FEE_RATE env var). Call this BEFORE pyxis_sale to show the customer the fee breakdown.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string" },
        terminalId: { type: "string" },
        totalAmount: { type: "string", description: "Amount in cents" },
        accountType: { type: "string", description: "Card type, e.g. 'Visa'" },
      },
      required: ["bearerToken", "terminalId", "totalAmount", "accountType"],
    },
  },

  // -- BIN Lookup ----------------------------------------------------------
  {
    name: "pyxis_bin_lookup",
    description:
      "Look up card network, type (credit/debit/prepaid), and other metadata from a card number or BIN (first 6 digits). Useful for determining card type before processing. In sandbox mode, only known test BINs return accurate data; unknown BINs return type 'Unknown'.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string" },
        accountNumber: { type: "string", description: "Full card number or first 6 digits (BIN)" },
      },
      required: ["bearerToken", "accountNumber"],
    },
  },

  // -- Settle Transactions -------------------------------------------------
  {
    name: "pyxis_settle_transactions",
    description:
      "Manually settle pending transactions. Settle by specific transactionId, by age (olderThanHours), or settle all (olderThanHours: 0). In production, settlement happens automatically in batch. This tool lets you control it for testing.",
    inputSchema: {
      type: "object",
      properties: {
        bearerToken: { type: "string" },
        terminalId: { type: "string", description: "Optional: filter by terminal" },
        transactionId: { type: "string", description: "Settle a specific transaction by ID" },
        olderThanHours: { type: "number", description: "Settle transactions older than N hours. Default 24. Use 0 to settle all." },
      },
      required: ["bearerToken"],
    },
  },

  // -- Sandbox Info --------------------------------------------------------
  {
    name: "pyxis_sandbox_info",
    description:
      "Returns test card numbers, amount-based decline triggers, known divergences from production, and sandbox behavior rules. Call this first to understand available test data and API conventions. No authentication required.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];
