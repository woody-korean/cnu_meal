const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toKstDate(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

function fromKstDate(kstDate: Date): Date {
  return new Date(kstDate.getTime() - KST_OFFSET_MS);
}

function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getKstCalendarDate(now: Date = new Date()): string {
  return formatYmd(toKstDate(now));
}

export function getVoteDayKey(now: Date = new Date()): string {
  const kst = toKstDate(now);
  if (kst.getUTCHours() >= 4) {
    return formatYmd(kst);
  }
  const prevDay = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
  return formatYmd(prevDay);
}

export function isValidYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseYmdAsKst(value: string): Date | null {
  if (!isValidYmd(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const kstUtcEquivalent = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return fromKstDate(kstUtcEquivalent);
}

export function kstNowIso(now: Date = new Date()): string {
  return toKstDate(now).toISOString().replace("Z", "+09:00");
}

export function getUtcWindowKey(now: Date = new Date(), minutes = 10): string {
  const intervalMs = minutes * 60 * 1000;
  const windowStart = Math.floor(now.getTime() / intervalMs) * intervalMs;
  return String(windowStart);
}
