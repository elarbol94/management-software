import fs from "node:fs";
import path from "node:path";

const messagesDirectory = path.join(process.cwd(), "messages");
const locales = ["de", "en"];

function flatten(value, prefix = "") {
  const keys = new Set();
  for (const [key, nested] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
      for (const inner of flatten(nested, name)) keys.add(inner);
    } else {
      keys.add(name);
    }
  }
  return keys;
}

const keysByLocale = Object.fromEntries(
  locales.map((locale) => [
    locale,
    flatten(
      JSON.parse(
        fs.readFileSync(path.join(messagesDirectory, `${locale}.json`), "utf8"),
      ),
    ),
  ]),
);

const failures = [];
for (const locale of locales) {
  for (const other of locales) {
    if (locale === other) continue;
    const missing = [...keysByLocale[locale]].filter(
      (key) => !keysByLocale[other].has(key),
    );
    if (missing.length > 0) {
      failures.push(
        `${missing.length} key(s) in ${locale}.json missing from ${other}.json: ${missing.slice(0, 10).join(", ")}`,
      );
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Message parity broken:\n${failures.join("\n")}`);
}
