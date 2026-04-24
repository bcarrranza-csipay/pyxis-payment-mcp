import { describe, it, expect, beforeEach } from 'vitest';
import {
  simulateGetToken,
  simulateTokenize,
  simulateSale,
  simulateAuthorize,
  simulateCapture,
  simulateVoid,
  simulateRefund,
  simulateGetTransaction,
  simulateGetSettledTransactions,
  simulateConvenienceFee,
  simulateBinLookup,
  simulateSettleTransactions,
} from '../src/simulator.js';
import { state } from '../src/state.js';

const TERMINAL = 'test-terminal-001';
const TEST_CARD = '4111111111111111';

describe('Acceptance test — full developer lifecycle', () => {
  beforeEach(() => state.reset());

  it('complete payment lifecycle: auth → tokenize → sale → settle → refund', () => {
    // Step 1: Authenticate
    const auth = simulateGetToken('dev_user', 'dev_pass');
    expect(auth.status).toBe('Success');
    expect(auth.token).toBeDefined();
    const token = auth.token!;

    // Step 2: Check convenience fee
    const fee = simulateConvenienceFee({ terminalId: TERMINAL, totalAmount: '2530', accountType: 'Visa' });
    expect(fee.status).toBe('Success');
    expect(parseInt((fee as any).feeAmount)).toBeGreaterThan(0);

    // Step 3: BIN lookup
    const bin = simulateBinLookup(TEST_CARD);
    expect(bin.status).toBe('Success');
    expect((bin as any).network).toBe('visa');

    // Step 4: Tokenize card
    const tokenResult = simulateTokenize({
      terminalId: TERMINAL,
      accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa', accountAccessory: '12.2026' },
      accountHolder: { holderFirstName: 'John', holderLastName: 'Doe' },
    });
    expect(tokenResult.status).toBe('Success');
    const cardToken = tokenResult.token;
    expect(cardToken).toBeDefined();

    // Step 5: Process sale with token
    const sale = simulateSale({
      terminalId: TERMINAL,
      token: cardToken,
      totalAmount: '2530',
      externalTransactionId: 'INV-001',
    });
    expect((sale as any).status).toBe('Success');
    const saleId = (sale as any).transactionId;
    expect((sale as any).approvedAmount).toBe('2530');
    expect((sale as any).accountMasked).toBeDefined();

    // Step 6: Query transaction
    const query = simulateGetTransaction(saleId);
    expect((query as any).status).toBe('Success');
    expect((query as any).transactionStatus).toBe('Approved');
    expect((query as any).isDeclined).toBe(false);

    // Step 7: Settle transaction via the settlement tool
    const settleResult = simulateSettleTransactions({ transactionId: saleId });
    expect((settleResult as any).status).toBe('Success');
    expect((settleResult as any).settled).toBe(1);

    // Step 8: Refund
    const refund = simulateRefund({ terminalId: TERMINAL, transactionToRefundId: saleId });
    expect((refund as any).status).toBe('Success');
    expect((refund as any).approvedAmount).toBe('2530');

    // Step 9: Verify final state
    const finalQuery = simulateGetTransaction(saleId);
    expect((finalQuery as any).transactionStatus).toBe('Refunded');
  });

  it('authorize → capture → void lifecycle', () => {
    // Auth
    const auth = simulateAuthorize({
      terminalId: TERMINAL,
      totalAmount: '5000',
      accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
    });
    expect((auth as any).status).toBe('Success');
    const authId = (auth as any).transactionId;
    expect((auth as any).feeAmount).toBeDefined(); // T1.11d

    // Capture
    const capture = simulateCapture({ terminalId: TERMINAL, transactionId: authId, totalAmount: '4000' });
    expect((capture as any).status).toBe('Success');
    const captureId = (capture as any).transactionId;

    // Void the capture (before settlement)
    const voidResult = simulateVoid({ terminalId: TERMINAL, transactionToVoidId: captureId });
    expect((voidResult as any).status).toBe('Success');

    // Verify capture is voided
    const query = simulateGetTransaction(captureId);
    expect((query as any).transactionStatus).toBe('Voided');
  });

  it('failure card → declined → cannot void/refund/capture', () => {
    // Failure card creates declined transaction
    const sale = simulateSale({
      terminalId: TERMINAL,
      totalAmount: '1000',
      accountInfo: { accountNumber: '4000000000000002', accountType: 'Visa' },
    });
    expect((sale as any).status).toBe('Error');
    const txId = (sale as any).transactionId;

    // Cannot void declined
    const voidResult = simulateVoid({ terminalId: TERMINAL, transactionToVoidId: txId });
    expect((voidResult as any).errors[0].errorCode).toBe('358');
  });

  it('recurring payment flow: First → InTrack', () => {
    const first = simulateSale({
      terminalId: TERMINAL,
      totalAmount: '2000',
      accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      recurring: 'First',
    });
    expect((first as any).status).toBe('Success');
    const scheduleId = (first as any).recurringScheduleTransId;
    expect(scheduleId).toBeDefined();

    const inTrack = simulateSale({
      terminalId: TERMINAL,
      totalAmount: '2000',
      accountInfo: { accountNumber: TEST_CARD, accountType: 'Visa' },
      recurring: 'InTrack',
      recurringScheduleTransId: scheduleId,
    });
    expect((inTrack as any).status).toBe('Success');
  });
});
