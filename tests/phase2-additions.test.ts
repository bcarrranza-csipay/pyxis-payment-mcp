import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  simulateGetToken,
  simulateSale,
  simulateAuthorize,
  simulateCapture,
  simulateVoid,
  simulateRefund,
  simulateSettleTransactions,
  simulateAccountVerify,
} from '../src/simulator.js';
import { state } from '../src/state.js';

const TERMINAL = 'test-terminal-001';
const TEST_CARD = '4111111111111111';

describe('Phase 2 additions', () => {
  beforeEach(() => state.reset());

  // =========================================================================
  // Auth Failure Triggers (T2.1-T2.2)
  // =========================================================================

  describe('Auth failure triggers (T2.1-T2.2)', () => {
    it('expired_user returns token that is already expired', () => {
      const result = simulateGetToken('expired_user', 'anypass');
      expect(result.status).toBe('Success');
      expect(result.token).toBeDefined();
    });

    it('expired_user token fails validation', () => {
      const result = simulateGetToken('expired_user', 'anypass');
      const validation = state.validateToken(result.token!);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('expired');
    });

    it('ratelimit_user returns error 713', () => {
      const result = simulateGetToken('ratelimit_user', 'anypass');
      expect(result.status).toBe('Error');
      expect(result.errors?.[0].errorCode).toBe('713');
    });

    it('ratelimit_user error message mentions rate limit', () => {
      const result = simulateGetToken('ratelimit_user', 'anypass');
      expect(result.errors?.[0].errorMsg).toContain('Rate limit');
    });

    it('normal user still succeeds', () => {
      const result = simulateGetToken('normal_user', 'anypass');
      expect(result.status).toBe('Success');
      const validation = state.validateToken(result.token!);
      expect(validation.valid).toBe(true);
    });
  });

  // =========================================================================
  // Amount Triggers (T2.3-T2.5)
  // =========================================================================

  describe('Amount triggers (T2.3-T2.5)', () => {
    it('$0.50 (50 cents) returns error 120 Network Timeout', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '50',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('120');
      expect(result.errors[0].errorMsg).toContain('Network Timeout');
    });

    it('$0.51 (51 cents) returns error 121 Processor Unavailable', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '51',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('121');
      expect(result.errors[0].errorMsg).toContain('Processor Unavailable');
    });

    it('$0.52 (52 cents) returns partial approval on Sale', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '52',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Success');
      expect(result.approvedAmount).toBe('26'); // floor(52/2)
      expect(result.gatewayResponseCode).toBe('10');
      expect(result.gatewayResponseMessage).toBe('PARTIAL APPROVAL');
    });

    it('$0.52 partial approval on Authorize', () => {
      const result = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '52',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Success');
      expect(result.approvedAmount).toBe('26');
      expect(result.gatewayResponseCode).toBe('10');
      expect(result.gatewayResponseMessage).toBe('PARTIAL APPROVAL');
    });

    it('$0.50 on Authorize returns error 120', () => {
      const result = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '50',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('120');
    });

    it('$0.51 on Authorize returns error 121', () => {
      const result = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '51',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('121');
    });

    it('existing $0.01 trigger still returns error 110', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('110');
    });

    it('existing $0.23 trigger still returns error 110', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '23',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('110');
    });

    it('partial approval transaction is stored correctly', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '52',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      const tx = state.getTransaction(result.transactionId);
      expect(tx).toBeDefined();
      expect(tx!.totalAmount).toBe(52);
      expect(tx!.approvedAmount).toBe(26);
      expect(tx!.status).toBe('Approved');
      expect(tx!.gatewayResponseCode).toBe('10');
    });
  });

  // =========================================================================
  // Duplicate Detection (T2.6)
  // =========================================================================

  describe('Duplicate detection - $0.99 (T2.6)', () => {
    it('first $0.99 sale succeeds', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '99',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Success');
    });

    it('second identical $0.99 sale returns error 355', () => {
      simulateSale({
        terminalId: TERMINAL,
        totalAmount: '99',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '99',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('355');
      expect(result.errors[0].errorMsg).toContain('Duplicate');
    });

    it('different amount does not trigger duplicate', () => {
      simulateSale({
        terminalId: TERMINAL,
        totalAmount: '99',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '100',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Success');
    });

    it('different terminal does not trigger duplicate', () => {
      simulateSale({
        terminalId: TERMINAL,
        totalAmount: '99',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const result = simulateSale({
        terminalId: 'other-terminal',
        totalAmount: '99',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Success');
    });

    it('different card does not trigger duplicate', () => {
      simulateSale({
        terminalId: TERMINAL,
        totalAmount: '99',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '99',
        accountInfo: { accountNumber: '5555555555554444', accountType: 'MasterCard' },
      }) as any;
      expect(result.status).toBe('Success');
    });

    it('duplicate on Authorize returns error 355', () => {
      simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '99',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const result = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '99',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('355');
    });
  });

  // =========================================================================
  // Phase 2 Failure Card (T2.7)
  // =========================================================================

  describe('Incorrect CVV failure card (T2.7)', () => {
    it('card 4000000000000127 returns error 110 Incorrect CVV on Sale', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: '4000000000000127', accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('110');
      expect(result.errors[0].errorMsg).toBe('Incorrect CVV');
    });

    it('card 4000000000000127 returns error 110 Incorrect CVV on Authorize', () => {
      const result = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: '4000000000000127', accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('110');
      expect(result.errors[0].errorMsg).toBe('Incorrect CVV');
    });

    it('card 4000000000000127 returns error 110 Incorrect CVV on AccountVerify', () => {
      const result = simulateAccountVerify({
        terminalId: TERMINAL,
        accountInfo: { accountNumber: '4000000000000127', accountType: 'Visa' },
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('110');
      expect(result.errors[0].errorMsg).toBe('Incorrect CVV');
    });
  });

  // =========================================================================
  // Fee Rate Configuration (T2.8)
  // =========================================================================

  describe('PYXIS_FEE_RATE env var (T2.8)', () => {
    const origRate = process.env.PYXIS_FEE_RATE;

    afterEach(() => {
      if (origRate !== undefined) process.env.PYXIS_FEE_RATE = origRate;
      else delete process.env.PYXIS_FEE_RATE;
    });

    it('default rate is 3%', () => {
      delete process.env.PYXIS_FEE_RATE;
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.feeAmount).toBe('30');
    });

    it('custom rate 2.5%', () => {
      process.env.PYXIS_FEE_RATE = '0.025';
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.feeAmount).toBe('25');
    });

    it('rate clamped to max 1.0 (100%)', () => {
      process.env.PYXIS_FEE_RATE = '2.0';
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.feeAmount).toBe('1000'); // 100% of 1000
    });

    it('rate 0 means no fee', () => {
      process.env.PYXIS_FEE_RATE = '0';
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.feeAmount).toBe('0');
    });

    it('invalid rate falls back to default 3%', () => {
      process.env.PYXIS_FEE_RATE = 'abc';
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.feeAmount).toBe('30');
    });

    it('negative rate clamped to 0', () => {
      process.env.PYXIS_FEE_RATE = '-0.5';
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.feeAmount).toBe('0');
    });

    it('fee rate applies to convenience fee calculation too', () => {
      process.env.PYXIS_FEE_RATE = '0.05';
      // Use simulateConvenienceFee indirectly through a sale to verify consistency
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '2000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(result.feeAmount).toBe('100'); // 5% of 2000
    });
  });

  // =========================================================================
  // Settlement Control (T2.9-T2.10)
  // =========================================================================

  describe('Settlement control (T2.9-T2.10)', () => {
    it('settle by specific transaction ID', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      const saleId = sale.transactionId;

      const result = simulateSettleTransactions({ transactionId: saleId }) as any;
      expect(result.status).toBe('Success');
      expect(result.settled).toBe(1);

      // Verify the transaction is now settled in state
      const tx = state.getTransaction(saleId);
      expect(tx?.settledAt).toBeDefined();
    });

    it('settle by age (olderThanHours: 0 settles all)', () => {
      simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      simulateSale({
        terminalId: TERMINAL,
        totalAmount: '2000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });

      const result = simulateSettleTransactions({ olderThanHours: 0 }) as any;
      expect(result.status).toBe('Success');
      expect(result.settled).toBe(2);
    });

    it('settle already-settled transaction returns settled: 0', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      const saleId = sale.transactionId;

      simulateSettleTransactions({ transactionId: saleId });
      const result = simulateSettleTransactions({ transactionId: saleId }) as any;
      expect(result.status).toBe('Success');
      expect(result.settled).toBe(0);
    });

    it('settle non-existent transaction returns error 302', () => {
      const result = simulateSettleTransactions({ transactionId: 'bogus-id' }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('302');
    });

    it('settle declined transaction returns error 358', () => {
      // Amount=1 triggers a decline
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      const txId = sale.transactionId;
      expect(txId).toBeDefined();

      const result = simulateSettleTransactions({ transactionId: txId }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('358');
    });

    it('settle AccountVerify returns error 100', () => {
      const verify = simulateAccountVerify({
        terminalId: TERMINAL,
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      expect(verify.transactionId).toBeDefined();

      const result = simulateSettleTransactions({ transactionId: verify.transactionId }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('100');
    });

    it('settle by age with default 24hr window only settles old transactions', () => {
      // Create a sale and backdate it to 25 hours ago
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;
      state.updateTransaction(sale.transactionId, {
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });

      // Create a recent sale
      simulateSale({
        terminalId: TERMINAL,
        totalAmount: '2000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });

      // Default olderThanHours=24 should only settle the old one
      const result = simulateSettleTransactions({}) as any;
      expect(result.settled).toBe(1);
    });

    it('settle by terminalId filter', () => {
      simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      simulateSale({
        terminalId: 'other-terminal',
        totalAmount: '2000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });

      const result = simulateSettleTransactions({
        terminalId: TERMINAL,
        olderThanHours: 0,
      }) as any;
      expect(result.settled).toBe(1);
    });

    it('settled transaction appears in getSettledTransactions', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;

      simulateSettleTransactions({ transactionId: sale.transactionId });

      const settled = state.getSettledTransactions(TERMINAL);
      expect(settled.length).toBe(1);
      expect(settled[0].transactionId).toBe(sale.transactionId);
    });

    it('settle returns transaction details in response', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;

      const result = simulateSettleTransactions({ transactionId: sale.transactionId }) as any;
      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].transactionId).toBe(sale.transactionId);
      expect(result.transactions[0].totalAmount).toBe('1000');
      expect(result.transactions[0].settlementDate).toBeDefined();
    });
  });

  // =========================================================================
  // Void + Settlement interaction (T2.10)
  // =========================================================================

  describe('Void + Settlement interaction (T2.10)', () => {
    it('void on >24hr old transaction auto-settles and returns error 351', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;

      // Backdate to 25 hours ago — auto-settlement kicks in
      state.updateTransaction(sale.transactionId, {
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });

      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: sale.transactionId,
      }) as any;
      expect(result.errors[0].errorCode).toBe('351');
    });

    it('void fails on settled transaction with error 351', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;

      // Settle the transaction first
      simulateSettleTransactions({ transactionId: sale.transactionId });

      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: sale.transactionId,
      }) as any;
      expect(result.status).toBe('Error');
      expect(result.errors[0].errorCode).toBe('351');
    });

    it('refund succeeds on settled transaction', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;

      // Settle the transaction
      simulateSettleTransactions({ transactionId: sale.transactionId });

      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: sale.transactionId,
      }) as any;
      expect(result.status).toBe('Success');
      expect(result.approvedAmount).toBe('1000');
    });
  });

  // =========================================================================
  // Capture + Settlement combined (T2.9)
  // =========================================================================

  describe('Capture + Settlement (T2.9)', () => {
    it('captured authorization can be settled', () => {
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;

      const cap = simulateCapture({
        terminalId: TERMINAL,
        transactionId: auth.transactionId,
      }) as any;
      expect(cap.status).toBe('Success');

      // Settle the capture transaction
      const settle = simulateSettleTransactions({ transactionId: cap.transactionId }) as any;
      expect(settle.status).toBe('Success');
      expect(settle.settled).toBe(1);
    });

    it('unsettled authorization cannot be settled (not Sale or Capture type in pending filter)', () => {
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      }) as any;

      // olderThanHours=0 settles all pending, but auth is type Authorization, not Sale/Capture
      const result = simulateSettleTransactions({ olderThanHours: 0 }) as any;
      expect(result.settled).toBe(0);

      // Direct settle by ID should work though (it doesn't check type)
      const directSettle = simulateSettleTransactions({ transactionId: auth.transactionId }) as any;
      expect(directSettle.status).toBe('Success');
      expect(directSettle.settled).toBe(1);
    });
  });
});
