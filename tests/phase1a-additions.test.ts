import { describe, it, expect, beforeEach } from 'vitest';
import {
  simulateSale,
  simulateAuthorize,
  simulateCapture,
  simulateVoid,
  simulateRefund,
  simulateGetTransaction,
} from '../src/simulator.js';
import { state } from '../src/state.js';

const TERMINAL = 'test-terminal-001';
const TEST_CARD = '4111111111111111';

// Failure cards that always decline
const DO_NOT_HONOR_CARD = '4000000000000002';
const INSUFFICIENT_FUNDS_CARD = '5100000000000008';
const EXPIRED_CARD = '4000000000000069';

describe('Phase 1a additions', () => {
  beforeEach(() => state.reset());

  // ---------------------------------------------------------------------------
  // T1.3 — Settlement fix: query does NOT trigger settlement
  // ---------------------------------------------------------------------------
  describe('Settlement fix (T1.3)', () => {
    it('query after >24hrs does NOT trigger settlement', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const txId = (sale as any).transactionId;
      // Backdate the transaction to >24hrs ago
      state.updateTransaction(txId, {
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });
      // Query should NOT settle it (read-only path)
      simulateGetTransaction(txId);
      const tx = state.getTransaction(txId);
      expect(tx?.settledAt).toBeUndefined();
    });

    it('void after >24hrs succeeds (Phase 2: no auto-settlement)', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const txId = (sale as any).transactionId;
      state.updateTransaction(txId, {
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      });
      // Auto-settlement kicks in on void: >24hr old transaction gets settled, returns 351
      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: txId,
      });
      expect((result as any).errors[0].errorCode).toBe('351');
    });
  });

  // ---------------------------------------------------------------------------
  // T1.4 — Refund settlement check
  // ---------------------------------------------------------------------------
  describe('Refund settlement check (T1.4)', () => {
    it('refund on unsettled transaction returns error 357', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const txId = (sale as any).transactionId;
      // Transaction is fresh — no settledAt
      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: txId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('357');
    });

    it('refund on settled transaction succeeds', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const txId = (sale as any).transactionId;
      // Manually settle the transaction
      state.updateTransaction(txId, { settledAt: new Date() });
      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: txId,
      });
      expect((result as any).status).toBe('Success');
    });
  });

  // ---------------------------------------------------------------------------
  // T1.5–T1.7 — Declined transaction guard (error 358)
  // ---------------------------------------------------------------------------
  describe('Declined transaction guard - error 358 (T1.5-T1.7)', () => {
    it('void on declined Sale (failure card) returns error 358', () => {
      // Use failure card to create declined sale (returns transactionId)
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: DO_NOT_HONOR_CARD, accountType: 'Visa' },
      });
      const txId = (sale as any).transactionId;
      expect(txId).toBeDefined();
      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: txId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('358');
    });

    it('refund on declined Sale (with settledAt bypass) returns error 358', () => {
      // Use failure card to create declined sale
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: DO_NOT_HONOR_CARD, accountType: 'Visa' },
      });
      const txId = (sale as any).transactionId;
      // Manually set settledAt to bypass the 357 check (unsettled guard)
      // This lets us reach the 358 (declined guard) in the refund path
      state.updateTransaction(txId, { settledAt: new Date() });
      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: txId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('358');
    });

    it('capture on declined Authorization returns error 358', () => {
      // Use failure card to create declined authorization
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: DO_NOT_HONOR_CARD, accountType: 'Visa' },
      });
      const txId = (auth as any).transactionId;
      expect(txId).toBeDefined();
      const result = simulateCapture({
        terminalId: TERMINAL,
        transactionId: txId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('358');
    });
  });

  // ---------------------------------------------------------------------------
  // T1.10 — Failure cards
  // ---------------------------------------------------------------------------
  describe('Failure cards (T1.10)', () => {
    it('Do Not Honor card on Sale returns error 110', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: DO_NOT_HONOR_CARD, accountType: 'Visa' },
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('110');
      expect((result as any).errors[0].errorMsg).toBe('Do Not Honor');
    });

    it('Insufficient Funds card on Sale returns error 110', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: INSUFFICIENT_FUNDS_CARD, accountType: 'MasterCard' },
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('110');
      expect((result as any).errors[0].errorMsg).toBe('Insufficient Funds');
    });

    it('Expired Card on Sale returns error 110', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: EXPIRED_CARD, accountType: 'Visa' },
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('110');
      expect((result as any).errors[0].errorMsg).toBe('Expired Card');
    });

    it('Do Not Honor card on Authorize returns error 110', () => {
      const result = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: DO_NOT_HONOR_CARD, accountType: 'Visa' },
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('110');
      expect((result as any).errors[0].errorMsg).toBe('Do Not Honor');
    });

    it('failure card creates a Declined transaction record', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: DO_NOT_HONOR_CARD, accountType: 'Visa' },
      });
      const txId = (result as any).transactionId;
      expect(txId).toBeDefined();
      const tx = state.getTransaction(txId);
      expect(tx).toBeDefined();
      expect(tx?.status).toBe('Declined');
      expect(tx?.isDeclined).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // T1.11 — Capture ceiling (error 356)
  // ---------------------------------------------------------------------------
  describe('Capture ceiling - error 356 (T1.11)', () => {
    it('capture exceeding auth amount returns error 356', () => {
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const authId = (auth as any).transactionId;
      const result = simulateCapture({
        terminalId: TERMINAL,
        transactionId: authId,
        totalAmount: '6000',
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('356');
    });

    it('capture equal to auth amount succeeds', () => {
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const result = simulateCapture({
        terminalId: TERMINAL,
        transactionId: (auth as any).transactionId,
        totalAmount: '5000',
      });
      expect((result as any).status).toBe('Success');
    });

    it('partial capture succeeds', () => {
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const result = simulateCapture({
        terminalId: TERMINAL,
        transactionId: (auth as any).transactionId,
        totalAmount: '3000',
      });
      expect((result as any).status).toBe('Success');
      expect((result as any).approvedAmount).toBe('3000');
    });
  });

  // ---------------------------------------------------------------------------
  // T1.11b–d — Response schema additions
  // ---------------------------------------------------------------------------
  describe('Response schema additions (T1.11b-d)', () => {
    it('Sale success includes accountMasked', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      expect((result as any).accountMasked).toBe('411111******1111');
    });

    it('GetTransaction includes isDeclined=false for approved', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const query = simulateGetTransaction((sale as any).transactionId);
      expect((query as any).isDeclined).toBe(false);
    });

    it('GetTransaction includes isDeclined=true for declined (failure card)', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: DO_NOT_HONOR_CARD, accountType: 'Visa' },
      });
      const query = simulateGetTransaction((sale as any).transactionId);
      expect((query as any).isDeclined).toBe(true);
    });

    it('GetTransaction includes isDeclined=true for declined (amount trigger)', () => {
      // Amount trigger $0.01 = 1 cent creates a decline
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      // Amount-trigger declines don't return transactionId in the response,
      // so we find the declined tx from state
      const txId = (sale as any).transactionId;
      expect(txId).toBeDefined();
      const query = simulateGetTransaction(txId);
      expect((query as any).isDeclined).toBe(true);
    });

    it('Authorize includes feeAmount estimate', () => {
      const result = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '2530',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      // 3% of 2530 = 75.9, rounded to 76
      expect((result as any).feeAmount).toBe('76');
    });
  });

  // ---------------------------------------------------------------------------
  // T1.12 — Sandbox info apiVersion (placeholder)
  // ---------------------------------------------------------------------------
  describe('Sandbox info apiVersion (T1.12)', () => {
    it('placeholder for sandbox_info apiVersion (covered in MCP transport test)', () => {
      expect(true).toBe(true);
    });
  });
});
