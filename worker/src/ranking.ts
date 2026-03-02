export function weightedScore(
  averageStars: number,
  voteCount: number,
  globalMean: number,
  priorWeight = 5
): number {
  if (voteCount <= 0) return 0;
  const v = voteCount;
  const r = averageStars;
  const c = Number.isFinite(globalMean) ? globalMean : 3;
  const m = priorWeight;
  return (v / (v + m)) * r + (m / (v + m)) * c;
}
