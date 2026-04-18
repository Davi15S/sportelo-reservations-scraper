export type Facility = {
  id: string;
  notionPageId: string;
  name: string;
  reservationUrl: string;
  sport: string;
  active: boolean;
};

export type SlotSnapshot = {
  dateChecked: string;
  timeSlot: string;
  courtId: string;
  isAvailable: boolean;
  /** Sport detekovaný z rezervačního systému (BookingServiceName apod.).
   *  `null` = scraper nezjistil → pipeline použije sport z Notionu jako fallback. */
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
