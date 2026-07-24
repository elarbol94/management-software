import type { CSSProperties } from "react";

export const USER_MARK_COLORS = [
  { key: "amber", solid: "#b45309", highlight: "rgb(245 158 11 / 0.30)", hover: "rgb(245 158 11 / 0.42)", dark: "rgb(251 191 36 / 0.24)" },
  { key: "orange", solid: "#c2410c", highlight: "rgb(249 115 22 / 0.28)", hover: "rgb(249 115 22 / 0.40)", dark: "rgb(251 146 60 / 0.23)" },
  { key: "red", solid: "#b91c1c", highlight: "rgb(239 68 68 / 0.25)", hover: "rgb(239 68 68 / 0.38)", dark: "rgb(248 113 113 / 0.22)" },
  { key: "rose", solid: "#be123c", highlight: "rgb(244 63 94 / 0.25)", hover: "rgb(244 63 94 / 0.38)", dark: "rgb(251 113 133 / 0.22)" },
  { key: "pink", solid: "#be185d", highlight: "rgb(236 72 153 / 0.25)", hover: "rgb(236 72 153 / 0.38)", dark: "rgb(244 114 182 / 0.22)" },
  { key: "fuchsia", solid: "#a21caf", highlight: "rgb(217 70 239 / 0.24)", hover: "rgb(217 70 239 / 0.36)", dark: "rgb(232 121 249 / 0.21)" },
  { key: "purple", solid: "#7e22ce", highlight: "rgb(168 85 247 / 0.25)", hover: "rgb(168 85 247 / 0.38)", dark: "rgb(192 132 252 / 0.22)" },
  { key: "violet", solid: "#6d28d9", highlight: "rgb(139 92 246 / 0.25)", hover: "rgb(139 92 246 / 0.38)", dark: "rgb(167 139 250 / 0.22)" },
  { key: "indigo", solid: "#4338ca", highlight: "rgb(99 102 241 / 0.25)", hover: "rgb(99 102 241 / 0.38)", dark: "rgb(129 140 248 / 0.22)" },
  { key: "blue", solid: "#1d4ed8", highlight: "rgb(59 130 246 / 0.25)", hover: "rgb(59 130 246 / 0.38)", dark: "rgb(96 165 250 / 0.22)" },
  { key: "sky", solid: "#0369a1", highlight: "rgb(14 165 233 / 0.25)", hover: "rgb(14 165 233 / 0.38)", dark: "rgb(56 189 248 / 0.22)" },
  { key: "cyan", solid: "#0e7490", highlight: "rgb(6 182 212 / 0.25)", hover: "rgb(6 182 212 / 0.38)", dark: "rgb(34 211 238 / 0.21)" },
  { key: "teal", solid: "#0f766e", highlight: "rgb(20 184 166 / 0.25)", hover: "rgb(20 184 166 / 0.38)", dark: "rgb(45 212 191 / 0.21)" },
  { key: "emerald", solid: "#047857", highlight: "rgb(16 185 129 / 0.25)", hover: "rgb(16 185 129 / 0.38)", dark: "rgb(52 211 153 / 0.21)" },
  { key: "green", solid: "#15803d", highlight: "rgb(34 197 94 / 0.25)", hover: "rgb(34 197 94 / 0.38)", dark: "rgb(74 222 128 / 0.21)" },
  { key: "lime", solid: "#4d7c0f", highlight: "rgb(132 204 22 / 0.27)", hover: "rgb(132 204 22 / 0.40)", dark: "rgb(163 230 53 / 0.22)" },
] as const;

export type UserMarkColor = (typeof USER_MARK_COLORS)[number]["key"];

export const DEFAULT_USER_MARK_COLOR: UserMarkColor = USER_MARK_COLORS[0].key;

export function isUserMarkColor(value: unknown): value is UserMarkColor {
  return typeof value === "string" && USER_MARK_COLORS.some((color) => color.key === value);
}

export function getUserMarkColor(value: unknown) {
  return USER_MARK_COLORS.find((color) => color.key === value) ?? USER_MARK_COLORS[0];
}

export function userMarkColorStyle(value: unknown): CSSProperties {
  const color = getUserMarkColor(value);
  return {
    "--user-mark-solid": color.solid,
    "--user-mark-highlight": color.highlight,
    "--user-mark-hover": color.hover,
    "--user-mark-dark": color.dark,
  } as CSSProperties;
}

export function initialsForName(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
}
