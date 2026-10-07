/* Fietsnav testmodus. Laadt alleen met ?test in het adres.

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

  /* ---------------- opruimen en tonen ---------------- */
  Voice.say = echt.say; Voice.prime = echt.prime; Wake.on = echt.wakeOn;
  window.stopNav = echt.stopNav; Date.now = echt.now;
  try { navigator.geolocation.watchPosition = echt.watch; } catch (e) {}
  herstelOpslag();
  S.route = null; S.wps = []; S.line = null;
  drawRoute(); updateStats(); renderRides(); sluitRit(); zetSlot(false); renderAfsluitingen();

  const goed = uitslagen.filter(u => u.ok).length;
  const vak = document.createElement('div');
  vak.style.cssText = 'position:fixed;inset:0;z-index:99;overflow:auto;background:#0b0e14;' +
    'color:#e8edf7;font:14px/1.45 -apple-system,Segoe UI,sans-serif;padding:20px 16px';
  const kop = document.createElement('h2');
  kop.textContent = 'Fietsnav-tests: ' + goed + ' van ' + uitslagen.length + ' geslaagd';
  kop.style.cssText = 'margin:0 0 14px;font-size:18px;color:' +
    (goed === uitslagen.length ? '#00e08a' : '#ff6b6b');
  vak.appendChild(kop);
  for (const u of uitslagen) {
    const r = document.createElement('div');
    r.style.cssText = 'padding:9px 11px;margin-bottom:6px;border-radius:9px;background:#141923;' +
      'border-left:4px solid ' + (u.ok ? '#00e08a' : '#ff6b6b');
    const b = document.createElement('b'); b.textContent = (u.ok ? '✓ ' : '✗ ') + u.naam;
    const s = document.createElement('div'); s.textContent = u.detail;
    s.style.cssText = 'color:#8b97ad;font-size:12.5px;margin-top:2px';
    r.appendChild(b); r.appendChild(s); vak.appendChild(r);
  }
  const noot = document.createElement('p');
  noot.textContent = 'Je bewaarde routes en ritten zijn teruggezet. Haal ?test uit het adres om de app gewoon te gebruiken.';
  noot.style.cssText = 'color:#8b97ad;font-size:12px;margin-top:14px';
  vak.appendChild(noot);
  document.body.appendChild(vak);
  window.__testUitslagen = uitslagen;
})();
