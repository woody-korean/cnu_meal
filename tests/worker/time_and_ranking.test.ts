import { describe, expect, it } from "vitest";

import { weightedScore } from "../../worker/src/ranking";
import { getVoteDayKey } from "../../worker/src/time";
import { normalizeEnglish, parseStars } from "../../worker/src/validation";

describe("vote day key", () => {
  it("uses calendar day in KST before midnight boundary", () => {
    const at2359Kst = new Date("2026-03-02T14:59:00.000Z"); // 2026-03-02 23:59 KST
    expect(getVoteDayKey(at2359Kst)).toBe("2026-03-02");
  });

  it("switches exactly at 00:00 KST", () => {
    const at0000Kst = new Date("2026-03-02T15:00:00.000Z"); // 2026-03-03 00:00 KST
    expect(getVoteDayKey(at0000Kst)).toBe("2026-03-03");
  });
});

describe("weighted score", () => {
  it("shrinks low-vote meals toward global mean", () => {
    const lowVote = weightedScore(5, 1, 3.5, 5);
    const highVote = weightedScore(5, 100, 3.5, 5);
    expect(lowVote).toBeLessThan(highVote);
  });

  it("returns zero for zero votes", () => {
    expect(weightedScore(5, 0, 3.5, 5)).toBe(0);
  });
});

describe("validation helpers", () => {
  it("validates stars", () => {
    expect(parseStars(3)).toBe(3);
    expect(parseStars(0)).toBeNull();
    expect(parseStars(5.5)).toBeNull();
  });

  it("falls back english when missing", () => {
    expect(normalizeEnglish("null", "정식(4000)")).toBe("정식(4000)");
    expect(normalizeEnglish("", "정식(4000)")).toBe("정식(4000)");
    expect(normalizeEnglish("Rice", "정식(4000)")).toBe("Rice");
  });
});
