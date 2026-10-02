# VFR-Briefing (vfr.markusgubi.workers.dev)

Privates, sicherheitsorientiertes VFR-Planungstool für einen Privatpiloten (PPL) in Österreich.
Ziel: die wetterbasiert SICHERSTE VFR-Route mit realistischer Flughöhe finden, nur durch erlaubte Lufträume,
mit klaren Hinweisen zu Freigaben. Besser und übersichtlicher als StayVFR (stayvfr.djinnworks-aviation.at).
Sprache der Oberfläche und aller Hinweise: Deutsch. Der Nutzer arbeitet am Mac und iPhone (Safari).

## Betrieb
- Cloudflare Worker "vfr", Deploy automatisch per Workers Builds bei Push auf main.
- Secret OPENAIP_KEY liegt in Cloudflare (niemals ins Repo).
- Cloudflare Access schützt die ganze Seite (Policy "Cloudflare account members", 7 Tage Session).
- Lokal testen: npm run dev (für /cfg wird OPENAIP_KEY in .dev.vars benötigt, nie committen).

## Architektur (Stand v7.5, alles in src/worker.js)
- Worker liefert: "/" (HTML-App als String.raw-Template), "/test" (Diagnose), "/cfg" (gibt openAIP-Key an den
  eingeloggten Browser), "/awx?bbox=" (METAR/TAF von aviationweather.gov, 8 min Cache), "/dem/z/x/y.png"
  (AWS Terrain Tiles Terrarium, 30 Tage Cache).
- Der BROWSER fragt direkt ab: openAIP (api.core.openaip.net, Länderdaten mit country=AT etc., 24 h Cache-Storage)
  und Open-Meteo (5 Modelle: icon_seamless, meteofrance_seamless, ecmwf_ifs025, ukmo_seamless, gfs_seamless).
  Grund: openAIP und Open-Meteo drosseln Cloudflare-IPs (HTTP 429). Nicht wieder auf Worker-Proxy umstellen.
- Wichtig im String.raw-Template: keine Backticks und kein "${" im Client-Code.
- Empfehlung: Client-Code in eigene Dateien auslagern (public/index.html, public/app.js, public/style.css) und
  per Workers Static Assets ausliefern; API-Routen bleiben im Worker. Erst umbauen, wenn alles getestet ist.

## Kernlogik
- Routennetz: ca. 5 NM längs, 13 Spuren quer (±30 NM), gerichteter azyklischer Graph, Bestweg per DP.
  Mehrere Kandidaten (λ 2/5/12, Strafen für Ähnlichkeit), Rangfolge: Kategorie, Konfliktlänge, Rohscore, ETE.
- Wetterraster grob (~12 NM, 5 Spuren), Netzknoten nutzen die 1–2 nächsten Wetterpunkte (jeweils schlechterer Wert).
- Wolkenbasis: Feuchteprofil 950–700 hPa (RH ≥ 93 %), Rückfall Taupunktdifferenz × 400 ft; nur bei
  tiefer Bewölkung ≥ 50 % oder mittlerer ≥ 70 %.
- Vertikalprofil (evalRoute): Stichproben alle 0,5 NM, Gelände ±1 NM + 150 ft DEM-Puffer, Steig/Sinkrate,
  Wolkenabstand (über 3000 ft MSL Nutzerwert, darunter 500 ft wie SERA), Halbkreisflughöhen
  (Missweisung 5° O), Luftraumgrenzen mit METAR-QNH umgerechnet, Sauerstoff-Prüfung (EASA NCO.OP.190).

## Sicherheitsprinzipien (NICHT aufweichen)
1. Vorsichtsprinzip: Gefahren (Basis, Sicht, Gewitter, Böen, Niederschlag) zählen, sobald ZWEI Modelle sie bestätigen
   (zweitschlechtester Wert). Ein Einzelmodell erscheint nur als Info-Hinweis.
2. Amtliche Meldungen (METAR ≤ 90 min, TAF-Grundprognose/FM/BECMG) haben Vorrang, wenn sie SCHLECHTER sind als
   die Modelle. Nie optimistischer als eine amtliche Meldung. TEMPO/PROB nur als Warnhinweis.
3. Ampel nie mitteln: schlechtester Abschnitt bestimmt die Routenkategorie (GUT / EINGESCHR. / KRITISCH).
   Die Begriffe VFR/MVFR/IFR nur für echte METAR/TAF verwenden, nie für Prognosen.
4. Ohne Luftraumdaten wird nicht geplant. Verbotene Lufträume (R, P, Klasse A) werden nie durchflogen.
5. Hinweis "kein Ersatz für amtliches Briefing / NOTAM / AIP" bleibt immer sichtbar.

## Offene Anforderungen (Backlog, in dieser Reihenfolge)
1. Start immer in Platzhöhe mit normalem Steigflug: KEIN Kreisen über dem Startplatz einplanen. Ist das Gelände
   mit der eingestellten Steigrate nicht sicher zu übersteigen, Route als EINGESCHRÄNKT bzw. KRITISCH bewerten
   und begründen. (Aktuell plant evalRoute z. B. bei LOLW "Kreisen auf 6800 ft" – falsch.) Kreisen unterwegs
   nur, wenn wirklich nötig und deutlich als Nachteil bewertet.
2. Fortschrittsanzeige beim Berechnen: Fortschrittsbalken mit Schritten (Gelände, Luftraum, je Wettermodell,
   Routensuche, Abflugzeit-Optimierer) und Prozent, damit sichtbar ist, was gerade passiert.
3. Klick/Hover auf das Höhenprofil zeigt die Position als Marker auf der Karte (und umgekehrt).
4. Route auf der Karte verziehbar: Wegpunkte ziehen, einfügen (Klick auf Linie), löschen; Sicherheitsbewertung,
   Profil, Hinweise und Navlog rechnen live neu. Dazu evalRoute so verallgemeinern, dass es beliebige Polylinien
   bewertet (nicht nur Netzkanten).
5. Höhenprofil verziehbar: Reiseflughöhe je Abschnitt per Ziehen ändern (z. B. um Lufträumen auszuweichen),
   live neu bewerten, Konflikte sofort rot markieren.
6. GAFOR-Routen (Austro Control) als Overlay und als Präferenz in der Routensuche (Kosten-Bonus nahe GAFOR-Strecken,
   damit man bei Wetterverschlechterung ins Tal absinken kann). Die GAFOR-Routendaten müssen aus der aktuellen
   österreichischen AIP/GAFOR-Karte stammen; nicht raten. Wenn keine verlässliche Quelle maschinenlesbar verfügbar ist,
   eine GeoJSON-Datei im Repo anlegen und den Nutzer bitten, sie zu prüfen.
7. Auslandsflüge über Meldepunkte: Wegpunkte im Ausland (und Grenzübertritte) auf veröffentlichte VFR-Meldepunkte
   legen, z. B. LOLW→LJPZ über NIPEL und KOZINA. Grenzübertrittspunkte immer anzeigen (Karte, Navlog, Hinweise).
   Datenquelle prüfen (openAIP reporting points), nichts erfinden.
8. Freigaben: zuständige Flugverkehrskontrollstelle und Frequenz anzeigen, nur wenn verlässlich aus den Daten
   (openAIP-Frequenzen von Luftraum/Flugplatz); sonst "Frequenz laut AIP/ICAO-Karte". Gleichnamige Luftraumteile
   (z. B. mehrere "TMA LOWL"-Sektoren) zu einem Hinweis zusammenfassen. Bei Einflug kurz nach dem Start:
   "Freigabe vor dem Abflug anfordern".
9. SkyDemon-Export mit Höhen funktioniert noch nicht (SkyDemon übernimmt aus .flightplan keine Abschnittshöhen).
   Der Nutzer liefert eine echte, in SkyDemon gespeicherte .flightplan-Datei mit Höhenänderungen als Vorlage;
   Format exakt danach nachbauen. GPX behält Höhen im Wegpunktnamen.
10. Mobile (iPhone): Ansicht mit Leiste unten (Planen/Karte/Profil/Ergebnis) weiter verbessern; Beschriftungen in
    Grafiken dürfen sich nie überschneiden.

## Arbeitsweise
- Vor jedem Commit: Syntax prüfen (node --check auf Server- und Client-Code), lokal mit wrangler dev testen.
- Testroute zum Prüfen: LOLW → LOWZ (Alpen) und LOLW → LJPZ (Ausland, Meldepunkte).
- Versionsnummer in Titel, Untertitel und GPX-Creator mitführen (nächste Version v7.6).
- Kleine, nachvollziehbare Commits; Änderungen am Sicherheitsverhalten im Commit-Text begründen.
