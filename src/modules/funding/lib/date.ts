const AUSTRIAN_TIME_ZONE = "Europe/Vienna";

export function toAustrianIsoDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: AUSTRIAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}
