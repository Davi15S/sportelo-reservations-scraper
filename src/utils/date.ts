/**
 * Dnešní datum v Europe/Prague (timezone ve které Reservanto / CZ sportoviště
 * uvádí sloty). Nepoužívat UTC — scraper běží v 5:00 Europe/Prague a sloty
 * mají offset +01:00/+02:00, takže date_checked musí odpovídat lokálnímu dni.
 */
export function todayInPrague(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

/**
 * Aktuální čas v Europe/Prague převedený na minuty od půlnoci.
 * Používá se k vyloučení právě probíhajících slotů ze zaplněnosti (nelze je
 * už zarezervovat) — start slotu < now → invalid.
 */
export function nowMinutesInPrague(): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
}
