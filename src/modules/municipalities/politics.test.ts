import { describe, expect, it } from "vitest";
import {
  canonicalPartyForList,
  electionAsOf,
  electionPartyShare,
  electionTurnout,
  leadingElectionList,
  mergePredecessorElectionEvents,
  validateElectionEvent,
  type MunicipalityElectionEvent,
} from "./politics";

function event(overrides: Partial<MunicipalityElectionEvent> = {}): MunicipalityElectionEvent {
  return {
    id: "10101-2022-10-02", date: "2022-10-02", eligibleVoters: 100, ballotsCast: 80,
    validVotes: 78, invalidVotes: 2, councilSize: 3,
    lists: [{ name: "SPÖ", party: "spoe", votes: 48, mandates: 2 }, { name: "ÖVP", party: "oevp", votes: 30, mandates: 1 }],
    mayorCandidates: [], aggregationStatus: "direct", predecessorCodes: ["10101"], sourceIds: ["fixture"],
    missingReasons: { mayorCandidates: "not-published" }, ...overrides,
  };
}

describe("municipality politics", () => {
  it("maps only recognizable national party names", () => {
    expect(canonicalPartyForList("ÖVP – Volkspartei Musterstadt")).toBe("oevp");
    expect(canonicalPartyForList("SPÖ und Unabhängige")).toBe("spoe");
    expect(canonicalPartyForList("Liste Zukunft Musterstadt")).toBe("local-other");
  });

  it("checks ballot, list-vote and council-seat invariants", () => {
    expect(validateElectionEvent(event())).toBeTruthy();
    expect(() => validateElectionEvent(event({ ballotsCast: 81 }))).toThrow(/Stimmensumme/);
    expect(() => validateElectionEvent(event({ validVotes: 79 }))).toThrow(/Stimmensumme|Listenstimmen/);
    expect(() => validateElectionEvent(event({ councilSize: 4 }))).toThrow(/Mandatssumme/);
  });

  it("selects the latest election on or before 31 December", () => {
    const events = [event({ id: "old", date: "2017-10-01" }), event({ id: "new", date: "2022-10-02" })];
    expect(electionAsOf(events, 2021)?.id).toBe("old");
    expect(electionAsOf(events, 2022)?.id).toBe("new");
    expect(electionAsOf(events, 2000)).toBeNull();
  });

  it("derives leading list, party share and turnout", () => {
    expect(leadingElectionList(event())).toMatchObject({ kind: "leader", list: { party: "spoe" } });
    expect(electionPartyShare(event(), "spoe")).toBeCloseTo(48 / 78);
    expect(electionTurnout(event())).toBe(0.8);
    expect(leadingElectionList(event({ lists: [{ name: "A", party: "local-other", votes: 39, mandates: null }, { name: "B", party: "local-other", votes: 39, mandates: null }], councilSize: null, missingReasons: { councilSize: "not-applicable", mayorCandidates: "not-published" } }))).toMatchObject({ kind: "tie" });
  });

  it("sums predecessor votes but never combines seats or mayor candidacies", () => {
    const left = event({ id: "left", predecessorCodes: ["61234"], lists: [{ name: "SPÖ", party: "spoe", votes: 48, mandates: 2 }, { name: "ÖVP", party: "oevp", votes: 30, mandates: 1 }] });
    const right = event({ id: "right", predecessorCodes: ["61235"], lists: [{ name: "SPÖ", party: "spoe", votes: 48, mandates: 2 }, { name: "ÖVP", party: "oevp", votes: 30, mandates: 1 }] });
    const merged = mergePredecessorElectionEvents("61299", [left, right]);
    expect(merged.validVotes).toBe(156);
    expect(merged.lists.find((list) => list.party === "spoe")).toMatchObject({ votes: 96, mandates: null });
    expect(merged.councilSize).toBeNull();
    expect(merged.mayorCandidates).toEqual([]);
    expect(merged.aggregationStatus).toBe("aggregated-predecessors");
    expect(validateElectionEvent(merged)).toBeTruthy();
  });

  it("keeps Vienna as municipality 90001", () => {
    const vienna = event({ id: "90001-2025-04-27", date: "2025-04-27", predecessorCodes: ["90001"] });
    expect(vienna.predecessorCodes).toEqual(["90001"]);
    expect(vienna.predecessorCodes).not.toContain("901");
  });
});
