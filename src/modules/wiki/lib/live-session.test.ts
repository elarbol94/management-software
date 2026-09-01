import { describe, expect, it } from "vitest";
import {
  LIVE_SESSION_CODE_LENGTH,
  LIVE_SESSION_STALE_MS,
  generateLiveSessionCode,
  isLiveSessionStale,
  liveSessionCodeSchema,
  liveSessionFollowPath,
  normalizeLiveSessionCode,
} from "./live-session";

describe("generateLiveSessionCode", () => {
  it("produces a code of the expected length from the unambiguous alphabet", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generateLiveSessionCode();
      expect(code).toHaveLength(LIVE_SESSION_CODE_LENGTH);
      expect(normalizeLiveSessionCode(code)).toBe(code);
    }
  });

  it("never emits characters that are easy to misread", () => {
    // Exhaust the alphabet by walking the random source across its whole range.
    const emitted = new Set<string>();
    for (let step = 0; step < 1_000; step += 1) {
      for (const character of generateLiveSessionCode(() => step / 1_000)) emitted.add(character);
    }
    for (const forbidden of ["0", "O", "1", "I", "L", "5", "S"]) {
      expect(emitted.has(forbidden)).toBe(false);
    }
  });
});

describe("normalizeLiveSessionCode", () => {
  it("upper-cases and strips the separators people type", () => {
    expect(normalizeLiveSessionCode(" abc-234 ")).toBe("ABC234");
    expect(normalizeLiveSessionCode("ABC 234")).toBe("ABC234");
  });

  it("rejects wrong lengths and characters outside the alphabet", () => {
    expect(normalizeLiveSessionCode("ABC23")).toBeNull();
    expect(normalizeLiveSessionCode("ABC2345")).toBeNull();
    expect(normalizeLiveSessionCode("")).toBeNull();
    // O and 0 are not in the alphabet, so a misread code fails instead of hitting the database.
    expect(normalizeLiveSessionCode("ABC23O")).toBeNull();
    expect(normalizeLiveSessionCode("ABC230")).toBeNull();
  });
});

describe("liveSessionCodeSchema", () => {
  it("parses to the normalized code", () => {
    expect(liveSessionCodeSchema.parse("abc-234")).toBe("ABC234");
  });

  it("fails closed on junk", () => {
    expect(liveSessionCodeSchema.safeParse("nope").success).toBe(false);
    expect(liveSessionCodeSchema.safeParse("x".repeat(64)).success).toBe(false);
  });
});

describe("isLiveSessionStale", () => {
  it("keeps a session alive inside the window and drops it after", () => {
    const now = 1_000_000;
    expect(isLiveSessionStale(now, now)).toBe(false);
    expect(isLiveSessionStale(now - LIVE_SESSION_STALE_MS, now)).toBe(false);
    expect(isLiveSessionStale(now - LIVE_SESSION_STALE_MS - 1, now)).toBe(true);
  });
});

describe("liveSessionFollowPath", () => {
  it("points at the follow route", () => {
    expect(liveSessionFollowPath("ABC234")).toBe("/wiki/presentations/follow/ABC234");
  });
});
