# sportelo-reservations-scraper

Denní scraper obsazenosti českých sportovišť pro Sportelo benchmark dataset.

## Jak to funguje

1. **Notion** — zdroj cílů. Databáze [Facilities](https://www.notion.so/Sportelo-34650cb5a99e806391aaf6e8772d34aa) obsahuje sloupce `Name`, `Reservation URL`, `Sport`, `Scraper Active`.
2. **Sync** — před scrape se Notion řádky upsertují do `benchmarks.facilities` (master). Chybějící řádky se deaktivují.
3. **Playwright** otevře aktivní `Reservation URL`, odchytí rozpis slotů z Reservanto widgetu (inline `DailyHorizotalCalendar.days` v iframu).
4. **Sport per slot**: scraper se pokouší detekovat sport z `BookingServiceName` (multi-sport sportoviště). Když nezjistí, použije sport z Notionu (facility-level).
5. **Drizzle** zapíše snapshots do `benchmarks.snapshots` a souhrn běhu do `benchmarks.scrape_runs` (včetně celého reportu v sloupci `report_json`).
6. **Daily summary** (`npm run summary`) agreguje nejčerstvější snapshots per (facility, sport, date) do `benchmarks.daily_summaries`.

## Setup

```bash
cp .env.example .env        # doplň DATABASE_URL + NOTION_TOKEN
npm install
npx playwright install chromium
npm run db:generate         # vygeneruje SQL migraci
npm run db:migrate          # aplikuje proti DATABASE_URL
```

## Spuštění

```bash
npm run scrape                      # ostrý běh — sync facilities, scrape, zápis do DB
npm run scrape -- --dry-run         # bez zápisu, JSON na stdout
npm run scrape -- --facility=<id>   # jen jedna facility (DB UUID)
npm run summary                     # agreguje snapshots dneška → daily_summaries
npm run summary -- 2026-04-19       # explicitní den
```

## Známá omezení MVP

- **Scope okna = aktuální den**. Reservanto iframe bootstrap vloží do inline scriptu jen viditelný den (144 slotů / 3 kurty u Padel Neride). +7 dní vyžaduje navigaci widgetu (TODO).
- **Parser vázaný na Reservanto**. Jiná platforma (jdemenato, Reenio) = nový modul v `src/scrapers/<platform>/` + dispatch v `src/scrapers/dispatch.ts`.
- **Reporting**. Výstup je v `benchmarks.scrape_runs` (`report_json` JSONB). Slack/email TODO.

## DB schéma (`benchmarks` schema)

- `facilities` — master z Notion syncu (`id`, `notion_page_id`, `name`, `reservation_url`, `sport`, `active`)
- `snapshots` — per-slot observace (`facility_id`, `sport`, `date_checked`, `time_slot`, `court_id`, `is_available`)
- `scrape_runs` — 1 řádek per běh (`validation_status`, `report_json`)
- `daily_summaries` — agregát (`facility_id`, `sport`, `summary_date`, `total_slots`, `available_slots`, `occupancy_pct`, …)
- `scrape_errors` — per-chyba detailní log s dedup + resolved workflow (níže)

Migrations table: `benchmarks.__benchmarks_migrations` (izolovaná od cizích drizzle instalací).

## Error handling & auto-fix workflow

Tabulka `benchmarks.scrape_errors` drží každý problem jako **otevřený incident**. Opakující se chyba (stejný `fingerprint`) se **neduplikuje** — místo toho se bumpne `occurrence_count` + `last_seen_at`. Když chybu označíš jako `resolved=true` a problém se znovu objeví, vznikne nový řádek (regrese).

### Sloupce

| Sloupec | Význam |
|---|---|
| `fingerprint` | SHA1(stage + facility_id + normalized message). Stejná chyba napříč běhy = stejný fingerprint. |
| `stage` | `bootstrap \| sync \| scrape \| parse \| insert \| validate \| summary` |
| `error_type` | `network \| timeout \| parse \| validation \| db \| unexpected` |
| `error_message`, `error_stack`, `context` | Full info pro debug (context je JSONB — URL, status code, selektor, …) |
| `facility_id`, `facility_name`, `reservation_url`, `platform` | Kde to selhalo |
| `first_seen_at`, `last_seen_at`, `occurrence_count` | Kdy + kolikrát |
| `resolved`, `resolved_at`, `resolved_by`, `resolved_note` | Stav řešení |

### Export otevřených chyb (pro AI debug)

```sql
SELECT
  id, stage, error_type, occurrence_count, first_seen_at, last_seen_at,
  facility_name, reservation_url, platform,
  error_message, error_stack, context
FROM benchmarks.scrape_errors
WHERE resolved = false
ORDER BY last_seen_at DESC;
```

Výstup hoď do AI chatu s promptem `"Toto jsou otevřené chyby scraperu. Navrhni opravu."`

### Mark as resolved (jakmile fix nasazen)

```sql
UPDATE benchmarks.scrape_errors
SET resolved = true,
    resolved_at = NOW(),
    resolved_by = 'auto-fix PR #12',  -- nebo 'manual', commit SHA, …
    resolved_note = 'extract inline-script regex updated to tolerate new Reservanto markup'
WHERE id = '<uuid>';
```

Nebo hromadně pro všechny stejný fingerprint:
```sql
UPDATE benchmarks.scrape_errors
SET resolved = true, resolved_at = NOW(), resolved_by = 'fix abc123'
WHERE fingerprint = '<hash>' AND resolved = false;
```

## Struktura

```
src/
├─ config/env.ts                 # zod validace env
├─ db/                           # Drizzle schéma + migrace
├─ sources/
│  ├─ notion.ts                  # listNotionFacilities()
│  └─ sync.ts                    # syncFacilities() — upsert do DB
├─ scrapers/
│  ├─ types.ts, browser.ts, dispatch.ts
│  └─ reservanto/                # Reservanto widget scraper + parser (sport detect)
├─ pipeline/                     # run.ts, upsert.ts, report.ts, validate.ts, summary.ts
├─ bin/summary.ts                # CLI entry pro summary
└─ utils/                        # logger, date helpers
```
