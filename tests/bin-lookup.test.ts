import { describe, it, expect } from "vitest";
import { simulateBinLookup } from "../src/simulator.js";

describe("pyxis_bin_lookup", () => {
  it("returns visa credit for known BIN 411111", () => {
    const result = simulateBinLookup("4111111111111111");
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("BinLookup");
    expect(result.bin).toBe("411111");
    expect(result.network).toBe("visa");
    expect(result.credit).toBe(true);
    expect(result.debit).toBe(false);
    expect(result.testCard).toBe(true);
    expect(result.cardLength).toBe(16);
  });

  it("returns Unknown for unknown BIN", () => {
    const result = simulateBinLookup("9999991234567890");
    expect(result.status).toBe("Success");
    expect(result.bin).toBe("999999");
    expect(result.network).toBe("Unknown");
    expect(result.credit).toBe(false);
    expect(result.testCard).toBe(false);
  });
});
