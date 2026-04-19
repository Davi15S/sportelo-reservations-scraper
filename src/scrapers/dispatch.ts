import type { Facility, FacilityScrapeResult } from './types';
import { scrapeReservantoFacility } from './reservanto/index';

export async function scrapeFacility(facility: Facility): Promise<FacilityScrapeResult> {
  switch (facility.reservationSystem) {
    case 'reservanto':
      return await scrapeReservantoFacility(facility);
    case 'jdemenato':
    case 'bizzi':
    case 'sroger':
      return {
        status: 'failed',
        facility,
        error: `scraper module for '${facility.reservationSystem}' is not implemented yet`,
      };
    default:
      return {
        status: 'failed',
        facility,
        error: `unknown reservation system: ${String((facility as Facility).reservationSystem)}`,
      };
  }
}
