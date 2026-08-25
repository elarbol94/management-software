/**
 * Map colours for the municipality choropleth.
 *
 * The ramps are designed for how they render *on the map*, not as raw swatches:
 * fills sit at MAP_FILL_OPACITY over the desaturated basemap, which lifts every
 * step towards the map surface. Each ramp is therefore built from the composited
 * target colour backwards, so the six steps still clear an OKLab lightness gap of
 * 0.06 once drawn.
 *
 * Deliberate deviation: the lightest step does not reach the 2:1 contrast floor a
 * chart mark would need. A choropleth class is a large bordered area rather than a
 * thin mark, and holding that floor with six separable steps would force the whole
 * ramp into dark mid-tones. Instead the "no data" case is separated by opacity —
 * see MAP_NO_DATA_OPACITY — so it never reads as "smallest class".
 */

export const MAP_FILL_OPACITY = 0.8;
export const MAP_HOVER_FILL_OPACITY = 0.92;
// No-data areas let the basemap through, so they read as textured/empty next to the
// flat data fills. Colour alone could not separate them: the closest data colour
// stays under an OKLab ΔE of 15 against every neutral grey that still looks neutral.
export const MAP_NO_DATA_OPACITY = 0.25;
export const MAP_NO_DATA_COLOR = "#b4b4ae";

/** Shared categorical colours for municipality politics maps and charts. */
export const POLITICS_PARTY_COLORS = {
  oevp: "#202124",
  spoe: "#d71920",
  fpoe: "#2056a7",
  gruene: "#2f8f46",
  neos: "#e83e8c",
  kpoe: "#8f1d21",
  mfg: "#e58a17",
  "local-other": "#0e7490",
  tie: "#7656a8",
} as const;

export const MUNICIPALITY_SEQUENTIAL_COLORS = [
  "#9dede3",
  "#6acabf",
  "#3ea79a",
  "#1b8377",
  "#035e54",
  "#003933",
] as const;

export const MUNICIPALITY_MOVEMENT_COLORS = [
  "#e9ccff",
  "#c6a4ef",
  "#a37ece",
  "#7f5ca7",
  "#5b3d7c",
  "#382051",
] as const;

export const MUNICIPALITY_COST_COLORS = [
  "#ffcf94",
  "#e9a95e",
  "#c68231",
  "#a16011",
  "#764000",
  "#4c2300",
] as const;

/** ColorBrewer RdBu, 9 classes: red = negative, neutral grey at zero, blue = positive. */
export const MUNICIPALITY_DIVERGING_COLORS = [
  "#b2182b",
  "#d6604d",
  "#f4a582",
  "#fddbc7",
  "#f7f7f7",
  "#d1e5f0",
  "#92c5de",
  "#4393c3",
  "#2166ac",
] as const;

/**
 * Where each diverging colour sits, as a fraction of the domain maximum.
 *
 * Balance metrics pile up around zero — the median municipality is at 0.15 of the
 * domain and 85 % stay inside its inner half. Spacing the stops linearly therefore
 * painted most of Austria in the near-white midpoint. These stops follow the
 * observed quantiles instead, so the four bands per arm carry roughly
 * 18/39/26/12 % of all municipality-years.
 */
export const MUNICIPALITY_DIVERGING_STOPS = [0.05, 0.2, 0.45, 1] as const;
