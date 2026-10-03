# VFR-Briefing (vfr.gubi.co.at, auch vfr.markusgubi.workers.dev)

Privates, sicherheitsorientiertes VFR-Planungstool für einen Privatpiloten (PPL) in Österreich.
Ziel: die wetterbasiert SICHERSTE VFR-Route mit realistischer Flughöhe finden, nur durch erlaubte Lufträume,
mit klaren Hinweisen zu Freigaben. Besser und übersichtlicher als StayVFR (stayvfr.djinnworks-aviation.at).
Sprache der Oberfläche und aller Hinweise: Deutsch. Der Nutzer arbeitet am Mac und iPhone (Safari).

## Betrieb
- Cloudflare Worker "vfr", Deploy automatisch per Workers Builds bei Push auf main.
- Secret OPENAIP_KEY liegt in Cloudflare (niemals ins Repo).
- Passwortschutz (seit 8.5, ersetzt Cloudflare Access): src/auth.js prüft JEDE Anfrage (run_worker_first,
  Assets über env.ASSETS). Secret APP_PASSWORD in Cloudflare; Anmeldeseite, signiertes Sitzungs-Cookie
  (HMAC-SHA-256, 30 Tage). Fehlt APP_PASSWORD, bleibt die Seite gesperrt (503) – nie offen. Neues Passwort =
  alle Sitzungen ungültig. /logout meldet ab. /cfg gibt den openAIP-Key nur angemeldet heraus: den Schutz nie
  umgehen (keine Ausnahmen für weitere Pfade ohne Rücksprache). Lokal: APP_PASSWORD in .dev.vars
  (e2e-Tests nutzen TEST_PASSWORD, Standard "test-passwort").
- Eigene Domain vfr.gubi.co.at als Custom Domain in wrangler.toml (routes, custom_domain = true).
- Lokal testen: npm run dev (für /cfg wird OPENAIP_KEY in .dev.vars benötigt, nie committen).

## Architektur (Stand 8.5)
- Oberfläche als Workers Static Assets in public/ (index.html, css/app.css, js/*.js, data/gafor.geojson,
  img/ und manifest.webmanifest für den iPhone-Startbildschirm; Manifest mit crossorigin="use-credentials"
  wegen der Anmeldung per Cookie).
  Klassische Skripte ohne Bundler, gemeinsamer globaler Namensraum, Reihenfolge laut index.html:
  util (Helfer, Geometrie) → data (Luftraum, openAIP, Gelände) → wx (Open-Meteo, METAR/TAF) →
  route (Netz, Höhenprofil evalRoute, eigene Routen, Kandidaten) → report (finalize: Navlog, Hinweise,
  Frequenzen) → border (Grenzübertritte, Meldepunkte) → export (GPX, SkyDemon) → ui (Karte, Ablauf,
  Darstellung, Bearbeiten, Profil↔Karte).
- src/worker.js liefert nur noch API-Routen: "/test" (Diagnose), "/cfg" (gibt openAIP-Key an den eingeloggten
  Browser), "/awx?bbox=" (METAR/TAF von aviationweather.gov, 8 min Cache), "/dem/z/x/y.png" (AWS Terrain Tiles
  Terrarium, 30 Tage Cache). Alle anderen Pfade kommen aus public/.
- Der BROWSER fragt direkt ab: openAIP (api.core.openaip.net, Länderdaten mit country=AT etc., 24 h Cache-Storage
  "vfr-oaip", Schlüssel cache.local/oaip2/…) für Lufträume (inkl. FIR als Grenzen), Flugplätze (mit Frequenzen)
  und Meldepunkte (reporting-points), sowie Open-Meteo (5 Modelle: icon_seamless, meteofrance_seamless,
  ecmwf_ifs025, ukmo_seamless, gfs_seamless).
  Grund: openAIP und Open-Meteo drosseln Cloudflare-IPs (HTTP 429). Nicht wieder auf Worker-Proxy umstellen.
- Die Rechenlogik (util/data/wx/route/report/border) greift beim Laden nicht auf Karte/DOM zu und ist
  dadurch in Node testbar (tests/unit/load.mjs).

## Kernlogik
- Routennetz: ca. 5 NM längs, 13 Spuren quer (±30 NM), gerichteter azyklischer Graph, Bestweg per DP.
  Mehrere Kandidaten (λ 2/5/12, Strafen für Ähnlichkeit), Rangfolge: Kategorie, Konfliktlänge, Rohscore, ETE.
- Wetterraster grob (~12 NM, 5 Spuren), Netzknoten nutzen die 1–2 nächsten Wetterpunkte (jeweils schlechterer Wert).
- Wolkenbasis: Feuchteprofil 950–700 hPa (RH ≥ 93 %), Rückfall Taupunktdifferenz × 400 ft; nur bei
  tiefer Bewölkung ≥ 50 % oder mittlerer ≥ 70 %.
- Netz zusätzlich mit Abflug-/Anflugfächer (Ringe 2,5 und 5 NM, alle 15°), damit Talausgänge gefunden werden.
  Die Routensuche bestraft Teilstrecken, die mit normalem Steigflug ab Platzhöhe nicht erreichbar sind.
- Vertikalprofil (evalRoute): Stichproben alle 0,5 NM, Gelände ±1 NM + 150 ft DEM-Puffer, Steig/Sinkrate,
  Wolkenabstand (über 3000 ft MSL Nutzerwert, darunter 500 ft wie SERA), Halbkreisflughöhen
  (Missweisung 5° O), Luftraumgrenzen mit METAR-QNH umgerechnet, Sauerstoff-Prüfung (EASA NCO.OP.190).
  Start immer in Platzhöhe; im Abflugbereich (8 NM) nie Kreisen. Im Abflug-/Anflugbereich steigt der geforderte
  Geländeabstand von der Platzhöhe aus an. Konflikt (KRITISCH) unter 500 ft Abstand, knapp (EINGESCHR.) unter
  dem eingestellten Abstand. Geplant wird mit 300 ft Reserve. Jeder Abschnitt hat sein eigenes Höhenband.
- Talflug (seit 9.2, mit dem Nutzer abgestimmt): massgebliches Gelände je Stelle = das günstigere von (a) höchstem
  Gelände ±1 NM und (b) Talboden (Mittellinie), wobei die Flanken bis ±0,5 NM unter der Flughöhe (inkl. DEM-Puffer)
  bleiben müssen (effTerr, auch im Suchnetz: edgeStatic e.t05, edgeDyn r.te). Sollabstand gilt über dem Talboden;
  Konflikt unter 500 ft über dem Talboden. Talflug ohne Wetterproblem ist NICHT eingeschränkt (Nutzer). Wolken
  unter der nötigen Talflughöhe → KRITISCH. Kein Kreisen im Abflugbereich (Nutzer: nicht normal; man steigt im Tal
  heraus). Sicherheitswert: −8 × Anteil der Strecke über hohem Gelände (> 3000 ft über dem tieferen Platz).
  Tests: tests/unit/talflug.test.mjs.
- Einheitliche Bewertung (seit 8.1): Das Suchnetz dient nur zum Finden der Wege. JEDE Route (berechnet,
  Direktstrecke, Optimierer, Meldepunkte, Bearbeiten) wird über dieselbe Polylinie bewertet (evalPath →
  polyGraph, Wetter höchstens alle 5 NM). Dieselbe Strecke ergibt so immer dieselbe Einstufung; vorher konnten
  lange Netzkanten schlechtes Wetter in der Mitte übersehen. Formpunkte (pts[k].shape) halten die Linie exakt,
  ziehbar sind nur Wegpunkte; beim Ziehen werden die beiden Nachbar-Teilstrecken gerade.
- Eigene Höhen (seit 8.2): werden wie eingestellt geflogen; eine höhere Höhe wird VOR Beginn ihrer Teilstrecke
  erreicht, gesunken wird ab Beginn der Teilstrecke. Die automatische Sinkflugplanung zum Ziel greift erst nach
  der letzten eigenen Höhe.
- Sinkflug wie Steigflug (seit 8.5): Das Profil endet in Platzhöhe, gesunken wird gleichmäßig mit der
  eingestellten Sinkrate (Obergrenze cap = Platzhöhe + Sinkgradient × Restdistanz, gilt auch für eigene Höhen).
  Nur wo das Gelände davor es verlangt, bis zur doppelten Sinkrate (STEEP_F) mit Hinweis "Steiler Sinkflug"
  (über 1,5-fach = EINGESCHR.). Reicht auch das nicht: Konflikt "desc" (KRITISCH). Kein Kreisen über dem Ziel.
  Anflugbereich (rampArrNm) analog zum Abflugbereich; die Routensuche bestraft Kanten mit descDef/descDefS.
  Die Obergrenze vor dem Ziel berücksichtigt das Gelände auch bei eigenen Höhen (LTa), seit 8.6.
- Wegpunkte erscheinen im Höhenprofil als senkrechte Linien mit Nummer/Name (wie Navlog). Beim Bearbeiten
  (seit 8.6) zeigt das Profil genau die ziehbaren Wegpunkte mit denselben Nummern wie die Karte (Teilstrecken-
  grenzen, ohne Knick-Punkte des Navlogs). Tipp/Klick ins Profil neben die Griffe fügt dort einen Wegpunkt ein
  (Teilstrecke wird geteilt, Linie und Bewertung bleiben gleich), danach eigene Höhe für das Stück setzbar.
  Höhen-Eingabe (seit 8.9, für iPhone überarbeitet): feste Eingabefläche #profTouch über dem SVG (wird beim
  Neuzeichnen nie ersetzt – Safari verlor sonst den Finger), touchstart auf einem Griff mit preventDefault (kein
  Seiten-Scrollen), Trefferzone Finger 30 / Maus 16 Einheiten. Tipp knapp neben einen Griff (Finger 40 / Maus 26)
  wählt die Teilstrecke statt einen Wegpunkt einzufügen – aber NUR nahe am runden Griff (nearHandle: Finger 36 /
  Maus 22 Einheiten waagrecht). Ein kurzer Tipp auf die Höhenlinie/das Band abseits des Griffs fügt dort einen
  Wegpunkt ein (seit 9.1); "zu nah" (< 1 NM) zählt beim Bearbeiten nur die nummerierten Wegpunkte. Gewählte Teilstrecke (EDIT.sel, Griff gefüllt) in der
  Höhenleiste #altBar unter dem Profil: Höhe, Mindesthöhe, Knöpfe −500/−100/+100/+500/Auto, klare Meldung am
  Minimum ("Tiefer nicht möglich …") und bei nicht erreichbarer Höhe. Kein Doppeltipp mehr (setzte bei
  wiederholten Versuchen versehentlich zurück). Ziehen startet nach 2 Einheiten senkrecht. Im Profil eingefügte Punkte (pt.fromProf) sind magenta hervorgehoben; Tipp auf ihr ✕ bzw.
  ihre Linie = Einfügen rückgängig (seit 8.8). Bearbeiten-Modus deutlich markiert (body.editmode: Rahmen um
  Karte/Profil, Leiste mit "✓ Fertig", Stift aktiv). Eigene Höhen, die nirgends in ihrer Teilstrecke geflogen werden
  (z. B. zu tief vor einem Berg, weil vorher gestiegen werden muss), zeigt das Profil rot gestrichelt mit
  "nicht erreichbar"; der Hinweis nennt den Grund (seit 8.9). Nie ins Gelände: Ziehen stoppt an der Mindesthöhe der Teilstrecke (legMinAlt = höchste
  harte Grenze der Stichproben, rote Linie "min." beim Ziehen). Während des Ziehens wird die Profil-Legende nicht
  neu gezeichnet (sonst verschiebt sich das Profil unter dem Finger). Belastungstest: `node tests/e2e/hoehe.mjs`.
- Wetterbild (seit 8.6, nur Anzeige, NIE in der Bewertung): Radar RainViewer (weather-maps.json, letztes Bild,
  maxNativeZoom 7) oder Satellit Infrarot EUMETSAT WMS (view.eumetsat.int, Layer msg_fes:ir108). Aus der Cloud-
  Umgebung nicht erreichbar, nur mit simulierten Quellen getestet (`node tests/e2e/wetterbild.mjs`).
- Lange Strecken (seit 8.5): keine 250-NM-Grenze mehr, Hinweis "Lange Strecke" (Kraftstoff, Zwischenlandung
  entscheidet der Pilot). Gelände-Zoom adaptiv (demZoom: 10/9/8, DEM-Puffer 150/300/450 ft), Netz bis 70 Schritte,
  Wetterraster bis 20 Schritte, /awx bis 12° × 16°. Luftraum gilt nur in den Länderrechtecken (CTRY) geladener
  Länder als abgedeckt (coverBoxes); außerhalb ist die Route KRITISCH.
- Keine "Achterbahn" (seit 8.3): Senken im automatischen Profil (sinken und innerhalb 15 NM wieder steigen)
  werden aufgefüllt, soweit Wolken/Luftraum es erlauben. Eigene Höhen bleiben unverändert; ist eine eigene
  Höhe über der Max. Höhe oder mit der Steigrate (rechtzeitig) nicht erreichbar, steht ein Hinweis dabei.
- Bearbeiten macht nur markante Punkte ziehbar (Douglas-Peucker 0,75 NM, Meldepunkte, Grenzübertritte);
  die Linie selbst bleibt exakt gleich. Einfügen über "+"-Griffe in der Mitte jeder Teilstrecke (antippen oder
  ziehen; ausgeblendet, wenn < 34 px neben einem Wegpunkt) und über eine breite unsichtbare Tippfläche der Linie.
- Handy/Tablet: Tipp ins Höhenprofil springt zur Karte und zeigt die Stelle (durchfallender Tipp wird ignoriert).
  Die Karte wird nur eingepasst, wenn sie sichtbar ist (sonst Zoom 0 bei 0-px-Karte → Ziehen springt um Grad).
- Bearbeiten ohne Änderung (Stift an/aus) legt keine "Eigene Route" an. Nur wirklich geänderte eigene Routen
  bleiben beim Neuberechnen erhalten und werden mit der neu geplanten Abflugzeit bewertet.
- GAFOR (seit 8.2): nur mit Haken "GAFOR-Strecken bevorzugen" (P.preferGafor/GAFOR_ON). Dann zusätzliche
  GAFOR-Variante in der Suche; in der Rangfolge zählt GAFOR-Nähe NUR bei gleicher Sicherheit (Einstufung,
  Konfliktlänge, Sicherheitswert). Die normale Suche bleibt ohne GAFOR-Einfluss. Sicherheit geht immer vor.
- Tageslicht (seit 9.0): Sonnenzeiten werden lokal berechnet (sunTimes in util.js, NOAA-Näherung, ±2 min,
  Ortszeit Europe/Vienna), kein Netzabruf mehr. Tag = BCMT bis ECET (SERA). Ankunft nach ECET bzw. Abflug vor
  BCMT = Nacht → KRITISCH (nur NVFR). Ankunft ab 30 min vor Sonnenuntergang bis ECET bzw. Abflug zwischen BCMT
  und Sonnenaufgang → EINGESCHR. mit Hinweis (vorher war jede Ankunft nach Sonnenuntergang KRITISCH; geändert,
  weil VFR bei Tag bis ECET zulässig ist – die Dämmerung bleibt als Einschränkung sichtbar). Optimierer: BCMT..ECET.
- Rückflug (seit 9.0, Haken "Rückflug am selben Tag prüfen" + Aufenthalt in min): returnPlan baut ein eigenes Netz
  Ziel → Start (reverseNet, dieselben Wetterpunkte/Luftraum/Gelände, keine neuen Abrufe) und sucht ab Ankunft +
  Aufenthalt alle 30 min die sicherste Route (bestRouteAt), Grenze auf 10 min verfeinert. Empfehlung "spätestens
  HH:MM": letzter Abflug, der nicht KRITISCH ist und vor ECET am Startplatz landet; Grund (ECET oder Wetter ab ...),
  "mit Tageslichtreserve bis ...", "durchgehend/ab ... nur EINGESCHR.". Kommt der Hinflug nach ECET an: Warnung
  "Kein Rückflug am selben Tag". Ist jede Zeit KRITISCH, nennt der Text den geprüften Zeitraum "von (Landung +
  Aufenthalt) bis ..." und – wenn in allen Zeiten nur Gelände/Steigrate/Luftraum die Ursache sind (structural) –
  dass eine andere Uhrzeit nichts ändert. Test: tests/unit/tageslicht.test.mjs, `node tests/e2e/rueckflug.mjs`.
- Eigene Routen: routeFromPoints/polyGraph bewerten beliebige Wegpunktfolgen; eigene Höhen je Teilstrecke
  (opt.userAlt) werden wie geplante Höhen geprüft. Fehlen Luftraumdaten für einen Teil, ist die Route KRITISCH.

## Sicherheitsprinzipien (NICHT aufweichen)
1. Vorsichtsprinzip: Gefahren (Basis, Sicht, Gewitter, Böen, Niederschlag) zählen, sobald ZWEI Modelle sie bestätigen
   (zweitschlechtester Wert). Ein Einzelmodell erscheint nur als Info-Hinweis.
2. Amtliche Meldungen (METAR ≤ 90 min, TAF-Grundprognose/FM/BECMG) haben Vorrang, wenn sie SCHLECHTER sind als
   die Modelle. Nie optimistischer als eine amtliche Meldung. TEMPO/PROB nur als Warnhinweis.
3. Ampel nie mitteln: schlechtester Abschnitt bestimmt die Routenkategorie (GUT / EINGESCHR. / KRITISCH).
   Die Begriffe VFR/MVFR/IFR nur für echte METAR/TAF verwenden, nie für Prognosen.
4. Ohne Luftraumdaten wird nicht geplant. Verbotene Lufträume (R, P, Klasse A) werden nie durchflogen.
5. Hinweis "kein Ersatz für amtliches Briefing / NOTAM / AIP" bleibt immer sichtbar.

## Backlog
Umgesetzt bis 8.0: 1 (Start in Platzhöhe, kein Kreisen am Start), 2 (Fortschrittsanzeige), 3 (Profil↔Karte),
4 + 5 (Route und Höhen bearbeiten), 7 (Grenzübertritte, Meldepunkte), 8 (Frequenzen aus Daten, Luftraumteile
zusammengefasst), 10 (Reiter-Ansicht für Handy und Touch-Tablets bis 1400 px mit eigenem Export-Reiter,
Profil-Legende, Kartenseite repariert).

Offen:
6. GAFOR-Routen (seit 8.7 MIT Daten, ungefähr): public/data/gafor.geojson enthält alle 48 Strecken der GAFOR-Karte
   von Austro Control (Sichtflug-Streckenvorhersage vom 03.10.2026, vom Nutzer geliefert). Methode: Karte über 45
   Flugplätze eingemessen (quadratische Anpassung, Restfehler ca. 1 Pixel = 0,3 NM), Linien per kürzestem Weg
   entlang der gezeichneten Strecken nachgeführt, Zwischenorte aus der Austro-Control-Streckenliste (2019).
   Kontrolle: Linien liegen im Median 0,2 NM, höchstens ca. 3 NM neben den Orten der Streckenbeschreibung.
   Genauigkeit daher "ca. 1-3 NM" (in der Datei und der Oberfläche als ungefähr gekennzeichnet), GAFOR_NM = 3.
   Bezugshöhen aus der Karte. Die Tages-Einstufung (O/D/M/X) ist NICHT enthalten (tagesaktuell bei Austro Control).
   Nutzung nur für Anzeige und "bevorzugen bei gleicher Sicherheit". Mit der AIP (GAFOR-Übersichtskarte) bei
   Gelegenheit abgleichen. Tests: tests/unit/gafor-daten.test.mjs, `node tests/e2e/gafor.mjs`.
9. SkyDemon-Export: seit 8.5 Attribut für Attribut nach einer echten, in SkyDemon gespeicherten Datei des
   Nutzers (StartType/ToType="Unknown", Time als Windows-FILETIME UTC, LevelChange immer "B"). Vorher
   ignorierte SkyDemon die Höhen (zeigte "MSL"). Noch vom Nutzer in SkyDemon zu bestätigen
   (Test: tests/unit/export.test.mjs).
- Grenzen & Orte (seit 9.3): Grenzübertritt auch erkannt, wenn das Nachbarland keine FIR in openAIP hat (Verlassen
  der letzten FIR Richtung Auslandsziel, c.noFir). Übertrittspunkt: (1) VFR-Meldepunkt ≤ 15 NM, (2) markanter Ort
  ≤ 6 NM (borderTown, Größe stark gewichtet: 10× größer = bis 2 NM weiter), (3) Grenzpunkt mit nächstem Ortsnamen.
  Orte aus OpenStreetMap/Overpass (loadPlaces: city/town + village ≥ 1000 Einw., 30 Tage Cache, 12 s Zeitlimit,
  Ausfall = keine Orte). Wegpunkte bekommen den nächsten Ort ≤ 3 NM (w.town, Navlog "WP3 · Gmunden"), auf der
  Karte werden Orte ≤ 3 NM neben der Route beschriftet (drawTowns, mind. 7 NM Abstand). Orte nur zur Benennung/
  Navigation, nie für Sicherheitsentscheidungen. Overpass aus der Cloud-Umgebung nicht erreichbar, nur simuliert
  getestet (tests/e2e/grenze.mjs, Mock-Orte in mock.mjs).
- Meldepunkte/Frequenzen/FIR-Grenzen nutzen openAIP-Felder (reporting-points: compulsory, airports;
  airports: frequencies; airspaces Typ 10 = FIR, Land aus "country"). Mit echten Daten prüfen (LOLW → LJPZ).
- Beschriftungen in Grafiken dürfen sich nie überschneiden (lbl()-Kollisionsprüfung im Profil nutzen).

## Arbeitsweise
- Vor jedem Commit: `npm run check` (node --check auf Server- und Client-Code) und `npm test` (Unit-Tests der
  Rechenlogik mit künstlichem Gelände, ohne Netz). Lokal mit `npm run dev` testen.
- Browser-Tests mit simulierten Datenquellen (tests/e2e, brauchen Playwright und laufendes `npm run dev`):
  `node tests/e2e/run.mjs LOLW LOWZ gut`, `node tests/e2e/edit.mjs`, `node tests/e2e/lang.mjs` (> 250 NM),
  `node tests/e2e/grenze.mjs` (AT→IT ohne Meldepunkt/FIR), `rueckflug.mjs`, `hoehe.mjs`, `gafor.mjs`, `wetterbild.mjs`. Die Mock-Daten in tests/e2e/mock.mjs sind
  frei erfunden und nur für Tests.
- Testroute zum Prüfen: LOLW → LOWZ (Alpen) und LOLW → LJPZ (Ausland, Meldepunkte).
- Versionsnummer in Titel, Untertitel, GPX-Creator, /test und package.json mitführen (aktuell 9.3, nächste 9.4).
- Kleine, nachvollziehbare Commits; Änderungen am Sicherheitsverhalten im Commit-Text begründen.
- Jede Einstufung EINGESCHR./KRITISCH braucht eine sichtbare Begründung (issueOf + Hinweis).
- Testgebiete sind iPhone (390 px), iPad quer (1180 px, Touch) und Desktop.
- Erkundungstest über 5 Routen mit Ziehen von Strecke und Höhen (Desktop + iPhone), prüft u. a. Überschneidungen
  von Beschriftungen, NaN, fehlende Begründungen, gehaltene eigene Höhen, Export: `node tests/e2e/explore.mjs`.
  Die Bilder danach immer auch selbst ansehen.
- iPhone-Bedienung: `node tests/e2e/iphone-edit.mjs` (Reiterwechsel/Zoom, "+"-Griffe, Profil→Karte).
- Bearbeiten darf die Bewertung nie verändern: `node tests/e2e/konsistenz.mjs` und tests/unit/konsistenz.test.mjs.
