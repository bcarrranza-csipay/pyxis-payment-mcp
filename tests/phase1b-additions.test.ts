import { describe, it, expect, beforeEach } from 'vitest';
import {
  simulateSale,
  simulateAuthorize,
  simulateCapture,
  simulateVoid,
  simulateRefund,
  simulateAccountVerify,
  simulateBinLookup,
} from '../src/simulator.js';
import { state } from '../src/state.js';

const TERMINAL = 'test-terminal-001';
const TEST_CARD = '4111111111111111';

// Failure cards
const DO_NOT_HONOR_CARD = '4000000000000002';
const INSUFFICIENT_FUNDS_CARD = '5100000000000008';

describe('Phase 1b additions', () => {
  beforeEach(() => state.reset());

  // ---------------------------------------------------------------------------
  // T1.8-T1.9 — Recurring validation
  // ---------------------------------------------------------------------------
  describe('Recurring validation (T1.8-T1.9)', () => {
    it('InTrack without recurringScheduleTransId returns error 305', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'InTrack',
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('305');
    });

    it('InTrack with bogus ID returns error 305', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'InTrack',
        recurringScheduleTransId: 'bogus-id',
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('305');
    });

    it('InTrack with valid First succeeds', () => {
      const first = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'First',
      });
      expect((first as any).status).toBe('Success');
      const scheduleId = (first as any).recurringScheduleTransId;
      expect(scheduleId).toBeDefined();

      const inTrack = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'InTrack',
        recurringScheduleTransId: scheduleId,
      });
      expect((inTrack as any).status).toBe('Success');
    });

    it('InTrack against voided First returns error 305', () => {
      const first = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'First',
      });
      const scheduleId = (first as any).recurringScheduleTransId;
      const firstTxId = (first as any).transactionId;

      // Void the first transaction
      simulateVoid({ terminalId: TERMINAL, transactionToVoidId: firstTxId });

      const inTrack = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'InTrack',
        recurringScheduleTransId: scheduleId,
      });
      expect((inTrack as any).status).toBe('Error');
      expect((inTrack as any).errors[0].errorCode).toBe('305');
    });

    it('First with recurringScheduleTransId returns error 100', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'First',
        recurringScheduleTransId: 'should-not-be-here',
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('100');
    });

    it('First without recurringScheduleTransId succeeds with generated schedule ID', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'First',
      });
      expect((result as any).status).toBe('Success');
      expect((result as any).recurringScheduleTransId).toBeDefined();
      // Schedule ID should be a UUID
      expect((result as any).recurringScheduleTransId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('recurring=None behaves like a normal sale (no schedule ID)', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'None',
      });
      expect((result as any).status).toBe('Success');
      expect((result as any).recurringScheduleTransId).toBeUndefined();
    });

    it('recurring=NoTrack behaves like a normal sale (no schedule ID)', () => {
      const result = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'NoTrack',
      });
      expect((result as any).status).toBe('Success');
      expect((result as any).recurringScheduleTransId).toBeUndefined();
    });

    it('multiple InTrack transactions against the same schedule all succeed', () => {
      const first = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
        recurring: 'First',
      });
      const scheduleId = (first as any).recurringScheduleTransId;

      for (let i = 0; i < 3; i++) {
        const inTrack = simulateSale({
          terminalId: TERMINAL,
          totalAmount: '1000',
          accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
          recurring: 'InTrack',
          recurringScheduleTransId: scheduleId,
        });
        expect((inTrack as any).status).toBe('Success');
      }
    });
  });

  // ---------------------------------------------------------------------------
  // T1.20-T1.22 — Void robustness
  // ---------------------------------------------------------------------------
  describe('Void robustness (T1.20-T1.22)', () => {
    it('void captured Authorization returns error 304', () => {
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const authId = (auth as any).transactionId;
      simulateCapture({ terminalId: TERMINAL, transactionId: authId });

      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: authId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('304');
    });

    it('void Capture record succeeds', () => {
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const capture = simulateCapture({
        terminalId: TERMINAL,
        transactionId: (auth as any).transactionId,
      });
      const captureId = (capture as any).transactionId;

      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: captureId,
      });
      expect((result as any).status).toBe('Success');
    });

    it('void refunded transaction returns error 353', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const saleId = (sale as any).transactionId;
      // Manually set status to Refunded WITHOUT settledAt so we don't hit
      // the settlement (351) guard before reaching the 353 check.
      // In production, a refunded-but-unsettled state is unusual, but this
      // tests the 353 guard specifically.
      state.updateTransaction(saleId, { status: 'Refunded' });

      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: saleId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('353');
    });

    it('void AccountVerify returns error 100', () => {
      const verify = simulateAccountVerify({
        terminalId: TERMINAL,
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const verifyId = (verify as any).transactionId;

      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: verifyId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('100');
    });

    it('void a Void record returns error 350 (already voided status)', () => {
      // Create a sale, void it, then try to void the void record
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const voidResult = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: (sale as any).transactionId,
      });
      const voidTxId = (voidResult as any).transactionId;

      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: voidTxId,
      });
      // Void records have status "Voided", so this hits the already-voided check (350)
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('350');
    });

    it('void uncaptured Authorization succeeds', () => {
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });

      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: (auth as any).transactionId,
      });
      expect((result as any).status).toBe('Success');
    });

    it('void non-existent transaction returns error 302', () => {
      const result = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: 'non-existent-id',
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('302');
    });

    it('void already voided transaction returns error 350', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const saleId = (sale as any).transactionId;

      // Void once — succeeds
      const first = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: saleId,
      });
      expect((first as any).status).toBe('Success');

      // Void again — already voided
      const second = simulateVoid({
        terminalId: TERMINAL,
        transactionToVoidId: saleId,
      });
      expect((second as any).status).toBe('Error');
      expect((second as any).errors[0].errorCode).toBe('350');
    });

    it('void updates original transaction status to Voided', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const saleId = (sale as any).transactionId;

      simulateVoid({ terminalId: TERMINAL, transactionToVoidId: saleId });

      const tx = state.getTransaction(saleId);
      expect(tx?.status).toBe('Voided');
    });
  });

  // ---------------------------------------------------------------------------
  // T1.23 — Refund type guards
  // ---------------------------------------------------------------------------
  describe('Refund type guards (T1.23)', () => {
    it('refund AccountVerify returns error 100', () => {
      const verify = simulateAccountVerify({
        terminalId: TERMINAL,
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const txId = (verify as any).transactionId;
      // Set settledAt to bypass the 357 (unsettled) check
      state.updateTransaction(txId, { settledAt: new Date() });

      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: txId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('100');
    });

    it('refund a Refund record returns error 100', () => {
      // Create a sale, settle it, refund it
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const saleId = (sale as any).transactionId;
      state.updateTransaction(saleId, { settledAt: new Date() });

      const refund = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: saleId,
      });
      const refundId = (refund as any).transactionId;
      // Set settledAt on the refund record to bypass 357
      state.updateTransaction(refundId, { settledAt: new Date() });

      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: refundId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('100');
    });

    it('refund an Authorization record returns error 100', () => {
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const authId = (auth as any).transactionId;
      state.updateTransaction(authId, { settledAt: new Date() });

      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: authId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('100');
    });

    it('refund a Capture record succeeds (Capture is refundable)', () => {
      const auth = simulateAuthorize({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const capture = simulateCapture({
        terminalId: TERMINAL,
        transactionId: (auth as any).transactionId,
      });
      const captureId = (capture as any).transactionId;
      state.updateTransaction(captureId, { settledAt: new Date() });

      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: captureId,
      });
      expect((result as any).status).toBe('Success');
    });

    it('refund non-existent transaction returns error 302', () => {
      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: 'non-existent-id',
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('302');
    });

    it('refund voided transaction returns error 352', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const saleId = (sale as any).transactionId;
      simulateVoid({ terminalId: TERMINAL, transactionToVoidId: saleId });

      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: saleId,
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('352');
    });

    it('partial refund succeeds when amount is less than original', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '5000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const saleId = (sale as any).transactionId;
      state.updateTransaction(saleId, { settledAt: new Date() });

      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: saleId,
        totalAmount: '2000',
      });
      expect((result as any).status).toBe('Success');
      expect((result as any).approvedAmount).toBe('2000');
    });

    it('refund exceeding original amount returns error 354', () => {
      const sale = simulateSale({
        terminalId: TERMINAL,
        totalAmount: '1000',
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      const saleId = (sale as any).transactionId;
      state.updateTransaction(saleId, { settledAt: new Date() });

      const result = simulateRefund({
        terminalId: TERMINAL,
        transactionToRefundId: saleId,
        totalAmount: '2000',
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('354');
    });
  });

  // ---------------------------------------------------------------------------
  // T1.24 — AccountVerify failure cards
  // ---------------------------------------------------------------------------
  describe('AccountVerify failure cards (T1.24)', () => {
    it('Do Not Honor card returns error 110', () => {
      const result = simulateAccountVerify({
        terminalId: TERMINAL,
        accountInfo: { accountNumber: DO_NOT_HONOR_CARD, accountType: 'Visa' },
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('110');
      expect((result as any).errors[0].errorMsg).toBe('Do Not Honor');
    });

    it('Insufficient Funds card returns error 110', () => {
      const result = simulateAccountVerify({
        terminalId: TERMINAL,
        accountInfo: { accountNumber: INSUFFICIENT_FUNDS_CARD, accountType: 'MasterCard' },
      });
      expect((result as any).status).toBe('Error');
      expect((result as any).errors[0].errorCode).toBe('110');
      expect((result as any).errors[0].errorMsg).toBe('Insufficient Funds');
    });

    it('success card still succeeds', () => {
      const result = simulateAccountVerify({
        terminalId: TERMINAL,
        accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      });
      expect((result as any).status).toBe('Success');
    });

    it('AccountVerify failure card creates a Declined transaction record', () => {
      const result = simulateAccountVerify({
        terminalId: TERMINAL,
        accountInfo: { accountNumber: DO_NOT_HONOR_CARD, accountType: 'Visa' },
      });
      const txId = (result as any).transactionId;
      expect(txId).toBeDefined();

      const tx = state.getTransaction(txId);
      expect(tx).toBeDefined();
      expect(tx?.status).toBe('Declined');
      expect(tx?.type).toBe('AccountVerify');
      expect(tx?.isDeclined).toBe(true);
    });

    it('AccountVerify failure includes gatewayResponseCode and message', () => {
      const result = simulateAccountVerify({
        terminalId: TERMINAL,
        accountInfo: { accountNumber: DO_NOT_HONOR_CARD, accountType: 'Visa' },
      });
      expect((result as any).gatewayResponseCode).toBe('05');
      expect((result as any).gatewayResponseMessage).toBe('Do Not Honor');
    });
  });

  // ---------------------------------------------------------------------------
  // T1.26 — BIN lookup updates
  // ---------------------------------------------------------------------------
  describe('BIN lookup updates (T1.26)', () => {
    it('unknown BIN returns network Unknown', () => {
      const result = simulateBinLookup('9999991234567890');
      expect(result.network).toBe('Unknown');
      expect(result.credit).toBe(false);
    });

    it('failure card BIN 400000 returns visa', () => {
      const result = simulateBinLookup('4000000000000002');
      expect(result.network).toBe('visa');
    });

    it('failure card BIN 510000 returns mastercard', () => {
      const result = simulateBinLookup('5100000000000008');
      expect(result.network).toBe('mastercard');
    });

    it('known success card BIN 411111 returns visa', () => {
      const result = simulateBinLookup('4111111111111111');
      expect(result.network).toBe('visa');
      expect(result.credit).toBe(true);
    });

    it('debit card BIN 404163 returns visa debit', () => {
      const result = simulateBinLookup('4041639099002469');
      expect(result.network).toBe('visa');
      expect(result.debit).toBe(true);
      expect(result.credit).toBe(false);
    });

    it('Amex BIN 378282 returns amex', () => {
      const result = simulateBinLookup('378282246310005');
      expect(result.network).toBe('amex');
      expect(result.credit).toBe(true);
    });

    it('Discover BIN 601198 returns discover', () => {
      const result = simulateBinLookup('6011989578768275');
      expect(result.network).toBe('discover');
    });

    it('testCard flag is true for known success cards', () => {
      const result = simulateBinLookup('4111111111111111');
      expect(result.testCard).toBe(true);
    });

    it('testCard flag is false for failure cards', () => {
      const result = simulateBinLookup('4000000000000002');
      expect(result.testCard).toBe(false);
    });

    it('testCard flag is false for unknown cards', () => {
      const result = simulateBinLookup('9999991234567890');
      expect(result.testCard).toBe(false);
    });

    it('returns correct bin (first 6 digits)', () => {
      const result = simulateBinLookup('4111111111111111');
      expect(result.bin).toBe('411111');
    });
  });
});
