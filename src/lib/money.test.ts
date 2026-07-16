import { describe, expect, it } from "vitest";
import { formatCentsPlainDe, parseAmountToCents } from "./money";

describe("parseAmountToCents", () => {
  it("parses German format", () => {
    expect(parseAmountToCents("1.234,56")).toBe(123456);
    expect(parseAmountToCents("0,99")).toBe(99);
    expect(parseAmountToCents("12,5")).toBe(1250);
  });

  it("parses English format", () => {
    expect(parseAmountToCents("1,234.56")).toBe(123456);
    expect(parseAmountToCents("1234.56")).toBe(123456);
    expect(parseAmountToCents("12.5")).toBe(1250);
  });

  it("parses plain integers", () => {
    expect(parseAmountToCents("120")).toBe(12000);
    expect(parseAmountToCents("0")).toBe(0);
  });

  it("treats a lone separator with 3 digits as thousands", () => {
    expect(parseAmountToCents("1.234")).toBe(123400);
    expect(parseAmountToCents("1,234")).toBe(123400);
  });

  it("handles currency symbols and spaces", () => {
    expect(parseAmountToCents("€ 99,90")).toBe(9990);
    expect(parseAmountToCents(" 1 234,56 ")).toBe(123456);
  });

  it("handles negatives", () => {
    expect(parseAmountToCents("-12,50")).toBe(-1250);
  });

  it("treats a lone separator with exactly 3 trailing digits as thousands", () => {
    expect(parseAmountToCents("12,345")).toBe(1234500);
  });

  it("rejects garbage", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("1,23,4")).toBeNull();
    expect(parseAmountToCents("1.23.456,00")).toBeNull();
    expect(parseAmountToCents("12,3456")).toBeNull();
  });
});

describe("formatCentsPlainDe", () => {
  it("formats cents with comma", () => {
    expect(formatCentsPlainDe(123456)).toBe("1234,56");
    expect(formatCentsPlainDe(5)).toBe("0,05");
    expect(formatCentsPlainDe(0)).toBe("0,00");
    expect(formatCentsPlainDe(-1250)).toBe("-12,50");
  });
});
