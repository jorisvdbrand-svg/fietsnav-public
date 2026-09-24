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

  /* ---------------- opruimen en tonen ---------------- */
  Voice.say = echt.say; Voice.prime = echt.prime; Wake.on = echt.wakeOn;
  window.stopNav = echt.stopNav; Date.now = echt.now;
  try { navigator.geolocation.watchPosition = echt.watch; } catch (e) {}
  herstelOpslag();
  S.route = null; S.wps = []; S.line = null;
  drawRoute(); updateStats();

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
