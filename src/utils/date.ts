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
