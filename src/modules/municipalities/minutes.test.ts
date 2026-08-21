import { describe, expect, it } from "vitest";
import { analysisHasValidEvidence, dateFromMinutePath, dateFromMinuteText, type MunicipalityMinuteAnalysis } from "./minutes";

describe("municipality minutes", () => {
  it("derives dates from the filename and year folder", () => {
    expect(dateFromMinutePath("2024/VHS_GRS 04.07.2024_genehmigt.pdf")).toBe("2024-07-04");
    expect(dateFromMinutePath("2016/GRS-Protokoll 25.2.2016.pdf")).toBe("2016-02-25");
    expect(dateFromMinutePath("2021/02.07.2021 - Gemeinderatssitzung 27.05.2021.pdf")).toBe("2021-05-27");
    expect(dateFromMinutePath("2024/VHS_GRS 15.02..2024_genehmigt.pdf")).toBe("2024-02-15");
    expect(dateFromMinutePath("2024/31.02.2024.pdf")).toBeNull();
    expect(dateFromMinutePath("2011/Gemeinderatssitzung.pdf")).toBeNull();
  });

  it("derives dates from extracted German minute text", () => {
    expect(dateFromMinuteText("Tag und Zeit: Donnerstag, 7. April 2011")).toBe("2011-04-07");
    expect(dateFromMinuteText("Sitzung am 3. Jänner 2025")).toBe("2025-01-03");
    expect(dateFromMinuteText("Sitzung am 31.02.2025")).toBeNull();
  });

  it("requires exact normalized evidence on the referenced page", () => {
    const analysis = {
      schemaVersion: 1,
      municipalityCode: "41739",
      documentId: "document-1",
      meetingDate: "2026-03-26",
      meetingType: "municipal_council",
      shortSummary: "Der Gemeinderat behandelte einen Radweg.",
      warnings: [],
      agendaItems: [{
        itemNumber: "5.2",
        title: "Geh- und Radweg",
        topics: ["transport_public_space"],
        activityType: "financing",
        summary: "Die Finanzierung des Geh- und Radwegs wurde behandelt.",
        decisionStatus: "approved",
        vote: "einstimmig",
        financialAmounts: [],
        locations: ["Steindorf"],
        projectNames: ["Geh- und Radweg Steindorf-Mitte"],
        evidence: [{ page: 5, quote: "Finanzierungsbestätigung   Geh- und Radweg" }],
        containsPersonalData: false,
      }],
    } satisfies MunicipalityMinuteAnalysis;
    const pages = [{ page: 5, text: "Finanzierungsbestätigung Geh- und Radweg", extractionMethod: "native" as const }];
    expect(analysisHasValidEvidence(analysis, pages)).toBe(true);
    expect(analysisHasValidEvidence(analysis, [{ ...pages[0], text: "Anderer Inhalt" }])).toBe(false);
  });
});
