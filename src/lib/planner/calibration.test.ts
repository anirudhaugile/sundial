import { describe, expect, it } from "vitest";
import { calibrationNote, courseCalibration } from "./calibration";

const s = (courseId: string, est: number, act: number, day = 1) => ({ courseId, estimatedMin: est, actualMin: act, completedAt: `2026-09-${String(day).padStart(2, "0")}` });

describe("courseCalibration", () => {
  it("shrinks toward 1 with few samples and approaches the observed ratio with more", () => {
    const one = courseCalibration([s("stat", 240, 360)]).get("stat")!; // raw 1.5, n=1 → 1 + .5/3
    expect(one).toEqual({ factor: 1.17, samples: 1 });
    const many = courseCalibration(Array.from({ length: 8 }, (_, i) => s("stat", 240, 360, i + 1))).get("stat")!; // n=8 → 1 + .5·0.8
    expect(many.factor).toBe(1.4);
  });

  it("keeps courses separate, ignores unusable samples, and clamps", () => {
    const m = courseCalibration([s("a", 60, 600), s("a", 60, 600), s("a", 60, 600), s("a", 60, 600), s("b", 120, 60), s("c", 0, 50), { ...s("x", 60, 60), courseId: null }]);
    expect(m.get("a")!.factor).toBe(2.5);
    expect(m.get("b")!.factor).toBe(0.83);
    expect(m.has("c")).toBe(false);
    expect(m.size).toBe(2);
  });

  it("uses only the most recent ten", () => {
    const old = Array.from({ length: 10 }, (_, i) => s("a", 60, 600, i + 1));
    const recent = Array.from({ length: 10 }, (_, i) => s("a", 60, 60, i + 15));
    expect(courseCalibration([...old, ...recent]).get("a")!.factor).toBe(1);
  });

  it("writes a short note", () => {
    expect(calibrationNote({ factor: 1.2, samples: 2 })).toBe("+20% for this course · calibrated from 2 completed items.");
    expect(calibrationNote({ factor: 1.01, samples: 3 })).toMatch(/on target/);
    expect(calibrationNote(undefined)).toBeNull();
  });
});
