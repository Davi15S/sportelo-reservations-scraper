export type Facility = {
  id: string;
  name: string;
  reservationUrl: string;
  active: boolean;
};

export type SlotSnapshot = {
  dateChecked: string;
  timeSlot: string;
  courtId: string;
  isAvailable: boolean;
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
