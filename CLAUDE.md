# VFR-Briefing (vfr.gubi.co.at, auch vfr.markusgubi.workers.dev)

Privates, sicherheitsorientiertes VFR-Planungstool für einen Privatpiloten (PPL) in Österreich.
Ziel: die wetterbasiert SICHERSTE VFR-Route mit realistischer Flughöhe finden, nur durch erlaubte Lufträume,
mit klaren Hinweisen zu Freigaben. Besser und übersichtlicher als StayVFR (stayvfr.djinnworks-aviation.at).
Sprache der Oberfläche und aller Hinweise: Deutsch. Der Nutzer arbeitet am Mac und iPhone (Safari).

## Betrieb
- Cloudflare Worker "vfr", Deploy automatisch per Workers Builds bei Push auf main.
- Secret OPENAIP_KEY liegt in Cloudflare (niemals ins Repo).
- Cloudflare Access schützt die ganze Seite (Policy "Cloudflare account members", 7 Tage Session), und zwar
  je Adresse eine eigene Access-Application: "vfr - Cloudflare Workers" (workers.dev) und "vfr" (vfr.gubi.co.at).
  Eine neue Adresse NIE ohne eigene Access-Application freischalten: /cfg gibt sonst den openAIP-Key heraus.
- Eigene Domain vfr.gubi.co.at als Custom Domain in wrangler.toml (routes, custom_domain = true).
- Lokal testen: npm run dev (für /cfg wird OPENAIP_KEY in .dev.vars benötigt, nie committen).

## Architektur (Stand 8.4)
- Oberfläche als Workers Static Assets in public/ (index.html, css/app.css, js/*.js, data/gafor.geojson,
  img/ und manifest.webmanifest für den iPhone-Startbildschirm; Manifest mit crossorigin="use-credentials"
  wegen Cloudflare Access).
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
- Einheitliche Bewertung (seit 8.1): Das Suchnetz dient nur zum Finden der Wege. JEDE Route (berechnet,
  Direktstrecke, Optimierer, Meldepunkte, Bearbeiten) wird über dieselbe Polylinie bewertet (evalPath →
  polyGraph, Wetter höchstens alle 5 NM). Dieselbe Strecke ergibt so immer dieselbe Einstufung; vorher konnten
  lange Netzkanten schlechtes Wetter in der Mitte übersehen. Formpunkte (pts[k].shape) halten die Linie exakt,
  ziehbar sind nur Wegpunkte; beim Ziehen werden die beiden Nachbar-Teilstrecken gerade.
- Eigene Höhen (seit 8.2): werden wie eingestellt geflogen; eine höhere Höhe wird VOR Beginn ihrer Teilstrecke
  erreicht, gesunken wird ab Beginn der Teilstrecke. Die automatische Sinkflugplanung zum Ziel greift erst nach
  der letzten eigenen Höhe. Ist ein früheres Sinken nicht möglich, wird über dem Platz im Vollkreis gesunken
  (im Profil als Spirale gezeichnet, nie als senkrechter Strich).
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
6. GAFOR-Routen: Funktion fertig (Overlay, Option "bevorzugen" nur bei gleicher Sicherheit, Kennzahl), aber OHNE Daten.
   public/data/gafor.geojson muss aus der aktuellen AIP Austria (GAFOR-Karte) befüllt und mit
   "geprueft": true freigegeben werden. Nicht raten.
9. SkyDemon-Export: nach dem Aufbau einer echten SkyDemon-Datei (Windy-Forum, Beispiel mit
   Level="5000" LevelChange="B"/"F" je RhumbLineRoute) umgesetzt, Datei immer mit Endung .flightplan,
   auf iPhone/iPad über das Teilen-Menü. Noch NICHT mit einer echten SkyDemon-Datei des Nutzers abgeglichen:
   Übernimmt SkyDemon die Höhen nicht, eine in SkyDemon gespeicherte .flightplan-Datei mit Höhenänderungen
   als Vorlage nehmen und skyDemonXml() exakt danach anpassen (Test: tests/unit/export.test.mjs).
- Meldepunkte/Frequenzen/FIR-Grenzen nutzen openAIP-Felder (reporting-points: compulsory, airports;
  airports: frequencies; airspaces Typ 10 = FIR, Land aus "country"). Mit echten Daten prüfen (LOLW → LJPZ).
- Beschriftungen in Grafiken dürfen sich nie überschneiden (lbl()-Kollisionsprüfung im Profil nutzen).

## Arbeitsweise
- Vor jedem Commit: `npm run check` (node --check auf Server- und Client-Code) und `npm test` (Unit-Tests der
  Rechenlogik mit künstlichem Gelände, ohne Netz). Lokal mit `npm run dev` testen.
- Browser-Tests mit simulierten Datenquellen (tests/e2e, brauchen Playwright und laufendes `npm run dev`):
  `node tests/e2e/run.mjs LOLW LOWZ gut` und `node tests/e2e/edit.mjs`. Die Mock-Daten in tests/e2e/mock.mjs sind
  frei erfunden und nur für Tests.
- Testroute zum Prüfen: LOLW → LOWZ (Alpen) und LOLW → LJPZ (Ausland, Meldepunkte).
- Versionsnummer in Titel, Untertitel, GPX-Creator, /test und package.json mitführen (aktuell 8.4, nächste 8.5).
- Kleine, nachvollziehbare Commits; Änderungen am Sicherheitsverhalten im Commit-Text begründen.
- Jede Einstufung EINGESCHR./KRITISCH braucht eine sichtbare Begründung (issueOf + Hinweis).
- Testgebiete sind iPhone (390 px), iPad quer (1180 px, Touch) und Desktop.
- Erkundungstest über 5 Routen mit Ziehen von Strecke und Höhen (Desktop + iPhone), prüft u. a. Überschneidungen
  von Beschriftungen, NaN, fehlende Begründungen, gehaltene eigene Höhen, Export: `node tests/e2e/explore.mjs`.
  Die Bilder danach immer auch selbst ansehen.
- iPhone-Bedienung: `node tests/e2e/iphone-edit.mjs` (Reiterwechsel/Zoom, "+"-Griffe, Profil→Karte).
- Bearbeiten darf die Bewertung nie verändern: `node tests/e2e/konsistenz.mjs` und tests/unit/konsistenz.test.mjs.
