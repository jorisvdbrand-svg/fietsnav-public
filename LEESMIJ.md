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
| Zoeken op plaatsnaam | Photon (Komoot) | gratis |
| Wind | Open-Meteo | gratis |
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

## Onderweg: drie schermen

Tijdens het rijden veeg je tussen drie schermen, of tik je op de knoppen rechts:

1. **Navigatie** met de kaart en de afslagbanner
2. **Cijfers** met snelheid, de laatste 5 km, gemiddelde, klim, afstand en aankomst
3. **Spaarstand**: zwart scherm met alleen de volgende afslag

Tik op de cijferbalk onderin om naar het cijferscherm te gaan, tik bovenaan om
terug te keren. De spraak loopt door op welk scherm je ook staat.

Op een kwart, de helft en driekwart van de rit krijg je gesproken te horen
hoeveel er nog te gaan is en hoe lang dat ongeveer duurt. Die tijdschatting gaat
op je werkelijke gemiddelde tot dan toe, niet op de ingestelde profielsnelheid.

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
- Bij een bewaarde route: tik de naam om hem te openen, de dubbele pijl om hem
  **omgekeerd** te rijden (de app zegt er meteen bij wat de wind ermee doet), of
  het driehoekje om **direct te gaan rijden**.
- **Deel link** zet de route in de URL. Zo stuur je hem van je laptop naar je
  telefoon zonder server.
- **GPX** exporteert een track die Garmin, Wahoo en Strava inlezen.

## De kaart offline meenemen

Navigeren werkte al zonder bereik, want de route en de instructies staan in je
telefoon. Nu haalt de knop **Deze route offline opslaan** ook de kaart binnen.

Reken op ongeveer 12 MB voor een lus van 60 km; door de stad meer, in de polder
minder. Het ophalen duurt een seconde of vier op wifi. Onder de knop staat
hoeveel er opgeslagen is, met een knop om het te wissen.

Getest met het netwerk naar de tegelserver volledig geblokkeerd: de kaart tekent
gewoon door, nul verzoeken, nul fouten.

Eén ding om te weten: Safari ruimt opslag op van sites die je een week niet
opent. De app vraagt om een uitzondering, maar dat is geen garantie. Haal je
route dus liever de avond ervoor binnen dan een week van tevoren.

## Je rit wordt opgenomen

Je **rijtijd** wordt apart bijgehouden van de totale tijd: stilstaan telt niet
mee. Je gemiddelde gaat op de rijtijd, want anders drukt elke koffiestop je
cijfers. Op het cijferscherm zie je beide naast elkaar staan.

Zodra je op Start rit tikt legt de app je spoor vast, met tijdstip en hoogte per
punt. Stop je, dan komt de rit onder **Gereden ritten** te staan met een
GPX-knop. Die GPX kun je zo in Strava laden: de tijdstippen per punt zijn precies
wat Strava nodig heeft om er een activiteit van te maken. De laatste tien ritten
blijven bewaard.

Tussentijds wordt elke 15 seconden opgeslagen, dus een crash of een per ongeluk
gesloten tab kost je de rit niet.

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
- `tierDistances()` bepaalt wanneer de spraak afgaat, in seconden voor de bocht.
  Hier ging het eerst mis: de regel was `max(110, v*9)`, en die ondergrens van
  110 meter wint bij elke fietssnelheid onder 44 km/u. De instructie kwam dus
  altijd op 110 meter, oftewel 14 seconden vooraf bij 28 km/u en 18 bij 22.
  Nu domineert de tijdterm: gemeten bij 22, 28 en 35 km/u komt de hoofdinstructie
  op 7,4 / 7,0 / 7,0 seconden. Vroege waarschuwing op 36 s, korte bevestiging op
  2,5 s in de drukke stukken.
- `windScore()` vergelijkt de netto koers van het eerste en laatste kwart van de
  route met waar de wind vandaan komt. Tegenwind heen en rugwind terug is wat je
  wilt. Het gewicht schaalt mee met de windkracht: onder 12 km/u telt het niet,
  boven 30 vol. Wind stuurt mee maar wint niet van een duidelijk mooiere route.
- `importGPX()` leest een GPX en haalt de punten door Valhalla's `/trace_route`.
  Dat endpoint legt een spoor op het wegennet en geeft er Nederlandse
  afslaginstructies bij. Een route van Komoot of een vriend krijgt daarmee
  volledige spraaknavigatie. Getest met een heen-en-weer: 11,4 km en 13 afslagen
  eruit, 11,4 km en 13 afslagen er weer in.
- `splitSpeed()` houdt een buffer van (afstand, tijd) bij en kijkt terug naar het
  monster van 5 km geleden. Dat getal reageert veel sneller op een versnelling
  dan het gemiddelde over de hele rit.
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
