import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_MARK_COLOR,
  USER_MARK_COLORS,
  getUserMarkColor,
  isUserMarkColor,
  userMarkColorStyle,
} from "./user-mark-colors";

describe("personal user marking colors", () => {
  it("provides sixteen unique palette tokens and solid colors", () => {
    expect(USER_MARK_COLORS).toHaveLength(16);
    expect(new Set(USER_MARK_COLORS.map((color) => color.key)).size).toBe(16);
    expect(new Set(USER_MARK_COLORS.map((color) => color.solid)).size).toBe(16);
  });

  it("accepts only palette keys and falls back safely", () => {
    expect(isUserMarkColor("indigo")).toBe(true);
    expect(isUserMarkColor("yellow")).toBe(false);
    expect(getUserMarkColor("damaged").key).toBe(DEFAULT_USER_MARK_COLOR);
  });

  it("exposes the shared CSS identity variables", () => {
    expect(userMarkColorStyle("teal")).toMatchObject({
      "--user-mark-solid": expect.any(String),
      "--user-mark-highlight": expect.any(String),
      "--user-mark-hover": expect.any(String),
      "--user-mark-dark": expect.any(String),
    });
  });
});
