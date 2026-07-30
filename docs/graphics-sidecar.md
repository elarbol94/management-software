# Graphics sidecar files

A graphic in a synced folder can carry its Literaturstelle in a JSON file with
the **same name**:

```
grafiken/svg/
  01_kennzahlen-wohlstand.svg
  01_kennzahlen-wohlstand.json
```

On folder sync the sidecar becomes a wiki source, linked to the page as a
supporting source and to the graphic itself. Inserting the graphic then uses the
sidecar's `caption` as the figure caption.

JSON is deliberate: it needs no parser and no dependency, and it is validated by
the same schema the source form uses (`graphicsSidecarSchema`). A malformed
sidecar fails that one graphic and reports the reason; the others still import.

## Fields

All fields are optional except `title` and `type`.

| Field | Notes |
| --- | --- |
| `title` | Required. |
| `type` | Required. One of `journalArticle`, `book`, `bookChapter`, `report`, `webPage`, `document`. |
| `documentType` | Free text, e.g. `Grafik`. |
| `readingStatus` | `toRead`, `reading`, `read`. Defaults to `toRead`. |
| `issuedDate` | Year or date as text, e.g. `2026`. |
| `contributors` | `{ role: "author" \| "editor", given, family, literal }`. Use `literal` for institutions. |
| `publisher`, `institution` | Leave out for eigene Darstellung. |
| `doi`, `isbn`, `url` | Normalised on save. Leave out rather than passing a local path. |
| `abstract`, `notes` | Long text. `\n` for line breaks. |
| `tagNames` | Created if they do not exist yet. |
| `caption` | Not part of the source: the ready-made Bildunterschrift used on insert. |

## Example

```json
{
  "title": "Materieller Wohlstand in Österreich – Kennzahlen",
  "type": "document",
  "documentType": "Grafik",
  "readingStatus": "read",
  "issuedDate": "2026",
  "contributors": [
    { "role": "author", "given": "Aaron Fabian", "family": "Keuschnig", "literal": "" }
  ],
  "abstract": "Vier Kennzahlen zum materiellen Wohlstand privater Haushalte in Österreich: Median des verfügbaren Nettohaushaltseinkommens 4.025 €/Monat (48.303 €/Jahr); Sparquote 11,7 %; BIP pro Kopf in Kaufkraftstandards Index 123 (EU-27 = 100); 569 Pkw je 1.000 Einwohner:innen bei 5,23 Mio. zugelassenen Pkw.",
  "notes": "Eigene Darstellung. Datengrundlage je Kachel:\n- Median-Nettohaushaltseinkommen: Statistik Austria, EU-SILC 2024\n- Sparquote 11,7 %: Statistik Austria, Pressemitteilung vom 31.03.2025, S. 1\n- BIP/Kopf KKS Index 123 (2023): Eurostat, Datensatz tec00114\n- 569 Pkw je 1.000 Einw.: Statistik Austria, Pressemitteilung vom 25.02.2025, S. 1",
  "caption": "Abbildung X: Materieller Wohlstand in Österreich – Kennzahlen. Eigene Darstellung auf Basis von Statistik Austria (EU-SILC 2024; Sparquote 2024, S. 1; Kfz-Bestand 2024, S. 1) und Eurostat (tec00114, 2023).",
  "tagNames": ["Projektbeschreibung", "Grafik", "eigene Darstellung", "Wohlstand", "Österreich"]
}
```

## Re-syncing

The sidecar is hashed, so an unchanged one is skipped entirely — no source
revision is written. Editing it revises the **existing** source rather than
creating a second one, because the graphic remembers which source it created.
Deleting the source and syncing again creates a fresh one.
