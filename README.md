# sportelo-reservations-scraper

Denní scraper obsazenosti českých sportovišť pro Sportelo benchmark dataset.

## Jak to funguje

1. **Notion** — zdroj cílů. Databáze [Facilities](https://www.notion.so/veevoy/346aa3daea868051bc68d00d098bd9c3) obsahuje sloupce `Name`, `Reservation URL`, `Scraper Active`.
2. **Playwright** otevře každou aktivní `Reservation URL`, odchytí rozpis slotů z Reservanto widgetu (iframe/XHR).
3. **Drizzle** zapíše snapshots do `benchmarks.snapshots` ve stávající Sportelo Postgres DB. Souhrn běhu jde do `benchmarks.scrape_runs`.
4. **Claude Code scheduled trigger** (cron `0 5 * * *`) spouští `npm run scrape`, čte JSON report a validuje výsledek.

## Setup

```bash
cp .env.example .env        # doplň NOTION_TOKEN
npm install
npx playwright install chromium
npm run db:generate         # vygeneruje SQL migraci
npm run db:migrate          # aplikuje proti DATABASE_URL
```

## Spuštění

```bash
npm run scrape              # ostrý běh — zapíše do DB, uloží ./reports/YYYY-MM-DD.json
npm run scrape -- --dry-run # bez zápisu, JSON na stdout
```

## Známá omezení MVP

- **Scope okna = aktuální den**. Reservanto iframe vloží do inline scriptu jen viditelný den (144 slotů / 3 kurty u Padel Neride). Pro +7 dní je potřeba widget navigovat na další dny — TODO v další iteraci.
- **Parser vázaný na Reservanto**. Jiná platforma = nový scraper modul, dispatch v `src/scrapers/dispatch.ts`.
- **Reporting**. Výstup je jen DB řádek `benchmarks.scrape_runs` + lokální `./reports/YYYY-MM-DD.json`. Slack/email TODO.

## Struktura

```
src/
├─ config/env.ts           # validace env
├─ db/                     # Drizzle schéma + migrace
├─ sources/notion.ts       # listFacilities()
├─ scrapers/reservanto/    # Reservanto widget scraper
├─ pipeline/               # run.ts, upsert.ts, report.ts
└─ utils/                  # logger, date helpers
```
