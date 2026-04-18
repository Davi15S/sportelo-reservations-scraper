import type { Facility, FacilityScrapeResult } from './types';
import { scrapeReservantoFacility } from './reservanto/index';

export async function scrapeFacility(facility: Facility): Promise<FacilityScrapeResult> {
  // MVP: jediná podporovaná platforma = Reservanto. Dispatch podle hosta
  // rozšíříme, až přibude druhá platforma.
  return await scrapeReservantoFacility(facility);
}
