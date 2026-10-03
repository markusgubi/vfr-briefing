// Simulierte Datenquellen fuer den Browser-Test (openAIP, Open-Meteo, METAR/TAF).
// Die Werte sind NUR fuer Tests gedacht: Koordinaten grob, Lufträume frei erfunden.
// Wetter-Szenarien: "gut" (hohe Basis), "tief" (Basis ~3500 ft MSL im Gebirge).

const AIRPORTS = {
  AT: [
    { icaoCode: "LOLW", name: "Wels", lat: 48.1833, lon: 14.0408, elev: 1043, type: 2 },
    { icaoCode: "LOWZ", name: "Zell am See", lat: 47.2925, lon: 12.7878, elev: 2470, type: 2 },
    { icaoCode: "LOWL", name: "Linz", lat: 48.2332, lon: 14.1875, elev: 980, type: 3 },
    { icaoCode: "LOWS", name: "Salzburg", lat: 47.7933, lon: 13.0043, elev: 1411, type: 3 },
    { icaoCode: "LOWK", name: "Klagenfurt", lat: 46.6425, lon: 14.3377, elev: 1470, type: 3 },
    { icaoCode: "LOGO", name: "Niederöblarn", lat: 47.4783, lon: 14.0083, elev: 2142, type: 2 },
    { icaoCode: "LOAG", name: "Krems", lat: 48.4464, lon: 15.6342, elev: 1017, type: 2 }
  ],
  SI: [
    { icaoCode: "LJPZ", name: "Portoroz", lat: 45.4734, lon: 13.6150, elev: 7, type: 3 },
    { icaoCode: "LJLJ", name: "Ljubljana", lat: 46.2237, lon: 14.4576, elev: 1273, type: 3 }
  ],
  HR: [
    { icaoCode: "LDSP", name: "Split", lat: 43.5389, lon: 16.2980, elev: 79, type: 3 }
  ]
};
const FREQ = {
  LOWL: [{ value: "118.800", name: "LINZ TOWER", type: 14, primary: true }, { value: "129.625", name: "LINZ RADAR", type: 0 }],
  LOWS: [{ value: "118.100", name: "SALZBURG TOWER", type: 14, primary: true }],
  LJPZ: [{ value: "118.000", name: "PORTOROZ TOWER", type: 14, primary: true }],
  LOLW: [{ value: "123.000", name: "WELS INFO", type: 10, primary: true }]
};

function box(lon0, lat0, lon1, lat1) {
  return { type: "Polygon", coordinates: [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]] };
}
function circle(lon, lat, rNm, n = 24) {
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    ring.push([lon + (rNm / 60) * Math.sin(a) / Math.cos((lat * Math.PI) / 180), lat + (rNm / 60) * Math.cos(a)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}
const ft = (v, ref = 1) => ({ value: v, unit: 1, referenceDatum: ref });
const gnd = { value: 0, unit: 1, referenceDatum: 0 };
let ID = 1;
function asp(name, type, icaoClass, lower, upper, geometry, extra = {}) {
  return { _id: "a" + ID++, name, type, icaoClass, lowerLimit: lower, upperLimit: upper, geometry, country: "AT", ...extra };
}
const AIRSPACES = {
  AT: [
    asp("LINZ CTR", 4, 3, gnd, ft(3500), circle(14.1875, 48.2332, 6)),
    asp("TMA LOWL 1", 7, 3, ft(3500), ft(9500), circle(14.1875, 48.2332, 14)),
    asp("TMA LOWL 2", 7, 3, ft(5500), ft(9500), box(13.2, 47.9, 14.0, 48.4)),
    asp("SALZBURG CTR", 4, 3, gnd, ft(4500), circle(13.0043, 47.7933, 7)),
    asp("LO R 16 TEST", 1, 8, gnd, ft(7000), circle(13.55, 47.75, 4)),
    asp("LOVV FIR", 10, 8, gnd, { value: 660, unit: 6, referenceDatum: 2 }, box(9.5, 46.55, 17.2, 49.1))
  ],
  SI: [
    asp("LJLA FIR", 10, 8, gnd, { value: 660, unit: 6, referenceDatum: 2 }, box(13.3, 45.4, 16.6, 46.55), { country: "SI" }),
    asp("PORTOROZ CTR", 4, 3, gnd, ft(2500), circle(13.615, 45.4734, 5), { country: "SI" })
  ]
};
const REPORTING = {
  SI: [
    { _id: "r1", name: "NIPEL", compulsory: true, country: "SI", lat: 46.55, lon: 14.05, airports: [] },
    { _id: "r2", name: "KOZINA", compulsory: true, country: "SI", lat: 45.60, lon: 13.93, airports: ["apt-LJPZ"] },
    { _id: "r3", name: "TESTX", compulsory: false, country: "SI", lat: 46.55, lon: 15.20, airports: [] }
  ]
};

function aptItem(a, c) {
  return { _id: "apt-" + a.icaoCode, icaoCode: a.icaoCode, name: a.name, country: c, type: a.type,
    geometry: { type: "Point", coordinates: [a.lon, a.lat] }, elevation: { value: a.elev / 3.28084, unit: 0 },
    frequencies: FREQ[a.icaoCode] || [] };
}
function rpItem(r) {
  return { _id: r._id, name: r.name, compulsory: r.compulsory, country: r.country, airports: r.airports,
    geometry: { type: "Point", coordinates: [r.lon, r.lat] } };
}

export function openaip(url) {
  const u = new URL(url), c = u.searchParams.get("country"), kind = u.pathname.split("/").pop();
  let items = [];
  if (kind === "airports") {
    const q = (u.searchParams.get("search") || "").toLowerCase();
    if (c) items = (AIRPORTS[c] || []).map(a => aptItem(a, c));
    else items = Object.entries(AIRPORTS).flatMap(([cc, l]) => l.map(a => aptItem(a, cc))).filter(a => (a.icaoCode + a.name).toLowerCase().includes(q));
  } else if (kind === "airspaces") items = AIRSPACES[c] || [];
  else if (kind === "reporting-points") items = (REPORTING[c] || []).map(rpItem);
  return { items, page: 1, totalPages: 1, nextPage: null };
}

// Open-Meteo: je Punkt Stundenwerte. scenario bestimmt die Wolkenbasis.
export function openmeteo(url, scenario) {
  const u = new URL(url);
  const lats = u.searchParams.get("latitude").split(",").map(Number), lons = u.searchParams.get("longitude").split(",").map(Number);
  const date = u.searchParams.get("start_date");
  if (u.searchParams.get("daily")) {
    const out = lats.map(() => ({ daily: { sunrise: [date + "T06:10"], sunset: [date + "T18:45"] } }));
    return out.length === 1 ? out[0] : out;
  }
  const vars = u.searchParams.get("hourly").split(",");
  const out = lats.map((lat, i) => {
    const lon = lons[i], alpine = lat < 47.75 && lat > 46.6 ? 1 : 0;
    const elevM = alpine ? 900 : 350, hourly = { time: [] };
    for (let h = 0; h < 24; h++) hourly.time.push(date + "T" + String(h).padStart(2, "0") + ":00");
    const low = scenario === "tief" && alpine ? 80 : 10;
    const rh = scenario === "tief" && alpine ? { 950: 80, 925: 85, 850: 96, 800: 98, 700: 90 } : { 950: 60, 925: 55, 850: 50, 800: 45, 700: 40 };
    const gh = { 950: 540, 925: 760, 850: 1480, 800: 1950, 700: 3010 };
    const val = {
      temperature_2m: 15, dew_point_2m: scenario === "tief" && alpine ? 12 : 5, cloud_cover_low: low, cloud_cover_mid: 10,
      visibility: 30000, precipitation: 0, cape: 50, wind_gusts_10m: 12, wind_speed_850hPa: 15, wind_direction_850hPa: 270
    };
    // Szenario "zeit": vor 11 Uhr wie "tief" (Wolken im Gebirge), ab 11 Uhr wie "gut"
    const badRh = { 950: 80, 925: 85, 850: 96, 800: 98, 700: 90 };
    for (const v of vars) {
      const m = v.match(/^(relative_humidity|geopotential_height)_(\d+)hPa$/);
      const x = m ? (m[1] === "relative_humidity" ? rh[m[2]] : gh[m[2]]) : val[v];
      hourly[v] = Array(24).fill(x ?? 0);
      if (scenario === "zeit" && alpine) for (let h = 0; h < 11; h++) {
        if (m && m[1] === "relative_humidity") hourly[v][h] = badRh[m[2]];
        if (v === "cloud_cover_low") hourly[v][h] = 80;
        if (v === "dew_point_2m") hourly[v][h] = 12;
      }
    }
    return { latitude: lat, longitude: lon, elevation: elevM, hourly };
  });
  return out.length === 1 ? out[0] : out;
}
