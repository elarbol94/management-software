import { describe, expect, it } from "vitest";
import { breakdownFromGross, breakdownFromNet, isVatRate } from "./vat";

describe("breakdownFromGross", () => {
  it("splits 120.00 € gross at 20% into 100.00 net + 20.00 VAT", () => {
    expect(breakdownFromGross(12000, 20)).toEqual({
      grossCents: 12000,
      netCents: 10000,
      vatCents: 2000,
    });
  });

  it("splits 113.00 € gross at 13%", () => {
    expect(breakdownFromGross(11300, 13)).toEqual({
      grossCents: 11300,
      netCents: 10000,
      vatCents: 1300,
    });
  });

  it("splits 110.00 € gross at 10%", () => {
    expect(breakdownFromGross(11000, 10)).toEqual({
      grossCents: 11000,
      netCents: 10000,
      vatCents: 1000,
    });
  });

  it("treats 0% as pass-through", () => {
    expect(breakdownFromGross(9999, 0)).toEqual({
      grossCents: 9999,
      netCents: 9999,
      vatCents: 0,
    });
  });

  it("rounds the net half up (1.00 € at 20% → 0.83 net)", () => {
    // 100 / 1.2 = 83.33…
    expect(breakdownFromGross(100, 20)).toEqual({
      grossCents: 100,
      netCents: 83,
      vatCents: 17,
    });
  });

  it("rounds exactly .5 up (0.03 € at 20% → 2.5 → 3 cents net)", () => {
    expect(breakdownFromGross(3, 20)).toEqual({
      grossCents: 3,
      netCents: 3,
      vatCents: 0,
    });
  });

  it("always satisfies net + vat === gross", () => {
    for (const rate of [20, 13, 10, 0] as const) {
      for (let gross = 0; gross <= 5000; gross++) {
        const { netCents, vatCents } = breakdownFromGross(gross, rate);
        expect(netCents + vatCents).toBe(gross);
      }
    }
  });

  it("rejects negative and non-integer amounts", () => {
    expect(() => breakdownFromGross(-1, 20)).toThrow();
    expect(() => breakdownFromGross(10.5, 20)).toThrow();
  });

  it("rejects invalid rates", () => {
    expect(() => breakdownFromGross(100, 19 as never)).toThrow();
  });
});

describe("breakdownFromNet", () => {
  it("adds 20% VAT to 100.00 € net", () => {
    expect(breakdownFromNet(10000, 20)).toEqual({
      grossCents: 12000,
      netCents: 10000,
      vatCents: 2000,
    });
  });

  it("rounds VAT half up (0.03 € net at 13% → 0.0039 → 0 cents)", () => {
    expect(breakdownFromNet(3, 13)).toEqual({
      grossCents: 3,
      netCents: 3,
      vatCents: 0,
    });
  });

  it("rounds exactly .5 up (0.10 € net at 13% → 1.3 → 1 cent; 0.50 € at 13% → 6.5 → 7)", () => {
    expect(breakdownFromNet(10, 13).vatCents).toBe(1);
    expect(breakdownFromNet(50, 13).vatCents).toBe(7);
  });

  it("always satisfies net + vat === gross", () => {
    for (const rate of [20, 13, 10, 0] as const) {
      for (let net = 0; net <= 5000; net++) {
        const { grossCents, vatCents } = breakdownFromNet(net, rate);
        expect(net + vatCents).toBe(grossCents);
      }
    }
  });
});

describe("isVatRate", () => {
  it("accepts Austrian rates and rejects others", () => {
    expect(isVatRate(20)).toBe(true);
    expect(isVatRate(13)).toBe(true);
    expect(isVatRate(10)).toBe(true);
    expect(isVatRate(0)).toBe(true);
    expect(isVatRate(19)).toBe(false);
    expect(isVatRate(7)).toBe(false);
  });
});
