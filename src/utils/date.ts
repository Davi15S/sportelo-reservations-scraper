export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function scrapeWindow(startISO: string, windowDays: number): string[] {
  return Array.from({ length: windowDays }, (_, i) => addDaysISO(startISO, i));
}
