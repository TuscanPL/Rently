# Parser fixtures

One saved HTML page per case, each asserted in `src/adapters.test.ts`.

The first set was **hand-built** from the known structure of each site's embedded
data (Otodom `__NEXT_DATA__`, OLX `__PRERENDERED_STATE__`, JSON-LD, OpenGraph),
because the dev sandbox couldn't reach the sites. Replace them with real saved
pages (`curl -A "<browser UA>" <url> > otodom-<id>.html`) when possible, and add a
new fixture whenever a parser breaks on a real ad.
