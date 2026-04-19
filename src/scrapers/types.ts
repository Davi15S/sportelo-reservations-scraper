export type ReservationSystem = 'reservanto' | 'jdemenato' | 'bizzi' | 'sroger';

export type Facility = {
  id: string;
  notionPageId: string;
  name: string;
  reservationUrl: string;
  /** Typ rezervačního systému — určuje který scraper modul se použije. */
  reservationSystem: ReservationSystem;
  active: boolean;
};

export type SlotSnapshot = {
  dateChecked: string;
  timeSlot: string;
  courtId: string;
  isAvailable: boolean;
  /** Sport detekovaný z rezervačního systému (BookingServiceName apod.).
   *  `null` = scraper nezjistil → pipeline fallback na facility.reservationSystem. */
  sport: string | null;
};

export type FacilityScrapeResult =
  | {
      status: 'ok';
      facility: Facility;
      snapshots: SlotSnapshot[];
      rawSample?: unknown;
    }
  | {
      status: 'failed';
      facility: Facility;
      error: string;
      /** Base64 PNG fullpage screenshot v momentě pádu. Slouží k post-mortem debugu
       *  (CF challenge vs. 403 vs. rate limit). Oříznutý na ~200 KB aby zapadl do JSONB. */
      debugScreenshot?: string | null;
    };
