import { describe, it, expect } from "vitest";
import { simulateConvenienceFee } from "../src/simulator.js";

describe("pyxis_convenience_fee", () => {
  it("calculates 3% fee for a standard amount", () => {
    const result = simulateConvenienceFee({
      terminalId: "T001",
      totalAmount: "1000",
      accountType: "Visa",
    });
    expect(result.status).toBe("Success");
    expect(result.operation).toBe("ConvenienceFee");
    expect(result.terminalId).toBe("T001");
    expect(result.totalAmount).toBe("1000");
    expect(result.feeAmount).toBe("30");
    expect(result.totalWithFee).toBe("1030");
  });

  it("calculates 3% fee for a small amount", () => {
    const result = simulateConvenienceFee({
      terminalId: "T001",
      totalAmount: "100",
      accountType: "Visa",
    });
    expect(result.status).toBe("Success");
    expect(result.feeAmount).toBe("3");
    expect(result.totalWithFee).toBe("103");
  });
});
