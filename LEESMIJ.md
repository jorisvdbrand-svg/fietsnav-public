# Fietsnav

Routes maken en gesproken fietsnavigatie. Eén HTML-bestand, geen account,
geen API-sleutel, geen abonnement.

## Waar het op draait

| Onderdeel | Bron | Kosten |
|---|---|---|
| Fietsrouting + Nederlandse afslagteksten | Valhalla (FOSSGIS) | gratis |
| Kaarttegels | OpenFreeMap | gratis, geen limiet |
| Kaart-engine | MapLibre GL JS | open source |
| Hoogteprofiel | Valhalla /height | gratis |
| Reserve-router | BRouter | gratis |
| Fietsknooppunten | OpenStreetMap via Overpass | gratis |
| Stem | Web Speech API van je telefoon | ingebouwd |

Valhalla draait op een gemeenschapsserver. Wees er zuinig mee: de app wacht
al even met herberekenen terwijl je punten versleept.

## Op je iPhone zetten

De app heeft GPS nodig, en dat werkt alleen op een https-adres. Lokaal openen
of via je wifi-IP werkt daarom niet.

1. Ga naar github.com en maak een nieuwe repository, bijvoorbeeld `fietsnav`.
   Zet hem op **Public** (Pages werkt niet op gratis private repos).
2. Klik **uploading an existing file** en sleep `index.html`,
   `manifest.webmanifest` en `icon.png` erin. Commit.
3. **Settings** > **Pages** > Source: `Deploy from a branch`, branch `main`,
   map `/ (root)`. Opslaan.
4. Na een minuut staat hij op `https://<jouwnaam>.github.io/fietsnav/`.
5. Open dat adres in Safari, tik op deelknop > **Zet op beginscherm**.
   Dan start hij schermvullend zonder Safari-balken.

Bij de eerste rit vraagt iOS om je locatie: sta toe, anders werkt navigeren niet.

## Onderweg

Het scherm moet aan blijven en de app moet vooraan staan. De app houdt het
scherm zelf wakker. Zet je de telefoon op slot, dan stopt iOS de spraak en de
GPS: dat is een grens van de browser, niet iets wat de app kan omzeilen.

De maanknop zet de spaarstand aan: zwart scherm met alleen de volgende afslag.
Op een OLED-scherm scheelt dat flink.

## Snelkoppelingen

- Tik op de kaart: punt toevoegen. Slepen om te verplaatsen.
- Tik op een punt: weghalen.
- De pijl linksboven draait de laatste stap terug. Ook **Wis** en een gegenereerd
  rondje zijn daarmee terug te halen, dus je raakt nooit per ongeluk alles kwijt.
- **Deel link** zet de route in de URL. Zo stuur je hem van je laptop naar je
  telefoon zonder server.
- **GPX** exporteert een track die Garmin, Wahoo en Strava inlezen.

## Sleutelen

Alles zit in `index.html`. De stukken die er echt toe doen:

- `prepSpeech()` bepaalt wat er gezegd wordt en wanneer. De regels staan in het
  commentaar erboven.
- `snap()` legt je GPS-positie op de route. Het zoekvenster is met opzet smal
  naar achteren en ruim naar voren.
- `makeLoop()` bouwt vier kandidaat-rondjes in vier windstreken en laat de score
  kiezen. Daarna gaat de winnaar nog hoogstens twee keer terug de router in om de
  afstand kloppend te krijgen.
- **De vorm is waar het misging.** De eerste versie zette drie keerpunten op een
  cirkel, 120 graden uit elkaar. Dat lijkt logisch maar geeft een ster in plaats
  van een lus: de kortste weg tussen twee van die punten loopt dwars door het
  midden, dus telkens terug door je eigen startplaats. Gemeten bij Delft was
  17,7% van de route dubbel. Met zes punten kan de router niet meer door het
  midden snijden (de koorde tussen twee buren ligt dan op 87% van de straal in
  plaats van op 50%), en dat zakte naar 3%. `shapeOffsetRing` gaat nog een stap
  verder: die legt de cirkel *naast* je startpunt in plaats van eromheen, zodat
  je een kant op rijdt, daar een lus maakt en anders terugkomt. Dat geeft 0,1%.
- `overlapFraction()` meet hoeveel van de route over zichzelf heen loopt, met een
  rasterindeling zodat het lineair blijft. Twee punten tellen als dubbel bij
  minder dan 35 m afstand maar meer dan 2 km verschil in route-afstand. Dit
  weegt zwaar mee in de score: een rondje dat over zichzelf heen loopt is geen
  rondje, hoe mooi de wegen ook zijn.
- `rateRoute()` is de kwaliteitsmaat, en die is belangrijker dan hij lijkt.
  Meters per bocht zegt namelijk niets over wegdek, paaltjes of of je door
  weiland of langs een bedrijventerrein rijdt. Wat er nu in zit, met gewicht:
  landelijk (0.34), aandeel in stukken van 1 km zonder bocht (0.30), idem vanaf
  2,5 km (0.15), weinig kruisingen (0.11), glad asfalt (0.10), en aftrek voor
  paaltjes en hekken. Afstandsafwijking telt apart mee, anders wint een mooi
  maar 7% te lang rondje het van een bijna even mooi rondje dat wel klopt.
- `fetchRoadAttrs()` haalt die wegdata op met Valhalla's `/trace_attributes`.
  Twee dingen uit het uitzoekwerk: `edge.density` is een uitstekende maat voor
  landelijk versus stad (Den Haag centrum 14,1; polder Midden-Delfland 3,5;
  Beemster 2,6; buitengebied Uden 4,2), maar `node.traffic_signal` is in
  Nederland **niet** gevuld - nul stoplichten op een route dwars door het
  centrum van Den Haag. Daarom kruisingen per kilometer als vervanger.
  Een uitgedunde lijn van ~420 punten dekt met `map_snap` een hele lus van
  60 km in één aanroep.
- `fetchKnooppunten()` haalt het Nederlandse fietsknooppuntennetwerk op uit
  OpenStreetMap via Overpass. Dat zijn de routes die provincies hebben uitgezet
  en bewegwijzerd. Eerlijk over wat het oplevert: gemeten over drie richtingen
  bij Uden geeft het 15% minder bochten en langere rechte stukken, maar ook meer
  paaltjes, en per saldo is het een gelijkspel (0,68 tegen 0,67). Daarom zit het
  erin als variant en niet als vaste keuze. Overpass is traag en streng
  gelimiteerd, dus het antwoord gaat drie maanden in localStorage en bij
  uitblijven gaat de generator gewoon zonder verder.

Gemeten na deze wijziging, vier proeven: Delft 40 km gaf 40,8 km met 0,2%
dubbel, Delft 80 km gaf 76,2 km met 1,9%, Uden 60 km gaf 59,8 km met 0,2% en
Uden 100 km gaf 100,7 km met 0,2%. Een rondje kost 5 tot 10 seconden, voor
80 km en meer kan het oplopen tot een seconde of 17.

**Waar je start bepaalt veel meer dan de generator.** Vanaf Uden halen rondjes
dichtheid 2,9 tot 4,2 met 73 tot 84% lange stukken. Vanaf Delft blijft alles
steken op 7,3 tot 9,0, hoe je ook zoekt: een lus van 60 km rondom Delft komt
altijd door de Randstad. Dat is geen fout in de generator maar in de
aardrijkskunde.
- `ascent()` rekent het klimmen uit. Bewust voorzichtig, zie het commentaar.
- `window.__fietsnav` is de testhaak: daarmee kun je posities injecteren en een
  rit simuleren zonder te fietsen.
