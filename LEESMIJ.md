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
minder. Wat je gewoon bekijkt wordt apart bewaard en boven zo'n 1500 kaartdelen
automatisch opgeruimd; wat je bewust offline opslaat blijft staan. Het ophalen duurt een seconde of vier op wifi. Onder de knop staat
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

Zodra je op Start rit tikt legt de app je spoor vast, met tijdstip, hoogte en de
snelheid die de GPS zelf meet. Stop je (of kom je aan), dan opent het
**ritoverzicht**, ingedeeld zoals een activiteit in Strava:

- **Bovenin de kaart** met je rit gekleurd naar snelheid, helling of wind.
- **Kerncijfers**: afstand, rijtijd, gemiddelde, topsnelheid, klim, tijd
  onderweg, en geschat vermogen (gemiddeld, NP, W/kg, energie).
- **Analyse**: hoogte, snelheid en vermogen in één grafiek. Schuif met je vinger
  eroverheen: je ziet de waarden op dat punt en een stip op de kaart.
- **Beste prestaties**: snelste 1, 5, 10, 20 en 40 km, beste vermogen over
  5 s, 1, 5, 20 en 60 minuten.
- **Klimmen**: automatisch gevonden, met lengte, percentage, hoogtemeters, tijd,
  VAM en vermogen. Tik op een klim en de kaart zoomt erop in.
- **Wind**: kracht en richting, en hoeveel van je rit tegen-, zij- of meewind was.
- **Vermogenszones**, IF en TSS; **per 5 km**; **stops**; de knop **GPX voor Strava**.

Hoogte en weer haalt de app na de rit op: het hoogtemodel langs je hele spoor
(de GPS-hoogte van een iPhone ruist te veel) en het weer per uur via Open-Meteo.
Zonder bereik komt dat de volgende keer dat je het overzicht opent.

**Vul onder Fietsprofiel je gewicht in**, en je FTP als je die weet. Zonder FTP
schat de app hem uit je beste 20 minuten over al je ritten.

**Eerlijk over het vermogen:** een iPhone-webapp kan geen vermogensmeter of
hartslagband uitlezen (Safari op iOS kent geen Bluetooth voor websites). Het
vermogen is dus geschat uit snelheid, helling, wind en gewicht, zoals Strava doet
zonder meter. Solo zit het er zo'n 10 tot 15% naast. In een groep schat het te
hoog, want uit de wind rijden ziet de app niet.

Later vind je de rit terug onder **Gereden ritten** in het planpaneel. Tik op
een rit en het overzicht opent weer. De laatste tien ritten blijven bewaard;
tien ritten van 100 km kosten samen zo'n 1 MB.

Tussentijds wordt elke 15 seconden opgeslagen. Sluit iOS de app halverwege
(andere app open, telefoon op slot), dan zet de app die rit bij het volgende
openen alsnog bij je ritten, gemarkeerd als onderbroken.

## Telefoon in je zak: het slot

Tik onderweg op het **slotje** (ook te vinden op het cijferscherm en in de
spaarstand). Het scherm reageert dan nergens meer op, zodat zweet of je lichaam
niets per ongeluk kan aantikken. Spraak, GPS en de opname lopen gewoon door.
Ontgrendelen: schuif het groene slotje helemaal naar rechts.

**Stop** vraagt nu altijd eerst of je de rit echt wilt stoppen.

Nog strenger kan met iOS zelf: **Begeleide toegang** (Instellingen →
Toegankelijkheid). Drie keer op de zijknop en het hele scherm is dood, ook de
randen voor Bedieningspaneel en meldingen. Dat kan de app zelf niet afschermen.

## Weg dicht

Sta je voor een afsluiting, tik dan op het **wegafzetting-knopje** (🚧). De app
zet het stuk weg voor je dicht (of de weg waar je zou inslaan, als die afslag
binnen 60 m is) en rekent een omweg. Die afsluiting onthoudt hij een week, ook
bij het plannen. Je ziet hem als 🚧 op de kaart; tik erop om hem weg te halen.
Een weg die al dicht staat telt niet nog eens mee. Meld je vlak na een melding
(binnen een minuut en 100 m) nog een afsluiting, dan vraagt de app eerst of ook
die weg echt dicht is. Er worden er hooguit 20 bewaard.

## Route naar je Garmin (Edge 520)

Tik onder "Opslaan en delen" op **Naar Garmin, met afslagen**. De app maakt een
FIT-koers met elke afslag als koerspunt, met straatnaam en richting; bij een
rotonde staat erbij welke afslag het is. Je Edge piept dan bij elke afslag en
toont pijl, naam en de afstand ernaartoe. Een kale GPX kan dat niet: daar leidt
de Edge 520, die geen routekaart heeft, de bochten zelf af uit de vorm van de lijn.

1. Op de iPhone opent meteen het deelmenu. Kies **Connect** (Garmin Connect).
   Zie je dat deelmenu niet, dan komt het bestand in Bestanden; deel het van daaruit.
2. Kies het type fietsen en **Bewaar**. Tik in de koers op **Stuur naar apparaat**.
3. Zet de Edge aan in de buurt van je telefoon; hij synchroniseert via Bluetooth.
4. Op de Edge: **Navigatie → Koersen**, kies de route en start.

Met een kabel kan het ook: zet het .fit-bestand in de map `Garmin/NewFiles` van
de Edge en herstart hem.

## Testen

Zet `?test` achter het adres, bijvoorbeeld `https://JOUWNAAM.github.io/fietsnav/?test`.
De app draait dan vijfentwintig tests die elk een fout nalopen die ooit echt in de app
zat, en toont groen of rood per test. Duurt een paar seconden en gebruikt
nep-routes, dus het werkt ook zonder bereik. Je bewaarde routes en ritten worden
na afloop teruggezet. Haal `?test` weg om de app weer gewoon te gebruiken.

Upload daarvoor ook `tests.js` naar je repo. Zonder `?test` wordt dat bestand
niet eens opgehaald, dus het maakt de gewone app niet trager.

## Sleutelen

Alles zit in `index.html`. De stukken die er echt toe doen:

- `prepSpeech()` bepaalt wat er gezegd wordt en wanneer. De regels staan in het
  commentaar erboven.
- `snap()` legt je GPS-positie op de route. Het zoekvenster is met opzet smal
  naar achteren en ruim naar voren.
- `makeLoop()` bouwt vier kandidaat-rondjes in vier windstreken en laat de score
  kiezen. Daarna gaat de winnaar nog hoogstens drie keer terug de router in om de
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
- **Heen en weer naar een keerpunt** was het volgende probleem, en de oude maat
  zag het niet. Een keerpunt viel soms in een weiland of op een doodlopend
  weggetje; de route reed ernaartoe en via dezelfde weg terug. Vergeleken met
  negen Komoot-rondjes rond Delft (zelfde start, zelfde afstand, 27 rondjes per
  versie): oud 6,5% van de rit heen en weer (mediaan, slechtste 30,5%, 16 van
  de 27 boven 5%), Komoot 3,3%, nu 0,8% en 2 van de 27 boven 5%.
  `keerFractie()` meet het (dezelfde weg in tegengestelde richting terug, op een
  route die om de 20 m wordt bemonsterd), `zonderUitstapjes()` zet zo'n keerpunt
  terug naar de kruising waar het uitstapje begint, en de score trekt het
  dubbel zo zwaar af als gewone overlap.
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
- `ridden` in de ritstatus is wat je werkelijk fietst; `along` is alleen waar
  je op de route zit. Die twee lijken hetzelfde maar zijn het niet: bij een
  herberekening springt `along` terug naar nul. Gereden, gemiddelde, split,
  klim en voortgang horen op `ridden` te rekenen.
- `valhalla()` knipt routes van meer dan 10 punten op, want de openbare server
  weigert daarboven (`Exceeded max locations: 10`). `buildRoute()` laat daarna
  alleen de laatste "aangekomen"-melding staan: Valhalla zet er een aan het eind
  van elke leg, en een gegenereerd rondje heeft er zeven.
- `traceLine()` legt een ingeladen GPX op de weg. Breekt Valhalla de match af,
  dan vraagt hij het ontbrekende deel opnieuw op vanaf waar het ophield. Niet de
  "alternates" aan elkaar plakken: die overlappen en geven een teruglopend stuk.
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
