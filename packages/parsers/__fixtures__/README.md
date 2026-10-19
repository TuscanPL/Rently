# Parser fixtures

One saved HTML page per case, each asserted in `src/adapters.test.ts` (Otodom, OLX,
generic) or `src/portals.test.ts` (Gratka, Morizon, Nieruchomosci-online, Domiporta).

The first set was **hand-built** from the known structure of each site's embedded
data (Otodom `__NEXT_DATA__`, OLX `__PRERENDERED_STATE__`, JSON-LD, OpenGraph),
because the dev sandbox couldn't reach the sites.

The portal fixtures (`gratka-ad.html`, `morizon-ad.html`, `morizon-old-table.html`,
`nieruchomosci-online-ad.html`, `domiporta-ad.html`) are **hand-built too**, from
memory of each site's markup: class names, label wording, image CDN hosts and
size conventions are best guesses and unverified. The adapters lean on things
that change less (JSON-LD/microdata, the Polish detail labels, `srcset`), so a
wrong class name usually costs one field, not the whole ad.

Replace them with real saved pages (`curl -A "<browser UA>" <url> > gratka-<id>.html`,
or "Save page as… → HTML only" from a browser for sites that block curl) when
possible, and add a new fixture whenever a parser breaks on a real ad.
