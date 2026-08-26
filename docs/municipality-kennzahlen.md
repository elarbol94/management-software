# Ausgangsdaten und Kennzahlen

Die Gemeinde-Seite trennt **Ausgangsdaten** (Werte, die so in einer Datei stehen) von
**Kennzahlen** (Werte, die aus Ausgangsdaten berechnet werden). Das erste Dropdown im
Kennzahl-Panel der Karte wählt die Datenart, die beiden folgenden Kategorie und Ansicht
wie bisher.

## Zwei Implementierungen, ein Test

Jede eingebaute Kennzahl existiert doppelt:

1. Als handgeschriebene Funktion — `demographicIndicatorValue`, `movementMetricValue`,
   `municipalityCostShare` und so weiter. Das ist der Ausführungspfad der Karte. Er läuft
   über 2.092 Gemeinden × 24 Jahre und bleibt deshalb so, wie er ist.
2. Als Ausdrucksbaum in `kennzahlExpressionFor` (`src/modules/municipalities/kennzahlen.ts`).
   Daraus entstehen der Herleitungs-Graph im Analyse-Tool, der Formeltext und die
   Auswertung selbst definierter Kennzahlen.

`kennzahlen.test.ts` rechnet beide Wege für jede Kennzahl über alle Jahre gegeneinander.
**Eine neue Kennzahl braucht daher beides** — sonst schlägt der Test fehl. Genau das ist
seine Aufgabe: Die im Analyse-Tool angezeigte Herleitung soll die Formel sein, mit der die
Karte tatsächlich rechnet, und nicht eine gut gemeinte Nacherzählung.

Vier Kennzahlen haben bewusst keinen Ausdrucksbaum (`expression: null`) und werden im
Katalog als Primärberechnung ausgewiesen:

| Kennzahl | fehlendes Vokabular |
| --- | --- |
| Durchschnittsalter | Summe der Lebensjahre, kein sinnvolles Ausgangsdatum |
| Real je Einwohner | VPI je Jahr, also eine jahresabhängige Referenzreihe |
| Abweichung von Vergleichsgemeinden | Median über andere Gemeinden, kein binärer Operator |
| Politik und Digitales | eigene Ausgangsdaten, noch nicht modelliert |

## Eine Kennzahl hinzufügen

1. Ausgangsdaten prüfen: Lässt sich die Kennzahl aus vorhandenen Basisgrößen ausdrücken?
   Falls nicht, die fehlende Größe ergänzen. Dabei die Konvention beachten: Arrays, die
   die Validierung gegen die Datendatei vergleicht (`COST_CATEGORIES`, `MOVEMENT_METRICS`,
   `AGE_GROUPS`), **dürfen nicht wachsen**. Zusätzliche Auswahlziele kommen in ein eigenes
   `*_TARGETS`-Array daneben.
2. Die handgeschriebene Berechnung ergänzen und den Ref-Typ in `analysis.ts` erweitern.
3. `kennzahlExpressionFor` um den Ausdrucksbaum ergänzen.
4. Die Ansicht in `*_VIEWS_BY_KIND` der richtigen Datenart zuordnen.
5. Deutsche und englische Labels ergänzen — auch für jede neue Einheit unter `units.*`.
   Eine fehlende Einheit lässt next-intl werfen und nimmt die ganze Knotenliste mit.

## Selbst definierte Kennzahlen

Im Analyse-Tool wird der Teilgraph unter einem Knoten über „Als Kennzahl speichern" zu
einer eigenen Kennzahl (`municipality_metrics`). Die Gemeinde wird dabei abgestreift und
zum Parameter — das geht nur, wenn der Teilgraph von einer einzigen Gemeinde handelt.
Ein Graph, der zwei Gemeinden vergleicht, ist ein Vergleich und keine Kennzahl und wird
abgelehnt statt stillschweigend umgedeutet.

Auf der Karte werden diese Kennzahlen über `createKennzahlLookup` ausgewertet, nicht über
`resolveMunicipalityDataset`: Letzteres sucht pro Jahr linear im Index und die
Peer-Abweichung darin ist quadratisch über alle Gemeinden.
