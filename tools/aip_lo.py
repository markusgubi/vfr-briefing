#!/usr/bin/env python3
"""Baut public/data/aip-lo.json aus den vom Nutzer gelieferten AIP-Austria-Auszuegen (pdftotext -layout):
ENR 2.1 (zustaendige Dienststellen je TMA/CTA, ATS-Frequenzen) und ENR 2.2 (Abschnitt 3 RMZ-Frequenzen,
Abschnitt 5 APP-Sektoren, Abschnitt 6 FIS-Sektoren). Grenzabschnitte ("entlang der Bundesgrenze") folgen der
Staatsgrenze aus public/data/grenzen.json (Natural Earth, ca. 1 km).
Aufruf: python3 tools/aip_lo.py enr21.txt enr22.txt"""
import json, math, re, sys

ENR21, ENR22 = sys.argv[1], sys.argv[2]
COORD = re.compile(r"(\d{2}) (\d{2}) (\d{2}(?:\.\d+)?)N (\d{3}) (\d{2}) (\d{2}(?:\.\d+)?)E")
BORDER = re.compile(r"entlang der\s+Bundesgrenze bis\s*/\s*along\s+State\s+Boundary\s+to", re.S)

def dms(d, m, s): return int(d) + int(m) / 60 + float(s) / 3600

# ---------- Staatsgrenze Oesterreich als geschlossener Ring ----------
G = json.load(open("public/data/grenzen.json"))
def close(a, b): return abs(a[0] - b[0]) < 1e-3 and abs(a[1] - b[1]) < 1e-3
segs = [[tuple(p) for p in ln["c"]] for ln in G["linien"] if "AT" in (ln["l"], ln["r"])]
segs = [s for s in segs if not close(s[0], s[-1]) or len(s) > 2]   # winzige Restsegmente (gleiche Endpunkte) weglassen
ring = segs.pop(0)
while segs:
    for i, s in enumerate(segs):
        if close(ring[-1], s[0]): ring += s[1:]; segs.pop(i); break
        if close(ring[-1], s[-1]): ring += s[::-1][1:]; segs.pop(i); break
    else:
        raise SystemExit("Grenzring nicht geschlossen (%d Reste)" % len(segs))
assert close(ring[0], ring[-1]), "Grenzring offen"
ring = ring[:-1]
def nearest(p):
    k = math.cos(math.radians(p[1]))
    return min(range(len(ring)), key=lambda i: ((ring[i][0] - p[0]) * k) ** 2 + (ring[i][1] - p[1]) ** 2)
def border_path(a, b):
    """Grenzpunkte zwischen a und b (kuerzerer Weg entlang des Rings)."""
    i, j, n = nearest(a), nearest(b), len(ring)
    fw = [(i + t) % n for t in range(1, (j - i) % n)]
    bw = [(i - t) % n for t in range(1, (i - j) % n)]
    return [ring[t] for t in (fw if len(fw) <= len(bw) else bw)]

def polygon(text):
    """Koordinatenfolge eines Teils (mit Grenzabschnitten) als [[lon,lat],...]"""
    text = BORDER.sub(" @BORDER@ ", text)
    pts, pend = [], False
    for tok in re.finditer(r"@BORDER@|" + COORD.pattern, text):
        if tok.group(0) == "@BORDER@": pend = True; continue
        p = (dms(*tok.groups()[3:6]), dms(*tok.groups()[0:3]))
        if pend and pts: pts += border_path(pts[-1], p)
        pend = False
        pts.append(p)
    if len(pts) > 2 and not close(pts[0], pts[-1]): pts.append(pts[0])
    return [[round(x, 5), round(y, 5)] for x, y in pts]

def limit(s):
    s = s.strip()
    if s == "GND": return {"ft": 0}
    m = re.match(r"FL(\d+)", s)
    if m: return {"ft": int(m.group(1)) * 100}
    m = re.match(r"(\d+) FT (AMSL|AGL)", s)
    if m: return {"ft": int(m.group(1)), "agl": m.group(2) == "AGL"}
    raise ValueError(s)

def sectors(lines, names):
    """Bloecke 'NAME' -> Teile mit Polygon und Hoehen"""
    out, cur, buf = {}, None, []
    def flush():
        if cur and buf:
            txt = "\n".join(buf)
            vm = re.search(r"\n\s*((?:FL\d+|\d+ FT (?:AMSL|AGL)|GND)) / ((?:FL\d+|\d+ FT (?:AMSL|AGL)|GND))", txt)
            if vm:
                out[cur].append({"hi": limit(vm.group(1)), "lo": limit(vm.group(2)), "c": polygon(txt[:vm.start()])})
    for ln in lines:
        s = ln.strip()
        if s in names:
            flush(); buf = []; cur = s; out[cur] = []; continue
        if cur is None: continue
        if re.match(r"(TEIL \d+ / PART \d+|vereint mit TEIL \d+ / merged with PART \d+)\b", s):
            flush(); buf = []; continue
        if re.match(r"^(ACC|APP|FIC) WIEN", s) and s not in names: flush(); cur = None; buf = []; continue
        if "Austro Control" in s or "LUFTFAHRTHANDBUCH" in s or "AIP AUSTRIA" in s or re.match(r"ENR 2\.2-\d+|\d{2} [A-Z]{3} \d{4}$|AIRAC AMDT", s): continue
        buf.append(ln[:110])
    flush()
    return out

L22 = open(ENR22).read().split("\n")
i5 = next(i for i, l in enumerate(L22) if l.startswith("5. FLUGVERKEHRSKONTROLLSEKTOREN"))
i6 = next(i for i, l in enumerate(L22) if l.startswith("6. FLUGINFORMATIONSDIENSTSEKTOREN"))
i7 = next(i for i, l in enumerate(L22) if l.startswith("7. LUFTRAUM MIT FREIER"))
APP = sectors(L22[i5:i6], {"APP GRAZ", "APP INNSBRUCK", "APP KLAGENFURT", "APP LINZ", "APP SALZBURG", "APP WIEN"})
FIS = sectors(L22[i6:i7], {"FIC WIEN APPROACH", "FIC WIEN NORTH", "FIC WIEN SOUTH"})   # UPPER erst ab FL660

# RMZ-Frequenzen (Abschnitt 3)
i3 = next(i for i, l in enumerate(L22) if l.startswith("3. ZONEN MIT FUNKKOMMUNIKATIONSPFLICHT"))
i4 = next(i for i, l in enumerate(L22) if l.startswith("4. GRENZ"))
RMZ = {}
for m in re.finditer(r"^(RMZ [A-Z ]+?)\s{2,}.*?([A-Z][A-Z/ ]+ RADIO)?\s+(1[0-3]\d\.\d{3})", "\n".join(L22[i3:i4]), re.M):
    RMZ[m.group(1).strip()] = {"f": m.group(3)}
txt3 = "\n".join(L22[i3:i4])
for name in list(RMZ):   # Rufzeichen steht teils ueber zwei Zeilen
    blk = txt3[txt3.index(name):]
    cs = re.search(r"([A-ZÄÖÜ][A-ZÄÖÜ /]+?)\s+" + re.escape(RMZ[name]["f"]), blk.split("\n")[0])
    nxt = blk.split("\n")[1]
    call = (cs.group(1).split("  ")[-1].strip() if cs else "")
    if "RADIO" not in call and "RADIO" in nxt: call = (call + " RADIO").strip()
    RMZ[name]["call"] = call

# ---------- ENR 2.1: Dienststellen je TMA/CTA, ATS-Frequenzen ----------
L21 = open(ENR21).read().split("\n")
i2 = next(i for i, l in enumerate(L21) if l.startswith("2. ATS-FREQUENZEN"))
starts = [i for i, l in enumerate(L21[:i2]) if re.match(r"^(TMA|CTA) \S+", l)]
CALL = re.compile(r"([A-ZÄÖÜ]+(?: [A-ZÄÖÜ]+)? (?:RADAR|INFORMATION|CONTROL|APPROACH))")
HRS = re.compile(r"\b(H24|\d{4}-\d{4} \(\d{4}-\d{4}\))")
UNITS = {}
for k, i in enumerate(starts):
    j = starts[k + 1] if k + 1 < len(starts) else i2
    name = re.match(r"^((?:TMA|CTA) [A-Z]+(?: \d)?)", L21[i]).group(1).strip()
    right = "\n".join(l[60:] for l in L21[i:j] if not re.search(r"Austro Control|LUFTFAHRTHANDBUCH|AIP AUSTRIA|ENR 2\.1-", l))
    calls, hrs = CALL.findall(right), HRS.findall(right)
    seen, out = set(), []
    for n, c in enumerate(calls):
        if c in seen: continue
        seen.add(c); out.append({"call": c, "h": hrs[n] if n < len(hrs) else ""})
    UNITS[name] = out
FREQ = {}
for l in L21[i2:]:
    m = re.match(r"^(ACC WIEN|FIC WIEN|APP WIEN)\s+(WIEN [A-Z]+)\s+(1\d\d\.\d{3})", l)
    if m: FREQ.setdefault(m.group(1) + "|" + m.group(2), []).append(m.group(3))
    m2 = re.match(r"^\s{40,}(1\d\d\.\d{3})\s*$", l)
    if m2 and "ACC WIEN|WIEN RADAR" in FREQ and len(FREQ) == 1: FREQ["ACC WIEN|WIEN RADAR"].append(m2.group(1))
amdt21 = re.findall(r"AIRAC AMDT (\d+)", open(ENR21).read()); amdt22 = re.findall(r"AIRAC AMDT (\d+)", open(ENR22).read())

out = {"quelle": "AIP Austria ENR 2.1 und ENR 2.2 (Austro Control GmbH), vom Nutzer geliefert; ausgewertet mit tools/aip_lo.py",
       "stand": "ENR 2.1 bis AIRAC AMDT %s, ENR 2.2 bis AIRAC AMDT %s" % (max(map(int, amdt21)), max(map(int, amdt22))),
       "hinweis": "Nicht amtlich verwendbar – vor dem Flug mit gueltiger AIP/ICAO-Karte abgleichen. Grenzabschnitte ca. 1 km genau.",
       "zeiten": "Betriebszeiten UTC Winter (Sommer in Klammern)",
       "units": UNITS, "freq": FREQ, "rmz": RMZ, "app": APP, "fis": FIS}
json.dump(out, open("public/data/aip-lo.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("TMA/CTA:", len(UNITS), "| APP:", {k: len(v) for k, v in APP.items()}, "| FIS:", {k: len(v) for k, v in FIS.items()})
print("FREQ:", {k: (v if len(v) < 4 else str(len(v)) + " Frequenzen") for k, v in FREQ.items()}, "| RMZ:", RMZ, "| Stand:", out["stand"])
