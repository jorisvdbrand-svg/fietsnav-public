/* Kopwerk testmodus. Laadt alleen met ?test in het adres.

   Elke test hier is een fout die ooit echt in de app zat. De routes zijn nep en
   de netwerkaanroepen zijn onderschept, zodat de tests niet van Valhalla
   afhangen en in een paar seconden klaar zijn. Na afloop wordt alles wat de
   tests in localStorage aanraken teruggezet: je bewaarde routes en ritten
   blijven zoals ze waren.

   Let op bij het bewerken: geen backslashes gebruiken. De manier waarop dit
   project bestanden schrijft heeft die drie keer stukgemaakt. */
(async function () {
  'use strict';

  /* ---------------- hulpjes ---------------- */
  const uitslagen = [];
  const wacht = ms => new Promise(r => setTimeout(r, ms));
  const tik = () => new Promise(r => setTimeout(r, 0));
  const json = (obj, status) => new Response(JSON.stringify(obj),
    { status: status || 200, headers: { 'Content-Type': 'application/json' } });

  // localStorage van de app veiligstellen
  const bewaard = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.indexOf('fietsnav.') === 0) bewaard[k] = localStorage.getItem(k);
  }
  const herstelOpslag = () => {
    const weg = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('fietsnav.') === 0 && !(k in bewaard)) weg.push(k);
    }
    weg.forEach(k => localStorage.removeItem(k));
    Object.keys(bewaard).forEach(k => localStorage.setItem(k, bewaard[k]));
  };

  // Alles wat een echte rit naar buiten doet, tijdelijk dichtzetten
  const echt = {
    fetch: window.fetch, valhalla: window.valhalla, stopNav: window.stopNav,
    say: Voice.say, prime: Voice.prime, wakeOn: Wake.on, now: Date.now,
    watch: navigator.geolocation && navigator.geolocation.watchPosition
  };
  let gezegd = [];
  Voice.say = t => gezegd.push({ t: t, along: S.nav ? S.nav.along : 0, ridden: S.nav ? S.nav.ridden : 0 });
  Voice.prime = function () {};
  Wake.on = async function () {};
  window.stopNav = function () {};            // arrive() mag niet via een timer ingrijpen
  try { navigator.geolocation.watchPosition = () => 1; } catch (e) {}
  let klok = echt.now();
  Date.now = () => klok;

  /* Een trapvormige nep-route: afwisselend noord en oost, met een bocht elke
     `bochtM` meter. Loopt nooit over zichzelf, dus de matcher kan niet de
     verkeerde passage pakken. */
  function trap(start, km, bochtM) {
    const stap = 25;
    const dLat = stap / 111320;
    const dLon = stap / (111320 * Math.cos(start[0] * Math.PI / 180));
    const pts = [[start[0], start[1]]];
    const bochten = [];
    let noord = true, sinds = 0, af = 0;
    while (af < km * 1000) {
      const p = pts[pts.length - 1];
      pts.push(noord ? [p[0] + dLat, p[1]] : [p[0], p[1] + dLon]);
      af += stap; sinds += stap;
      if (sinds >= bochtM) { bochten.push(pts.length - 1); noord = !noord; sinds = 0; }
    }
    return { pts: pts, bochten: bochten };
  }

  // Valhalla-achtige trip uit een lijn. `extra` maakt de opgegeven lengte iets
  // langer dan de gemeten lijn, zoals Valhalla in het echt doet.
  function nepTrip(pts, bochten, extra) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    const idx = [0].concat(bochten || []).concat([pts.length - 1]);
    const man = [];
    for (let k = 0; k < idx.length; k++) {
      const bi = idx[k], ei = k + 1 < idx.length ? idx[k + 1] : bi;
      let m;
      if (k === 0) m = { type: 1, instruction: 'Vertrek.' };
      else if (k === idx.length - 1) {
        m = { type: 4, instruction: 'Aangekomen op je bestemming.',
              verbal_pre_transition_instruction: 'Aangekomen op je bestemming.' };
      } else {
        const zin = (k % 2 === 1) ? 'Rechts afslaan.' : 'Links afslaan.';
        m = { type: (k % 2 === 1) ? 10 : 15, instruction: zin,
              verbal_pre_transition_instruction: zin,
              verbal_transition_alert_instruction: zin,
              verbal_succinct_transition_instruction: zin };
      }
      m.begin_shape_index = bi; m.end_shape_index = ei; m.length = (cum[ei] - cum[bi]) / 1000;
      man.push(m);
    }
    const totaal = cum[cum.length - 1];
    return { legs: [{ shape: encodePoly(pts, 6), maneuvers: man }],
             summary: { length: totaal / 1000 * (1 + (extra || 0)), time: totaal / 7 } };
  }

  // Rechte lijn tussen twee punten, elke 50 m een punt
  function lijnTussen(a, b) {
    const n = Math.max(2, Math.ceil(hav(a, b) / 50));
    const uit = [];
    for (let i = 0; i <= n; i++) uit.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    return uit;
  }

  // Nep-/route: een leg per paar punten, en net als de echte server boven de
  // tien punten een 400.
  function nepRouteServer(req) {
    const body = JSON.parse(req.body);
    const locs = body.locations;
    if (locs.length > 10) {
      return json({ error: 'Exceeded max locations: 10', error_code: 150 }, 400);
    }
    const legs = [];
    let lengte = 0;
    for (let i = 0; i < locs.length - 1; i++) {
      const pts = lijnTussen([locs[i].lat, locs[i].lon], [locs[i + 1].lat, locs[i + 1].lon]);
      const t = nepTrip(pts, []);
      legs.push(t.legs[0]);
      lengte += t.summary.length;
    }
    return json({ trip: { legs: legs, summary: { length: lengte, time: lengte * 130 } } });
  }

  // Route en tussenpunten altijd samen zetten, zoals de app dat doet. Een route
  // zonder tussenpunten liet eerder een omweg-test een undefined achter waar alle
  // volgende tests over struikelden.
  function zetRoute(trip) {
    S.route = buildRoute(trip);
    const p = S.route.pts;
    S.wps = [{ lat: p[0][0], lon: p[0][1] }, { lat: p[p.length - 1][0], lon: p[p.length - 1][1] }];
    S.line = null;
    return S.route;
  }
  function start() {
    gezegd = [];
    startNav();
    if (!S.nav) throw new Error('startNav startte geen rit');
  }
  function stop() {
    S.nav = null;
    document.body.className = 'mode-plan';
  }
  function punt(route, d) {
    const c = route.cum;
    let lo = 0, hi = c.length - 1;
    if (d >= c[hi]) return route.pts[hi].slice();
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (c[m] < d) lo = m; else hi = m; }
    const t = (d - c[lo]) / ((c[hi] - c[lo]) || 1);
    return [route.pts[lo][0] + (route.pts[hi][0] - route.pts[lo][0]) * t,
            route.pts[lo][1] + (route.pts[hi][1] - route.pts[lo][1]) * t];
  }
  function fix(pos, kmh) {
    S.nav && onFix({ coords: { latitude: pos[0], longitude: pos[1], speed: kmh / 3.6,
                              heading: null, accuracy: 5, altitude: 10 } });
    klok += 1000;
  }
  function rijd(route, van, tot, kmh) {
    const v = kmh / 3.6;
    for (let d = van; d < tot && S.nav && !S.nav.done; d += v) fix(punt(route, d), kmh);
  }
  function stilstaan(seconden, pos) {
    for (let i = 0; i < seconden; i++) fix(pos, 0);
  }

  async function test(naam, fn) {
    try {
      const r = await fn();
      uitslagen.push({ naam: naam, ok: r.ok, detail: r.detail });
    } catch (e) {
      uitslagen.push({ naam: naam, ok: false, detail: 'crash: ' + e.message });
    } finally {
      stop();
      window.fetch = echt.fetch;
      window.valhalla = echt.valhalla;
    }
  }

  /* ---------------- de tests ---------------- */

  await test('Aankomst vuurt aan het eind van een rit van 60 km', async () => {
    // Valhalla's opgegeven lengte 0,1% langer dan de lijn, zoals in het echt.
    // Met de oude code kwam "Je bent er" daardoor nooit.
    const t = trap([52.0, 5.0], 60, 1200);
    zetRoute(nepTrip(t.pts, t.bochten, 0.001));
    start();
    rijd(S.route, 0, S.route.len * 0.95, 28);
    const teVroeg = S.nav.done;
    rijd(S.route, S.route.len * 0.95, S.route.len + 50, 28);
    const ok = !teVroeg && S.nav && S.nav.done === true;
    return { ok: ok, detail: teVroeg ? 'vuurde al op 95%' : (ok ? 'vuurde op het eind' : 'vuurde nooit') };
  });

  await test('Gereden, gemiddelde en voortgang overleven een omweg', async () => {
    const t = trap([52.0, 5.0], 60, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    rijd(S.route, 0, 30000, 28);
    // omweg: drie fixes 300 m naast de route, dan rekent hij opnieuw
    const naast = punt(S.route, 30000); naast[1] += 0.0045;
    window.valhalla = async wps => {
      const nieuw = trap([wps[0].lat, wps[0].lon], 20, 1200);
      return buildRoute(nepTrip(nieuw.pts, nieuw.bochten));
    };
    for (let i = 0; i < 4; i++) { fix(naast, 28); await tik(); }
    await tik(); await tik();
    const nieuwe = S.route;
    rijd(nieuwe, 0, 2000, 28);
    paintData();
    const gereden = S.nav.ridden / 1000;
    const gem = S.nav.ridden / (S.nav.rijtijd / 1000) * 3.6;
    const kwart = gezegd.filter(x => x.t.indexOf('Een kwart') === 0).length;
    const half = gezegd.filter(x => x.t.indexOf('Halverwege') === 0).length;
    const ok = gereden > 31 && gereden < 33 && gem > 26 && gem < 30 && kwart === 1 && half === 1;
    return { ok: ok, detail: 'gereden ' + gereden.toFixed(1) + ' km, gemiddeld ' + gem.toFixed(1) +
             ' km/u, "een kwart" ' + kwart + 'x, "halverwege" ' + half + 'x' };
  });

  await test('Zonder bereik maar één keer "van de route"', async () => {
    const t = trap([52.0, 5.0], 30, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    rijd(S.route, 0, 5000, 28);
    window.valhalla = async () => { throw new Error('geen bereik'); };
    const naast = punt(S.route, 5000); naast[1] += 0.0045;
    // 40 seconden naast de route: over de blokkade van 30 s heen
    for (let i = 0; i < 40; i++) { fix(naast, 5); await tik(); }
    const van = gezegd.filter(x => x.t.indexOf('van de route') >= 0).length;
    const geen = gezegd.filter(x => x.t.indexOf('Geen nieuwe route') === 0).length;
    return { ok: van === 1 && geen === 1,
             detail: '"van de route" ' + van + 'x, "geen nieuwe route" ' + geen + 'x in 40 s' };
  });

  await test('Route met 15 punten werkt en zegt maar één keer "aangekomen"', async () => {
    window.fetch = async (url, opt) => {
      if (String(url).indexOf('/route') >= 0) return nepRouteServer(opt);
      return echt.fetch(url, opt);
    };
    const wps = [];
    for (let i = 0; i < 15; i++) wps.push({ lat: 52.0 + i * 0.01, lon: 5.0 + (i % 2) * 0.01 });
    const r = await valhalla(wps, S.prof);
    const bestemming = r.man.filter(m => m.speak && ENDT.has(m.type)).length;
    const ok = r.wpAlong.length === 15 && bestemming === 1 && r.man.length > 0;
    return { ok: ok, detail: r.wpAlong.length + ' tussenpunten, ' + bestemming +
             'x "aangekomen" (moet 1 zijn)' };
  });

  await test('Rondje van 8 punten zegt niet halverwege "aangekomen"', async () => {
    window.fetch = async (url, opt) => {
      if (String(url).indexOf('/route') >= 0) return nepRouteServer(opt);
      return echt.fetch(url, opt);
    };
    const wps = [];
    for (let i = 0; i < 8; i++) wps.push({ lat: 52.0 + Math.sin(i) * 0.05, lon: 5.0 + Math.cos(i) * 0.05 });
    const r = await valhalla(wps, S.prof);
    const bestemming = r.man.filter(m => m.speak && ENDT.has(m.type)).length;
    return { ok: bestemming === 1, detail: bestemming + 'x "aangekomen" op 7 legs (was 7x)' };
  });

  await test('Gesplitste GPX komt heel terug en overleeft bewaren', async () => {
    const t = trap([52.0, 5.0], 40, 1500);
    let traces = 0;
    // Zoals de echte server op een lus van 44,9 km: op een lastige plek breekt de
    // match af. De trip stopt daar, en een "alternatief" begint drie punten
    // terug (overlap, geen gat). Vraag je opnieuw op vanaf die plek, dan gaat
    // het wel in een keer door.
    const lastig = t.pts[Math.floor(t.pts.length * 0.2)];
    window.fetch = async (url, opt) => {
      const u = String(url);
      if (u.indexOf('/trace_route') >= 0) {
        traces++;
        const vorm = JSON.parse(opt.body).shape.map(p => [p.lat, p.lon]);
        let k = 0, bd = Infinity;
        for (let i = 0; i < vorm.length; i++) {
          const d = hav(vorm[i], lastig);
          if (d < bd) { bd = d; k = i; }
        }
        if (k < 3 || bd > 150) return json({ trip: nepTrip(vorm, []) });
        const a = vorm.slice(0, k + 1), b = vorm.slice(k - 3);
        return json({ trip: nepTrip(a, []), alternates: [{ trip: nepTrip(b, []) }] });
      }
      if (u.indexOf('/route') >= 0) return nepRouteServer(opt);
      if (u.indexOf('/height') >= 0) return json({ range_height: [[0, 5], [10, 5]] });
      return echt.fetch(url, opt);
    };
    let gpx = '<?xml version="1.0"?><gpx><trk><trkseg>';
    for (const p of t.pts) gpx += '<trkpt lat="' + p[0] + '" lon="' + p[1] + '"></trkpt>';
    gpx += '</trkseg></trk></gpx>';
    let lijnLen = 0;
    for (let i = 1; i < t.pts.length; i++) lijnLen += hav(t.pts[i - 1], t.pts[i]);

    await importGPX(new File([gpx], 'test.gpx'));
    const ingeladen = S.route.len;
    // bewaren en weer openen, zoals een gebruiker doet
    const voor = S.saved.length;
    saveRoute();
    const opgeslagen = S.saved[0];
    S.line = opgeslagen.line ? decodePoly(opgeslagen.line, 5) : null;
    S.route = null;
    await doRefresh();
    const heropend = S.route ? S.route.len : 0;
    S.saved.splice(0, S.saved.length - voor);
    storeSaved(); renderSaved();
    const dekking = ingeladen / lijnLen, terug = heropend / ingeladen;
    const ok = dekking > 0.95 && terug > 0.98 && terug < 1.02 && !!opgeslagen.line;
    return { ok: ok, detail: 'ingeladen ' + (ingeladen / 1000).toFixed(1) + ' van ' +
             (lijnLen / 1000).toFixed(1) + ' km, heropend ' + (heropend / 1000).toFixed(1) +
             ' km, ' + traces + ' trace-aanroepen' };
  });

  await test('De 5 km-split telt een koffiestop niet mee', async () => {
    const t = trap([52.0, 5.0], 30, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    rijd(S.route, 0, 6000, 30);
    stilstaan(240, punt(S.route, 6000));              // vier minuten koffie
    rijd(S.route, 6000, 8000, 30);
    const sp = splitSpeed();
    const kmh = sp === null ? 0 : sp * 3.6;
    return { ok: kmh > 28 && kmh < 32, detail: 'split ' + kmh.toFixed(1) + ' km/u bij 30 km/u rijden' };
  });

  await test('Afslaginstructie komt ~7 seconden voor de bocht', async () => {
    const t = trap([52.0, 5.0], 20, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    const v = 28 / 3.6;
    const sec = [];
    Voice.say = txt => {
      if (!S.nav || txt.indexOf('Over ') === 0) return;
      if (txt !== 'Rechts afslaan.' && txt !== 'Links afslaan.') return;
      const volgende = S.route.man.find(m => m.speak && m.at - S.nav.along > -15);
      if (volgende) sec.push((volgende.at - S.nav.along) / v);
    };
    rijd(S.route, 0, S.route.len - 100, 28);
    Voice.say = t2 => gezegd.push({ t: t2 });
    sec.sort((a, b) => a - b);
    const med = sec.length ? sec[Math.floor(sec.length / 2)] : 0;
    return { ok: med > 6 && med < 8, detail: 'mediaan ' + med.toFixed(1) + ' s over ' + sec.length + ' bochten' };
  });

  await test('Na het stoppen zie je het ritoverzicht met de juiste cijfers', async () => {
    const t = trap([52.0, 5.0], 30, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    localStorage.removeItem('fietsnav.ritten');
    start();
    rijd(S.route, 0, 10000, 30);
    stilstaan(300, punt(S.route, 10000));             // vijf minuten pauze
    rijd(S.route, 10000, 20000, 30);
    // hoogte en weer ophalen hoort hier niet bij: geen netwerk in deze test
    window.fetch = async () => { throw new Error('geen netwerk in de test'); };
    echt.stopNav();                                   // de echte, niet de stille vervanger
    const open = $('#rit').classList.contains('on');
    const st = analyseRit(loadRides()[0]);
    sluitRit();
    // en later terug te vinden door op de rit in de lijst te tikken
    const regel = document.querySelector('#rideList .saved');
    if (regel) regel.click();
    const viaLijst = $('#rit').classList.contains('on');
    sluitRit();
    const km = st.afstand / 1000, gem = st.gem * 3.6, max = st.max * 3.6;
    const rijMin = st.rij / 60, totMin = st.sec / 60;
    const stukOk = st.stukken.length === 4 &&
                   st.stukken.every(s => s.v * 3.6 > 28 && s.v * 3.6 < 32);
    const ok = open && viaLijst && km > 19.5 && km < 20.5 && gem > 28.5 && gem < 31.5 &&
               max > 28.5 && max < 31.5 && rijMin > 38 && rijMin < 42 &&
               totMin > 43 && totMin < 47 && stukOk;
    return { ok: ok, detail: (open ? 'opent' : 'opent NIET') + ', ' +
             (viaLijst ? 'ook via de lijst' : 'NIET via de lijst') + ': ' + km.toFixed(1) +
             ' km, rijtijd ' + rijMin.toFixed(0) + ' min van ' + totMin.toFixed(0) +
             ', gemiddeld ' + gem.toFixed(1) + ', snelste ' + max.toFixed(1) + ' km/u, ' +
             st.stukken.length + ' stukken van 5 km' };
  });

  await test('Een onderbroken rit komt terug bij het openen', async () => {
    const t = trap([52.0, 5.0], 30, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    localStorage.removeItem('fietsnav.ritten');
    start();
    rijd(S.route, 0, 8000, 30);
    // hier sluit iOS de pagina: geen stopNav, alleen de tussentijdse opslag
    const lopend = !!localStorage.getItem('fietsnav.ritLopend');
    stop();
    const rit = herstelLopendeRit();
    const weg = !localStorage.getItem('fietsnav.ritLopend');
    const aantal = loadRides().length;
    const km = rit ? rit.km : 0;
    const ok = lopend && !!rit && weg && aantal === 1 && km > 7.5 && km < 8.1;
    return { ok: ok, detail: (rit ? 'teruggezet: ' + km.toFixed(1) + ' km van 8,0' : 'niet teruggezet') +
             (weg ? '' : ', tussenstand niet opgeruimd') };
  });

  /* ---------------- ritanalyse ----------------
     Nep-ritten rechtstreeks als spoor, zonder navigatie: een punt per 2 s, in
     rechte stukken noord, oost, zuid of west, met Doppler-snelheid. Hoogte en
     weer gaan er meteen in, zodat er geen netwerk nodig is. */
  function nepRit(delen, opt) {
    opt = opt || {};
    const tr = [];
    let lat = 52.0, lon = 5.0, t = 1790000000000, af = 0, rij = 0;
    const dLat = 1 / 111320;
    tr.push({ lat, lon, t, e: null, s: opt.zonderDoppler ? null : 0 });
    for (const d of delen) {
      if (d.stil) {
        for (let k = 0; k < d.stil / 2; k++) {
          t += 2000;
          tr.push({ lat, lon, t, e: null, s: opt.zonderDoppler ? null : 0 });
        }
        continue;
      }
      const v = d.kmh / 3.6, stap = v * 2;
      const dLon = 1 / (111320 * Math.cos(lat * Math.PI / 180));
      const richting = { N: [1, 0], Z: [-1, 0], O: [0, 1], W: [0, -1] }[d.richting];
      for (let k = 0; k < d.km * 1000 / stap; k++) {
        lat += richting[0] * stap * dLat; lon += richting[1] * stap * dLon;
        t += 2000; af += stap; rij += 2;
        tr.push({ lat, lon, t, e: null, s: opt.zonderDoppler ? null : v });
      }
    }
    const rit = { ts: tr[0].t, km: af / 1000, sec: (t - tr[0].t) / 1000, rij, p: packTrack(tr) };
    if (opt.dem) {
      // hoogte om de 50 m, op dezelfde afstandsmaat als analyseRit
      let cum = 0;
      const tr2 = unpackTrack(rit.p), c = [0];
      for (let i = 1; i < tr2.length; i++) { cum += hav([tr2[i-1].lat, tr2[i-1].lon], [tr2[i].lat, tr2[i].lon]); c.push(cum); }
      const h = [];
      for (let x = 0; x <= cum; x += 50) h.push(Math.round(opt.dem(x)));
      rit.dem = { stap: 50, h };
    }
    if (opt.weer) {
      rit.weer = [];
      for (let u = Math.floor(tr[0].t / 3600000) - 1; u <= Math.ceil(t / 3600000) + 1; u++) {
        rit.weer.push(Object.assign({ t: u * 3600 }, opt.weer));
      }
    }
    return rit;
  }
  const PROF = { kg: 75, fiets: 8, ftp: null, gezet: true };
  const WINDSTIL = { kmh: 0, from: 0, vlaag: 0, temp: 15, hpa: 1013 };
  const gemP = (a, van, tot) => {
    let s = 0, k = 0;
    for (let i = van; i < tot; i++) if (a.punten.beweegt[i]) { s += a.punten.P[i]; k++; }
    return k ? s / k : 0;
  };

  await test('Geschat vermogen op het vlak klopt met de natuurkunde', async () => {
    const a = analyseRit(nepRit([{ richting: 'O', km: 10, kmh: 30 }], { dem: () => 0, weer: WINDSTIL }), PROF);
    const w = a.vermogen ? a.vermogen.gem : 0;
    return { ok: w > 140 && w < 155, detail: Math.round(w) + ' W bij 30 km/u windstil, 75 + 8 kg (met de hand: 148 W)' };
  });

  await test('Klimdetectie vindt de heuvel en slaat viaducten over', async () => {
    const brug = (d, b) => d < b || d > b + 250 ? 0 : d < b + 100 ? (d - b) / 100 * 6
                          : d < b + 150 ? 6 : (b + 250 - d) / 100 * 6;
    const heuvel = d => {
      if (d >= 6000 && d < 8000) return (d - 6000) * 0.05;
      if (d >= 8000 && d < 8500) return 100;
      if (d >= 8500 && d < 10500) return 100 - (d - 8500) * 0.05;
      return brug(d, 4000) + brug(d, 11000);
    };
    const a = analyseRit(nepRit([{ richting: 'N', km: 12, kmh: 25 }], { dem: heuvel, weer: WINDSTIL }), PROF);
    const k = a.klimmen[0];
    const ok = a.klimmen.length === 1 && k.lengte >= 1900 && k.lengte <= 2100 &&
               k.gem >= 0.045 && k.gem <= 0.055 && k.stijg >= 95 && k.stijg <= 105;
    return { ok, detail: a.klimmen.length + ' klim(men)' + (k ? ': ' + (k.lengte / 1000).toFixed(2) + ' km, ' +
             (k.gem * 100).toFixed(1) + '% gemiddeld, ' + Math.round(k.stijg) + ' m, bij km ' + k.vanKm.toFixed(1) : '') };
  });

  await test('Tegenwind heen, meewind terug', async () => {
    const a = analyseRit(nepRit([{ richting: 'W', km: 10, kmh: 30 }, { richting: 'O', km: 10, kmh: 30 }],
                                { dem: () => 0, weer: { kmh: 20, from: 270, vlaag: 30, temp: 15, hpa: 1013 } }), PROF);
    const half = a.n >> 1, heen = gemP(a, 0, half), terug = gemP(a, half, a.n);
    const w = a.wind;
    const ok = !!w && w.deel.tegen > 0.45 && w.deel.mee > 0.45 && heen > terug + 50;
    return { ok, detail: w ? 'tegen ' + Math.round(w.deel.tegen * 100) + '%, mee ' + Math.round(w.deel.mee * 100) +
             '%; heen ' + Math.round(heen) + ' W, terug ' + Math.round(terug) + ' W bij dezelfde 30 km/u' : 'geen windinfo' };
  });

  await test('Beste 5 km en beste 20 minuten vallen op het snelle stuk', async () => {
    const a = analyseRit(nepRit([{ richting: 'N', km: 10, kmh: 27 }, { richting: 'N', km: 15, kmh: 36 },
                                 { richting: 'N', km: 10, kmh: 27 }], { dem: () => 0, weer: WINDSTIL }), PROF);
    const b5 = a.besteAfstand.find(b => b.m === 5000);
    const b20 = a.vermogen && a.vermogen.beste.find(b => b.sec === 1200);
    const ok = !!b5 && b5.vanKm >= 9.9 && b5.vanKm <= 20.1 && b5.m / b5.sec * 3.6 > 35 &&
               !!b20 && b20.vanKm >= 9.9 && b20.totKm <= 25.1;
    return { ok, detail: (b5 ? '5 km vanaf km ' + b5.vanKm.toFixed(1) + ' op ' + (b5.m / b5.sec * 3.6).toFixed(1) + ' km/u' : 'geen 5 km') +
             (b20 ? ', 20 min van km ' + b20.vanKm.toFixed(1) + ' tot ' + b20.totKm.toFixed(1) + ' (' + Math.round(b20.w) + ' W)' : ', geen 20 min') };
  });

  await test('Een stop van 3 minuten wordt gevonden', async () => {
    const a = analyseRit(nepRit([{ richting: 'N', km: 10, kmh: 30 }, { stil: 180 }, { richting: 'N', km: 10, kmh: 30 }],
                                { dem: () => 0, weer: WINDSTIL }), PROF);
    const s = a.stops[0];
    return { ok: a.stops.length === 1 && s.sec >= 170 && s.sec <= 190 && Math.abs(s.km - 10) < 0.2,
             detail: a.stops.length + ' stop(s)' + (s ? ', ' + Math.round(s.sec) + ' s bij km ' + s.km.toFixed(1) : '') };
  });

  await test('Oude rit zonder GPS-snelheid, hoogte en weer geeft toch een overzicht', async () => {
    const a = analyseRit(nepRit([{ richting: 'N', km: 8, kmh: 28 }], { zonderDoppler: true }), PROF);
    const ok = !a.doppler && !!a.vermogen && a.vermogen.gem > 50 && a.klim == null && a.wind == null &&
               a.stukken.length === 2 && Math.abs(a.gem * 3.6 - 28) < 1.5 && a.reeks.length > 10;
    return { ok, detail: 'gemiddeld ' + (a.gem * 3.6).toFixed(1) + ' km/u, vermogen ' +
             (a.vermogen ? Math.round(a.vermogen.gem) + ' W' : 'geen') + ', klim ' + a.klim + ', wind ' + a.wind };
  });

  await test('GPS-snelheid overleeft in- en uitpakken, oude ritten blijven leesbaar', async () => {
    const tr = [{ lat: 52, lon: 5, t: 1790000000000, e: 3, s: 8.33 },
                { lat: 52.0001, lon: 5.0001, t: 1790000002000, e: null, s: null },
                { lat: 52.0002, lon: 5.0002, t: 1790000004000, e: 4, s: 0 }];
    const terug = unpackTrack(packTrack(tr));
    const oud = unpackTrack([[5200000, 500000, 1790000000, 3], [10, 10, 2, '']]);
    const ok = Math.abs(terug[0].s - 8.3) < 0.051 && terug[1].s === null && terug[2].s === 0 &&
               terug[0].e === 3 && oud[0].s === null && oud[1].e === null && oud[1].s === null;
    return { ok, detail: 'snelheden terug: ' + terug.map(p => p.s).join(', ') + '; oud formaat: ' + oud.map(p => p.s).join(', ') };
  });

  /* ---------------- naar Garmin ----------------
     Leest een FIT-bestand terug zoals een Garmin dat doet: kop, controlesom,
     definities en data. Telt de berichten per soort en haalt de koerspunten eruit. */
  function leesFit(b) {
    const uit = { fout: null, aantal: {}, punten: [] };
    if (String.fromCharCode(b[8], b[9], b[10], b[11]) !== '.FIT') { uit.fout = 'geen .FIT in de kop'; return uit; }
    let c = 0;
    for (let i = 0; i < b.length; i++) c = fitCrc(c, b[i]);
    if (c !== 0) { uit.fout = 'controlesom klopt niet'; return uit; }
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const lengte = dv.getUint32(4, true);
    if (lengte !== b.length - 16) { uit.fout = 'datalengte klopt niet'; return uit; }
    const defs = {};
    let p = 14;
    while (p < 14 + lengte) {
      const kop = b[p++], lok = kop & 0x0F;
      if (kop & 0x40) {
        const nv = b[p + 4], velden = [];
        for (let i = 0; i < nv; i++) velden.push({ nr: b[p + 5 + i * 3], n: b[p + 6 + i * 3] });
        defs[lok] = { glob: dv.getUint16(p + 2, true), velden };
        p += 5 + nv * 3;
      } else {
        const d = defs[lok];
        if (!d) { uit.fout = 'data zonder definitie'; return uit; }
        uit.aantal[d.glob] = (uit.aantal[d.glob] || 0) + 1;
        const plek = {};
        for (const v of d.velden) { plek[v.nr] = { p, n: v.n }; p += v.n; }
        if (d.glob === 32) {
          let naam = '';
          for (let i = 0; i < plek[6].n && b[plek[6].p + i]; i++) naam += String.fromCharCode(b[plek[6].p + i]);
          uit.punten.push({ type: b[plek[5].p], afstand: dv.getUint32(plek[4].p, true) / 100, naam });
        }
      }
    }
    return uit;
  }

  await test('Naar Garmin: geldige FIT-koers met een koerspunt per afslag', async () => {
    const t = trap([52.0, 5.0], 20, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    const fit = maakFitKoers(S.route, 'Testkoers', 28, null);
    const r = leesFit(fit.bytes);
    const bochten = S.route.man.filter(m => m.type === 10 || m.type === 15).length;
    const eerste = r.punten[0], rechts = S.route.man.find(m => m.type === 10);
    const ok = !r.fout && r.aantal[32] === bochten && r.aantal[20] > 100 && r.aantal[31] === 1 &&
               r.aantal[19] === 1 && r.aantal[21] === 2 && !!eerste && eerste.type === 7 &&
               eerste.naam === 'Rechts' && Math.abs(eerste.afstand - rechts.at) < 1;
    return { ok, detail: r.fout || (r.aantal[32] + ' koerspunten voor ' + bochten + ' bochten, ' + r.aantal[20] +
             ' routepunten, eerste: ' + (eerste ? eerste.naam + ' (type ' + eerste.type + ') op ' + eerste.afstand.toFixed(0) + ' m' : 'geen')) };
  });

  await test('Naar Garmin: rotonde krijgt de richting van de uitrit', async () => {
    // 500 m naar het noorden, rotonde, dan 500 m naar het oosten: dat is rechtsaf
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push([52.0 + i * 25 / 111320, 5.0]);
    const hoek = pts.length - 1;
    for (let i = 1; i <= 20; i++) pts.push([pts[hoek][0], 5.0 + i * 25 / (111320 * Math.cos(52 * Math.PI / 180))]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    const route = { pts, cum, len: cum[cum.length - 1], man: [
      { type: 26, bi: hoek, at: cum[hoek], roundabout_exit_count: 2 },
      { type: 27, bi: hoek + 1, at: cum[hoek + 1] }] };
    const p = garminPunten(route);
    const ok = p.length === 1 && p[0].type === 7 && p[0].naam === 'Rotonde 2e afsl';
    return { ok, detail: p.length + ' punt(en)' + (p[0] ? ': ' + p[0].naam + ', type ' + p[0].type + ' (7 = rechts)' : '') };
  });

  /* ---------------- slot, stoppen en weg dicht ---------------- */
  const midden = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const schuif = frac => {
    const duim = $('#slotduim'), spoor = $('#slotspoor');
    const [x, y] = midden(duim), weg = (spoor.clientWidth - duim.offsetWidth - 10) * frac;
    duim.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 7, bubbles: true }));
    duim.dispatchEvent(new PointerEvent('pointermove', { clientX: x + weg, clientY: y, pointerId: 7, bubbles: true }));
    duim.dispatchEvent(new PointerEvent('pointerup', { clientX: x + weg, clientY: y, pointerId: 7, bubbles: true }));
  };

  await test('Slot vangt elke aanraking op en gaat alleen open met een volle schuif', async () => {
    const t = trap([52.0, 5.0], 10, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    zetSlot(true);
    // wat ligt er bovenop de stopknop en midden op de kaart?
    const opStop = document.elementFromPoint.apply(document, midden($('#bStop')));
    const opKaart = document.elementFromPoint(innerWidth / 2, innerHeight / 3);
    const gevangen = !!opStop && !!opKaart && $('#slot').contains(opStop) && $('#slot').contains(opKaart);
    schuif(0.5);
    const halfDicht = document.body.classList.contains('op-slot');
    schuif(1);
    const open = !document.body.classList.contains('op-slot');
    const ok = gevangen && halfDicht && open && !!S.nav;
    return { ok, detail: (gevangen ? 'aanrakingen gevangen' : 'aanraking komt erdoor') + ', halve schuif ' +
             (halfDicht ? 'blijft dicht' : 'opent al') + ', volle schuif ' + (open ? 'opent' : 'opent niet') };
  });

  await test('Stop vraagt eerst om bevestiging', async () => {
    const t = trap([52.0, 5.0], 10, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    let gestopt = 0;
    window.stopNav = () => { gestopt++; };
    $('#bStop').click();
    const vraag = document.body.classList.contains('stopvraag') && gestopt === 0;
    $('#stopNee').click();
    const door = !document.body.classList.contains('stopvraag') && gestopt === 0;
    $('#bStop').click(); $('#stopJa').click();
    window.stopNav = function () {};
    const ok = vraag && door && gestopt === 1;
    return { ok, detail: (vraag ? 'vraagt eerst' : 'stopt meteen') + ', doorgaan ' + (door ? 'werkt' : 'werkt niet') +
             ', bevestigen stopt ' + gestopt + 'x' };
  });

  await test('Weg dicht: omweg om de weg voor je, en ook bij het plannen', async () => {
    localStorage.removeItem('fietsnav.dicht');
    const t = trap([52.0, 5.0], 10, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    rijd(S.route, 0, 3000, 28);                       // 600 m voor de derde bocht op 3600 m
    let verzoek = null;
    window.fetch = async (url, opt) => {
      if (String(url).indexOf('/route') >= 0) { verzoek = JSON.parse(opt.body); return nepRouteServer(opt); }
      if (String(url).indexOf('/height') >= 0) return json({ range_height: [[0, 5], [10, 5]] });
      return echt.fetch(url, opt);
    };
    const oud = S.route, along = S.nav.along;
    wegDicht();
    for (let i = 0; i < 6; i++) await tik();
    const uit = verzoek && verzoek.exclude_locations || [];
    // de punten moeten 35 en 70 m voor je op de oude route liggen
    const afst = uit.map(p => { let best = 1e9, k = 0;
      for (let i = 0; i < oud.pts.length; i++) { const d = hav(oud.pts[i], [p.lat, p.lon]); if (d < best) { best = d; k = i; } }
      return Math.round(oud.cum[k] - along); });
    const omweg = S.route !== oud && gezegd.some(x => x.t.indexOf('Afsluiting genoteerd') === 0) &&
                  !gezegd.some(x => x.t.indexOf('van de route') >= 0);
    const bewaard = afsluitingen().length === 1;
    const plan = profileBody([{ lat: 52.0, lon: 5.0 }, { lat: 52.05, lon: 5.0 }], S.prof).exclude_locations || [];
    const ver = profileBody([{ lat: 53.0, lon: 6.0 }, { lat: 53.05, lon: 6.0 }], S.prof).exclude_locations;
    localStorage.removeItem('fietsnav.dicht'); renderAfsluitingen();
    const ok = uit.length === 2 && afst[0] >= 25 && afst[0] <= 45 && afst[1] >= 60 && afst[1] <= 80 &&
               omweg && bewaard && plan.length === 2 && !ver;
    return { ok, detail: uit.length + ' punten uitgesloten op ' + afst.join(' en ') + ' m voor je, ' +
             (omweg ? 'omweg berekend' : 'geen omweg') + ', ' + (bewaard ? 'bewaard' : 'niet bewaard') +
             ', bij plannen ' + plan.length + ' punten, ver weg ' + (ver ? ver.length : 0) };
  });

  await test('Weg dicht: niet eindeloos vaak, en vraagt bij een tweede melding', async () => {
    localStorage.removeItem('fietsnav.dicht');
    const t = trap([52.0, 5.0], 10, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    rijd(S.route, 0, 3000, 28);
    const echtReroute = window.reroute, echtConfirm = window.confirm;
    let omwegen = 0, vragen = 0, antwoord = false;
    window.reroute = () => { omwegen++; };
    window.confirm = () => { vragen++; return antwoord; };
    try {
      wegDicht();                                     // eerste melding: telt
      wegDicht();                                     // zelfde plek: staat al dicht
      const naDubbel = afsluitingen().length;
      S.nav.along += 400;                             // een andere weg, maar je hebt niet gereden
      wegDicht();                                     // vraagt, antwoord nee
      const naNee = afsluitingen().length;
      antwoord = true;
      wegDicht();                                     // vraagt, antwoord ja
      const naJa = afsluitingen().length;
      // nooit meer dan 20 bewaren
      const veel = [];
      for (let i = 0; i < 25; i++) veel.push({ punten: [[52.1 + i * 0.01, 5.1]], ts: Date.now() });
      bewaarAfsluitingen(veel.slice(-20));
      const ok = naDubbel === 1 && naNee === 1 && naJa === 2 && vragen === 2 && omwegen === 2 &&
                 afsluitingen().length === 20;
      return { ok, detail: 'na dubbele tik ' + naDubbel + ', na nee ' + naNee + ', na ja ' + naJa +
               ', ' + vragen + 'x gevraagd, ' + omwegen + ' omwegen' };
    } finally {
      window.reroute = echtReroute; window.confirm = echtConfirm;
      localStorage.removeItem('fietsnav.dicht'); renderAfsluitingen();
    }
  });

  /* ---------------- rondjes zonder heen en weer ---------------- */
  // Rechte lijn noord met optioneel een uitstapje oost en terug halverwege
  function lijnRoute(metUitstapje) {
    const dLat = 25 / 111320, dLon = 25 / (111320 * Math.cos(52 * Math.PI / 180));
    const pts = [[52.0, 5.0]];
    const zet = (dy, dx, k) => { for (let i = 0; i < k; i++) { const p = pts[pts.length - 1]; pts.push([p[0] + dy * dLat, p[1] + dx * dLon]); } };
    zet(1, 0, 80);                                    // 2 km noord
    const voet = pts.length - 1;
    let top = voet;
    if (metUitstapje) { zet(0, 1, 12); top = pts.length - 1; zet(0, -1, 12); }   // 300 m oost en terug
    zet(1, 0, 80);                                    // 2 km noord
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    return { pts, cum, len: cum[cum.length - 1], man: [], voet, top,
             wpAlong: [0, cum[top], cum[cum.length - 1]] };
  }

  await test('Heen en weer naar een keerpunt wordt gezien', async () => {
    const zonder = keerFractie(lijnRoute(false)), met = lijnRoute(true), k = keerFractie(met);
    const verwacht = 600 / met.len;
    const ok = zonder < 0.005 && Math.abs(k - verwacht) < 0.03 && overlapFraction(met) < 0.01;
    return { ok, detail: 'zonder uitstapje ' + (zonder * 100).toFixed(1) + '%, met ' + (k * 100).toFixed(1) +
             '% (verwacht ' + (verwacht * 100).toFixed(1) + '%); de oude maat zag ' + (overlapFraction(met) * 100).toFixed(1) + '%' };
  });

  await test('Keerpunt op een doodlopend stuk gaat terug naar de kruising', async () => {
    const r = lijnRoute(true);
    const wps = [{ lat: r.pts[0][0], lon: r.pts[0][1] }, { lat: r.pts[r.top][0], lon: r.pts[r.top][1] },
                 { lat: r.pts[r.pts.length - 1][0], lon: r.pts[r.pts.length - 1][1] }];
    const nieuw = zonderUitstapjes(r, wps);
    const afstand = nieuw ? hav([nieuw[1].lat, nieuw[1].lon], r.pts[r.voet]) : -1;
    const geenWerk = zonderUitstapjes(lijnRoute(false), [wps[0], { lat: r.pts[40][0], lon: r.pts[40][1] }, wps[2]]);
    const ok = !!nieuw && afstand >= 0 && afstand < 45 && nieuw[0] === wps[0] && nieuw[2] === wps[2] && geenWerk === null;
    return { ok, detail: nieuw ? 'keerpunt verplaatst naar ' + Math.round(afstand) + ' m van de kruising' +
             (geenWerk === null ? ', doorgaande weg ongemoeid' : ', ook doorgaande weg verplaatst') : 'niet verplaatst' };
  });

  /* ---------------- rondjes buiten de stad ---------------- */
  await test('Bebouwing midden in de rit telt, de stad uit bij de start niet', async () => {
    // 2 km stad uit, 3 km polder, 1,5 km dorp, 4 km polder, 2 km stad in
    const vakken = [[12, 1], [11, 1], [4, 1.5], [3, 1.5], [10, 0.75], [9, 0.75], [3, 2], [4, 2], [11, 1], [12, 1]];
    const km = vakken.reduce((s, v) => s + v[1], 0);
    const route = { len: km * 1000 };
    const st = stadsStukken(route, { vakken, km });
    const ok = st.length === 1 && Math.abs(st[0].van - 5000) < 1 && Math.abs(st[0].tot - 6500) < 1;
    // en een rondje met evenveel van alles maar meer stad scoort lager
    const r = lijnRoute(false); r.man = [];
    const basis = { dichtheid: 5, kruisPerKm: 10, glad: 0.8, onverhard: 0, obstakels: 0, druk: 0 };
    const weinig = rateRoute(r, Object.assign({ stad: 0.1 }, basis)).score;
    const veel = rateRoute(r, Object.assign({ stad: 0.4 }, basis)).score;
    return { ok: ok && veel < weinig - 0.2, detail: st.length + ' stuk(ken)' +
             (st[0] ? ' van ' + st[0].van + ' tot ' + st[0].tot + ' m' : '') +
             '; score bij 10% stad ' + weinig.toFixed(2) + ', bij 40% ' + veel.toFixed(2) };
  });

  await test('Om een dorp heen: alleen de keerpunten rond het dorp gaan opzij', async () => {
    // vierkant rondje van 3 x 3 km met een dorp halverwege de oostkant
    const dLat = 1 / 111.32, dLon = 1 / (111.32 * Math.cos(52 * Math.PI / 180));
    const hoek = [[52, 5], [52, 5 + 3 * dLon], [52 + 3 * dLat, 5 + 3 * dLon], [52 + 3 * dLat, 5], [52, 5]];
    const pts = [], wpIdx = [0];
    for (let h = 0; h < 4; h++) {
      for (let k = (h ? 1 : 0); k <= 30; k++) {
        pts.push([hoek[h][0] + (hoek[h + 1][0] - hoek[h][0]) * k / 30, hoek[h][1] + (hoek[h + 1][1] - hoek[h][1]) * k / 30]);
      }
      wpIdx.push(pts.length - 1);
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
    const route = { pts, cum, len: cum[cum.length - 1], wpAlong: wpIdx.map(i => cum[i]) };
    const wps = wpIdx.map(i => ({ lat: pts[i][0], lon: pts[i][1] }));
    const v = omBebouwingHeen(route, wps, { van: 3800, tot: 5200 });   // midden oostkant
    const verplaatst = v.map(w => w.map((p, i) => Math.round(hav([p.lat, p.lon], [wps[i].lat, wps[i].lon]))));
    // de twee hoekpunten aan de oostkant (1 en 2) gaan 1,7 km opzij, start en eind blijven staan
    const ok = v.length === 2 && verplaatst.every(m => m[0] === 0 && m[4] === 0 && m[3] === 0 &&
               Math.abs(m[1] - 1680) < 30 && Math.abs(m[2] - 1680) < 30) &&
               v[0][1].lon > wps[1].lon && v[1][1].lon < wps[1].lon;
    return { ok, detail: 'verplaatsing per punt: buitenom ' + verplaatst[0].join('/') + ' m, binnendoor ' +
             verplaatst[1].join('/') + ' m' };
  });

  /* ---------------- scherm op slot met de zijknop ---------------- */
  await test('Scherm op slot: afstand, tijd en plek worden na het ontgrendelen opgepakt', async () => {
    const t = trap([52.0, 5.0], 30, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    rijd(S.route, 0, 5000, 30);
    const voorR = S.nav.ridden, voorT = S.nav.rijtijd, voorZeg = gezegd.length;
    naSlot(300000);                                   // vijf minuten op slot
    klok += 300000;
    rijd(S.route, 7500, 7600, 30);                    // 2,5 km verder weer fixes
    const na = gezegd.slice(voorZeg).map(x => x.t);
    const erbij = (S.nav.ridden - voorR) / 1000, tijd = (S.nav.rijtijd - voorT) / 1000;
    const bochten = na.filter(x => x === 'Rechts afslaan.' || x === 'Links afslaan.').length;
    const ok = Math.abs(S.nav.along - 7600) < 60 && erbij > 1.5 && erbij < 2.7 && tijd > 295 && tijd < 320 &&
               !na.some(x => x.indexOf('van de route') >= 0) && na.indexOf('Navigatie loopt weer.') >= 0 && bochten === 0;
    return { ok, detail: 'plek op de route ' + Math.round(S.nav.along) + ' m (moet ~7600), gereden +' + erbij.toFixed(2) +
             ' km, rijtijd +' + Math.round(tijd) + ' s, gemiste bochten nagezegd: ' + bochten };
  });

  await test('Na een herstart verder met dezelfde route en doorlopende cijfers', async () => {
    const t = trap([52.0, 5.0], 30, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    localStorage.removeItem('fietsnav.ritten');
    start();
    rijd(S.route, 0, 8000, 30);
    const kmVoor = S.nav.ridden / 1000;
    stop();                                           // de pagina gaat dood: geen stopNav
    klok += 120000;                                   // twee minuten later weer open
    const h = hervatbareRit();
    if (!h) return { ok: false, detail: 'niets te hervatten gevonden' };
    gezegd = [];
    hervatRit(h);
    rijd(S.route, 9000, 12000, 30);
    const n = S.nav, km = n.ridden / 1000;
    const kwart = gezegd.filter(x => x.t.indexOf('Een kwart') === 0).length;
    const ok = Math.abs(n.along - 12000) < 60 && km > kmVoor + 3.5 && km < kmVoor + 4.2 &&
               n.track.length > h.tr.length && gezegd.some(x => x.t.indexOf('Rit hervat') === 0) &&
               !gezegd.some(x => x.t.indexOf('Route van') === 0) && kwart === 0 && loadRides().length === 0;
    return { ok, detail: 'voor ' + kmVoor.toFixed(1) + ' km, na hervatten ' + km.toFixed(1) + ' km, plek ' +
             Math.round(n.along) + ' m, spoor ' + h.tr.length + ' -> ' + n.track.length + ' punten, "een kwart" opnieuw: ' + kwart };
  });

  /* ---------------- vrije rit ---------------- */
  // een baan om over te rijden, zonder dat de app een route heeft
  function baan(km) {
    const t = trap([52.0, 5.0], km, 1200), cum = [0];
    for (let i = 1; i < t.pts.length; i++) cum.push(cum[i - 1] + hav(t.pts[i - 1], t.pts[i]));
    return { pts: t.pts, cum };
  }

  await test('Vrije rit: zonder route bijhouden, elke 5 km een tempomelding', async () => {
    localStorage.removeItem('fietsnav.ritten');
    S.route = null; S.wps = []; S.line = null;
    gezegd = [];
    startVrij();
    if (!S.nav || !S.nav.vrij) return { ok: false, detail: 'vrije rit start niet' };
    const b = baan(12);
    rijd(b, 0, 11000, 30);
    const km = S.nav.ridden / 1000;
    const vijf = gezegd.filter(x => x.t.indexOf('5 kilometer.') === 0);
    const tien = gezegd.filter(x => x.t.indexOf('10 kilometer.') === 0);
    const tempo = vijf[0] ? vijf[0].t : '';
    const geenRoute = !gezegd.some(x => /van de route|Route van|afslaan/.test(x.t));
    const banner = $('#banstreet').textContent === 'Vrije rit' && document.body.classList.contains('vrij');
    // stoppen met de echte stopNav: het overzicht moet openen, zonder netwerk
    window.fetch = async () => { throw new Error('geen netwerk in de test'); };
    echt.stopNav();
    const open = $('#rit').classList.contains('on');
    const rit = loadRides()[0];
    sluitRit();
    const ok = km > 10.9 && km < 11.1 && vijf.length === 1 && tien.length === 1 && /2[89],|30,|31,/.test(tempo) &&
               geenRoute && banner && open && !!rit && rit.vrij === true && rit.klim == null && rit.fiets === S.prof.type;
    return { ok, detail: km.toFixed(2) + ' km bijgehouden; meldingen: "' + tempo + '", 10 km ' + tien.length + 'x; ' +
             (geenRoute ? 'geen routemeldingen' : 'WEL routemeldingen') + '; overzicht ' + (open ? 'open' : 'NIET open') +
             '; rit vrij=' + (rit && rit.vrij) + ', klim=' + (rit && rit.klim) };
  });

  await test('Vrije rit hervatten na een herstart', async () => {
    S.route = null; S.wps = []; S.line = null;
    startVrij();
    const b = baan(8);
    rijd(b, 0, 4000, 30);
    stop();                                           // pagina dood
    klok += 60000;
    const h = hervatbareRit();
    if (!h || !h.nav.vrij) return { ok: false, detail: 'geen vrije rit om te hervatten' };
    const kmVoor = h.lopend.km;
    hervatRit(h);
    rijd(b, 4600, 7000, 30);
    const ok = !!S.nav && S.nav.vrij && S.nav.ridden / 1000 > kmVoor + 2.6 && S.nav.ridden / 1000 < kmVoor + 3.2;
    return { ok, detail: 'voor ' + kmVoor.toFixed(1) + ' km, na hervatten ' + (S.nav ? (S.nav.ridden / 1000).toFixed(1) : '-') + ' km' };
  });

  /* ---------------- racefiets, gravel, mountainbike ---------------- */
  await test('Fietstype: routeverzoek, rondjesweging en vermogen per fiets', async () => {
    const twee = [{ lat: 52, lon: 5 }, { lat: 52.01, lon: 5 }];
    const fiets = t => profileBody(twee, Object.assign({}, S.prof, { type: t, ab: FIETSEN[t].ab, ur: FIETSEN[t].ur }))
                         .costing_options.bicycle;
    const verzoek = ['road', 'gravel', 'mtb'].map(t => fiets(t).bicycle_type + '/' + fiets(t).avoid_bad_surfaces).join(' ');
    const r = lijnRoute(false);
    const sc = (type, onv) => rateRoute(r, { dichtheid: 5, kruisPerKm: 10, glad: 0.6, onverhard: onv,
                                            obstakels: 0, stad: 0, druk: 0 }, type).score;
    const weging = sc('road', 0) > sc('road', 0.4) && sc('gravel', 0.4) > sc('gravel', 0) &&
                   sc('gravel', 0.4) > sc('gravel', 0.9) && sc('mtb', 0.8) > sc('mtb', 0.2);
    // 25 km/u windstil op het vlak, 75 + 8 kg: met de hand 94 W (racefiets) en 159 W (mountainbike)
    const rit = nepRit([{ richting: 'O', km: 8, kmh: 25 }], { dem: () => 0, weer: WINDSTIL });
    const w = t => analyseRit(Object.assign({}, rit, { fiets: t }), PROF).vermogen.gem;
    const wr = w('road'), wg = w('gravel'), wm = w('mtb');
    const ok = verzoek === 'Road/1 Cross/0 Mountain/0' && weging && wr > 88 && wr < 100 && wm > 150 && wm < 168 && wg > wr && wg < wm;
    return { ok, detail: 'verzoek ' + verzoek + '; weging ' + (weging ? 'klopt' : 'KLOPT NIET') + '; vermogen ' +
             Math.round(wr) + ' / ' + Math.round(wg) + ' / ' + Math.round(wm) + ' W (race/gravel/mtb)' };
  });

  await test('Fietskeuze en snelheid per type blijven bewaard', async () => {
    localStorage.removeItem('fietsnav.fiets');
    zetFiets('gravel', true);
    const gravelStd = S.prof.spd;
    S.prof.spd = 22; bewaarFiets();
    zetFiets('road', true);
    const road = S.prof.spd;
    zetFiets('gravel', true);
    const gravelTerug = S.prof.spd;
    S.prof.type = 'road';                            // alsof de app opnieuw opent
    laadFiets();
    const ok = gravelStd === 24 && road === 28 && gravelTerug === 22 && S.prof.type === 'gravel' &&
               S.prof.ab === 0 && document.querySelector('#fietsKeus .chip.on').dataset.f === 'gravel';
    return { ok, detail: 'gravel standaard ' + gravelStd + ', racefiets ' + road + ', gravel terug ' + gravelTerug +
             ', na herladen ' + S.prof.type };
  });

  /* ---------------- ontwerp Zachte Waaier (versie 16) ---------------- */
  await test('Meekijkcamera: pijl op de weg, kijkt de bocht in, na stoppen weer recht', async () => {
    for (let i = 0; i < 50 && !mapReady; i++) await wacht(200);
    if (!mapReady) return { ok: false, detail: 'kaart laadde niet' };
    // eerst 1200 m naar het noorden, dan een bocht naar het oosten
    const t = trap([52.0, 5.0], 10, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    rijd(S.route, 0, 1100, 28);
    const st = mijnStand(S.nav.lastPos);
    const opWeg = hav(st.pos, routePunt(S.route, S.nav.along)) < 1;
    const recht = camDoelKoers(S.nav, st);
    rijd(S.route, 1100, 1186, 28);                     // 15 m voor de bocht
    const inBocht = camDoelKoers(S.nav, mijnStand(S.nav.lastPos));
    const pad = camPadding().top;
    // Centreren, en dan echt een paar frames tekenen: eerder crashte elke frame
    let centreren = 'goed';
    try {
      S.follow = false; $('#bRecenter').click();
      for (let i = 0; i < 4; i++) { map._render(performance.now()); await wacht(60); }
      if (!S.follow) centreren = 'volgt niet';
    } catch (e) { centreren = 'crash: ' + e.message; }
    // alsof hij midden in de rit gekanteld en verschoven staat, dan stoppen
    map.jumpTo({ pitch: 62, bearing: 40 }); map.setPadding({ top: pad, bottom: 0, left: 0, right: 0 });
    window.fetch = async () => { throw new Error('geen netwerk in de test'); };
    echt.stopNav();
    const na = { pitch: map.getPitch(), bearing: map.getBearing(), top: map.getPadding().top };
    sluitRit();
    const hoek = d => Math.min(d, 360 - d);
    const ok = opWeg && hoek(recht) < 3 && inBocht > 20 && inBocht < 85 && pad > 100 &&
               na.pitch === 0 && na.bearing === 0 && na.top === 0 && centreren === 'goed';
    return { ok, detail: 'centreren ' + centreren + '; pijl ' + (opWeg ? 'op de weg' : 'NIET op de weg') + '; kijkt ' + Math.round(recht) +
             ' graden op het rechte stuk, ' + Math.round(inBocht) + ' graden 15 m voor de bocht; jij ' + pad +
             ' px omlaag; na stoppen kanteling ' + na.pitch + ', draaiing ' + na.bearing + ', verschuiving ' + na.top };
  });

  await test('Weergave: compact en glas zelf te kiezen, compact geeft meer kaart', async () => {
    const t = trap([52.0, 5.0], 10, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    rijd(S.route, 0, 500, 28);
    const kies = (seg, v) => document.querySelector(seg + ' [data-v="' + v + '"]').click();
    const zicht = () => $('#ridebar').getBoundingClientRect().top - $('#banner').getBoundingClientRect().bottom;
    const filter = () => { const cs = getComputedStyle($('#ridebar')); return cs.backdropFilter || cs.webkitBackdropFilter || ''; };
    kies('#iBalken', 'groot'); kies('#iStijl', 'dicht');
    const groot = zicht(), dicht = filter();
    kies('#iBalken', 'compact'); kies('#iStijl', 'glas');
    const compact = zicht(), glas = filter();
    const html = document.documentElement.getAttribute('data-balken') + '/' + document.documentElement.getAttribute('data-stijl');
    const bewaard = Inst.get('balken') + '/' + Inst.get('stijl');
    // een nieuwe rit zet de klassen van body opnieuw; de keuze moet blijven
    stop(); start();
    const blijft = document.documentElement.getAttribute('data-balken') === 'compact';
    kies('#iBalken', 'groot'); kies('#iStijl', 'dicht');
    const ok = compact > groot * 1.25 && /blur/.test(glas) && !/blur/.test(dicht) && html === 'compact/glas' &&
               bewaard === 'compact/glas' && blijft;
    return { ok, detail: 'vrij zicht groot ' + Math.round(groot) + ' px, compact ' + Math.round(compact) + ' px; glas "' +
             glas + '"; bewaard ' + bewaard + '; na nieuwe rit ' + (blijft ? 'nog compact' : 'TERUG naar groot') };
  });

  await test('Thema: zon op en onder in Delft, automatisch licht en donker', async () => {
    const was = klok;
    const uur = t => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60; };
    const zomer = kwZon(52.01, 4.36, new Date(2026, 5, 21)), winter = kwZon(52.01, 4.36, new Date(2026, 11, 21));
    // Delft: 21 juni rond 05:21 en 22:06, 21 december rond 08:47 en 16:31 (op tien minuten)
    const tijden = Math.abs(uur(zomer.op) - 5.35) < 0.17 && Math.abs(uur(zomer.onder) - 22.1) < 0.17 &&
                   Math.abs(uur(winter.op) - 8.78) < 0.17 && Math.abs(uur(winter.onder) - 16.52) < 0.17;
    localStorage.setItem('fietsnav.thema', 'auto');
    localStorage.setItem('fietsnav.plek', '[52.01,4.36]');
    klok = new Date(2026, 5, 21, 13, 0).getTime(); const middag = kwThema();
    klok = new Date(2026, 5, 21, 23, 30).getTime(); const nacht = kwThema();
    klok = new Date(2026, 11, 21, 17, 0).getTime(); const winterAvond = kwThema();
    localStorage.setItem('fietsnav.thema', 'donker');
    klok = new Date(2026, 5, 21, 13, 0).getTime(); const vast = kwThema();
    klok = was;
    const ok = tijden && middag === 'licht' && nacht === 'donker' && winterAvond === 'donker' && vast === 'donker';
    const hm = t => new Date(t).toTimeString().slice(0, 5);
    return { ok, detail: 'juni ' + hm(zomer.op) + '-' + hm(zomer.onder) + ', december ' + hm(winter.op) + '-' +
             hm(winter.onder) + '; middag ' + middag + ', nacht ' + nacht + ', winteravond ' + winterAvond + ', vast donker ' + vast };
  });

  await test('Aankondigen: vroeg en laat schuiven de 7 seconden mee', async () => {
    const sec = (stand, kmh) => { Inst.set('aank', stand); const d = tierDistances(kmh); return d; };
    const v = 35 / 3.6;
    const n = sec('normaal', 35), vr = sec('vroeg', 35), l = sec('laat', 35);
    Inst.set('aank', 'normaal');
    const ok = Math.abs(n.pre / v - 7) < 0.1 && Math.abs(vr.pre / v - 9.8) < 0.2 && Math.abs(l.pre / v - 5.25) < 0.2 &&
               n.now === vr.now && vr.alert > n.alert;
    return { ok, detail: 'bij 35 km/u: vroeg ' + (vr.pre / v).toFixed(1) + ' s, normaal ' + (n.pre / v).toFixed(1) +
             ' s, laat ' + (l.pre / v).toFixed(1) + ' s voor de bocht' };
  });

  await test('Automatisch pauzeren na 8 s stil, Hervat, en uit te zetten', async () => {
    const t = trap([52.0, 5.0], 10, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    Inst.set('autoPauze', true);
    start();
    rijd(S.route, 0, 2000, 28);
    const pos = punt(S.route, 2000);
    stilstaan(5, pos);
    const na5 = !!S.nav.pauze;
    stilstaan(5, pos);
    const na10 = !!S.nav.pauze && document.body.classList.contains('pauze') && $('#bandist').textContent === 'Gepauzeerd';
    rijd(S.route, 2000, 2300, 28);
    const door = !S.nav.pauze && !document.body.classList.contains('pauze');
    // met de hand hervat terwijl je nog stilstaat: niet meteen weer pauzeren
    const pos2 = punt(S.route, 2300);
    stilstaan(10, pos2);
    const weer = !!S.nav.pauze;
    $('#bHervat').click();
    stilstaan(12, pos2);
    const blijft = !S.nav.pauze;
    Inst.set('autoPauze', false);
    rijd(S.route, 2300, 2600, 28);
    stilstaan(15, punt(S.route, 2600));
    const uit = !S.nav.pauze;
    Inst.set('autoPauze', true);
    const ok = !na5 && na10 && door && weer && blijft && uit;
    return { ok, detail: 'na 5 s ' + (na5 ? 'al' : 'nog niet') + ', na 10 s ' + (na10 ? 'gepauzeerd' : 'NIET') +
             '; wegrijden ' + (door ? 'hervat' : 'NIET hervat') + '; Hervat-knop ' + (blijft ? 'houdt' : 'houdt NIET') +
             '; uitgezet ' + (uit ? 'geen pauze' : 'toch pauze') };
  });

  await test('Geen GPS-signaal na 12 s zonder fix, weg bij de volgende fix', async () => {
    const t = trap([52.0, 5.0], 10, 1200);
    zetRoute(nepTrip(t.pts, t.bochten));
    start();
    rijd(S.route, 0, 1000, 28);
    const voor = document.body.classList.contains('geengps');
    klok += 20000;
    await wacht(1150);                                  // de waakhond tikt elke seconde
    const zonder = document.body.classList.contains('geengps') && $('#bandist').textContent === 'Geen GPS-signaal' &&
                   $('#rSpd').textContent === '–,–';
    rijd(S.route, 1000, 1100, 28);
    const terug = !document.body.classList.contains('geengps') && $('#bandist').textContent !== 'Geen GPS-signaal';
    const ok = !voor && zonder && terug;
    return { ok, detail: 'na 20 s ' + (zonder ? 'melding' : 'GEEN melding') + ' (' + $('#banstreet').textContent + '); ' +
             (terug ? 'weg na de fix' : 'blijft staan na de fix') };
  });

  await test('Ritoverzicht: windzin, per 10 km, verwacht en wind in Beaufort', async () => {
    // 25 km naar het oosten met westenwind in de rug (de eerste 10 het hardst),
    // dan 25 km terug ertegenin
    const rit = nepRit([{ richting: 'O', km: 10, kmh: 33 }, { richting: 'O', km: 15, kmh: 31 },
                        { richting: 'W', km: 25, kmh: 26 }],
                       { weer: { kmh: 20, from: 270, vlaag: 30, temp: 12, hpa: 1013 } });
    rit.naam = 'Testrondje'; rit.routeKm = 50; rit.verwacht = rit.rij + 120;
    window.fetch = async () => { throw new Error('geen netwerk in de test'); };
    toonRit(rit, false, true);
    zetRitKleur('w');
    const zin = $('#ritZin').textContent;
    const stukken = $('#ritStukken').querySelectorAll('div').length;
    const snelste = $('#ritSnelste').textContent, top = $('#ritStukken .top small');
    const verw = $('#ritVerwacht').textContent, wind = $('#ritWindKort').textContent, naam = $('#ritDatum').textContent;
    const balken = $('#ritBalken').querySelectorAll('rect').length;
    sluitRit();
    const ok = /^West 4: in de rug tot km 2[456], daarna tegen/.test(zin) && stukken === 5 &&
               /met de wind in de rug/.test(snelste) && top && /km 0/.test(top.textContent) &&
               verw === '2 minuten eerder binnen dan verwacht' && wind === 'W 4' && naam === 'Testrondje' && balken > 90;
    return { ok, detail: '"' + zin + '" | ' + stukken + ' stukken, "' + snelste + '" | "' + verw + '" | wind ' + wind +
             ' | ' + balken + ' staafjes' };
  });

  await test('Bewaar rit: het spoor wordt een route bij Bewaarde routes', async () => {
    const rit = nepRit([{ richting: 'O', km: 6, kmh: 28 }, { richting: 'N', km: 4, kmh: 28 }], {});
    rit.naam = 'Testrondje';
    const voor = S.saved.length;
    const a = analyseRit(rit, PROF);
    const eerst = bewaarRitAlsRoute(rit, a);
    const nieuw = S.saved[0];
    const nogEens = bewaarRitAlsRoute(rit, a);
    const lijn = decodePoly(nieuw.line, 5);
    const ok = eerst && !nogEens && S.saved.length === voor + 1 && nieuw.naam === 'Testrondje' &&
               Math.abs(nieuw.km - 10) < 0.15 && nieuw.wps.length >= 3 && lijn.length > 50 && nieuw.vanRit === rit.ts;
    if (nieuw && nieuw.vanRit === rit.ts) { S.saved.shift(); storeSaved(); renderSaved(); }
    return { ok, detail: (eerst ? 'bewaard' : 'NIET bewaard') + ' als "' + (nieuw && nieuw.naam) + '", ' +
             (nieuw ? nieuw.km.toFixed(2) : '-') + ' km, ' + (nieuw ? nieuw.wps.length : 0) + ' tussenpunten, ' +
             lijn.length + ' lijnpunten; tweede keer ' + (nogEens ? 'WEER bewaard' : 'geweigerd') };
  });

  await test('Zoeken: alleen plaatsen en straten, getypte deel vet, dubbele stukken weg', async () => {
    let gevraagd = '';
    const f = (name, key, value, type, extra, lon) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, 51.98] },
      properties: Object.assign({ name, osm_key: key, osm_value: value, type }, extra) });
    window.fetch = async url => {
      gevraagd = String(url);
      return json({ features: [f('Maasland', 'place', 'village', 'city', { state: 'Zuid-Holland' }, 4.27),
        f('Maastunnel', 'highway', 'trunk', 'street', { city: 'Rotterdam' }, 4.47),
        f('Maastunnel', 'highway', 'cycleway', 'street', { city: 'Rotterdam' }, 4.47)] });
    };
    const plek = S.mijnPlek;
    S.mijnPlek = [52.01, 4.36];
    await doSearch('Maas');
    const rijen = Array.from(document.querySelectorAll('#sRes .item'));
    const vet = rijen[0] && rijen[0].querySelector('strong');
    const sub = rijen[0] && rijen[0].querySelector('small').textContent;
    const km = rijen[0] && rijen[0].querySelector('.waarde').textContent;
    S.mijnPlek = plek; $('#sRes').innerHTML = '';
    const ok = gevraagd.indexOf('layer=city') > 0 && rijen.length === 2 && !!vet && vet.textContent === 'Maas' &&
               sub === 'Plaats · Zuid-Holland' && /^[0-9]+,[0-9] km$/.test(km);
    return { ok, detail: rijen.length + ' rijen; vet "' + (vet && vet.textContent) + '"; "' + sub + '"; ' + km +
             (gevraagd.indexOf('layer=city') > 0 ? '' : '; ZONDER laagfilter') };
  });

  await test('Kaartkleuren volgen het thema, met akkers en zonder reliëf', async () => {
    for (let i = 0; i < 50 && !mapReady; i++) await wacht(200);
    if (!mapReady) return { ok: false, detail: 'kaart laadde niet' };
    const was = document.documentElement.getAttribute('data-thema');
    document.documentElement.setAttribute('data-thema', 'licht'); KaartThema.toepassen();
    const licht = map.getPaintProperty('background', 'background-color');
    const routeLicht = map.getPaintProperty('route-line', 'line-color');
    document.documentElement.setAttribute('data-thema', 'donker'); KaartThema.toepassen();
    const donker = map.getPaintProperty('background', 'background-color');
    document.documentElement.setAttribute('data-thema', was); KaartThema.toepassen();
    const ok = licht === '#e4e7d1' && donker === '#181b15' && routeLicht === '#e3b132' &&
               !!map.getLayer('kw-akker') && !map.getLayer('natural_earth');
    return { ok, detail: 'licht ' + licht + ' (route ' + routeLicht + '), donker ' + donker + ', akkers ' +
             (map.getLayer('kw-akker') ? 'ja' : 'NEE') + ', reliëf ' + (map.getLayer('natural_earth') ? 'NOG' : 'weg') };
  });

  /* ---------------- opruimen en tonen ---------------- */
  Voice.say = echt.say; Voice.prime = echt.prime; Wake.on = echt.wakeOn;
  window.stopNav = echt.stopNav; Date.now = echt.now;
  try { navigator.geolocation.watchPosition = echt.watch; } catch (e) {}
  herstelOpslag();
  laadFiets();                                        // je eigen fietskeuze terug
  S.route = null; S.wps = []; S.line = null;
  drawRoute(); updateStats(); renderRides(); sluitRit(); zetSlot(false); renderAfsluitingen();

  const goed = uitslagen.filter(u => u.ok).length;
  const vak = document.createElement('div');
  vak.style.cssText = 'position:fixed;inset:0;z-index:99;overflow:auto;background:#12110f;' +
    'color:#f5f0e6;font:14px/1.45 -apple-system,Segoe UI,sans-serif;padding:20px 16px';
  const kop = document.createElement('h2');
  kop.textContent = 'Kopwerk-tests: ' + goed + ' van ' + uitslagen.length + ' geslaagd';
  kop.style.cssText = 'margin:0 0 14px;font-size:18px;color:' +
    (goed === uitslagen.length ? '#7fb24a' : '#d9574a');
  vak.appendChild(kop);
  for (const u of uitslagen) {
    const r = document.createElement('div');
    r.style.cssText = 'padding:9px 11px;margin-bottom:6px;border-radius:9px;background:#1c1a17;' +
      'border-left:4px solid ' + (u.ok ? '#7fb24a' : '#d9574a');
    const b = document.createElement('b'); b.textContent = (u.ok ? '✓ ' : '✗ ') + u.naam;
    const s = document.createElement('div'); s.textContent = u.detail;
    s.style.cssText = 'color:#bab2a3;font-size:12.5px;margin-top:2px';
    r.appendChild(b); r.appendChild(s); vak.appendChild(r);
  }
  const noot = document.createElement('p');
  noot.textContent = 'Je bewaarde routes en ritten zijn teruggezet. Haal ?test uit het adres om de app gewoon te gebruiken.';
  noot.style.cssText = 'color:#bab2a3;font-size:12px;margin-top:14px';
  vak.appendChild(noot);
  document.body.appendChild(vak);
  window.__testUitslagen = uitslagen;
})();
