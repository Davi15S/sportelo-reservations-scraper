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
    };
