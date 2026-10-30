// Real airline identity for everything the game shows: corporate group, alliance, business model,
// brand colours and a simple top-down livery. Pure data (no DOM), used by the sim, the drawing and the UI.
//
// Colours are close approximations of each airline's public brand palette, picked so tails and
// stripes read correctly from above; edit this one file to adjust them. Official logos are
// trademarks and are not bundled: the game draws a monogram badge in the airline's colours, and
// shows an official logo instead whenever you drop one in public/data/logos/ (see README).
//
//   group      who owns / operates it          alliance   Star Alliance, Oneworld, SkyTeam or null
//   kind       lcc | full | regional | cargo | ga   region home region, for grouping
//   icao       callsign prefix of the real airline (used to recognise Live Watch aircraft)
//   primary    main brand colour (tail)        secondary  accent colour (stripe, badge text)
//   livery     fin / stripe / engine / tips: colours of each part of the aircraft; fin2 adds a second
//              colour to the rear half of the fin; rear (default on) paints the tail cone in the fin
//              colour, which is what makes an airline recognisable from straight above
const B = (code, name, short, icao, group, alliance, kind, region, primary, secondary, livery = {}) =>
  [code, { code, name, short, icao, group, alliance, kind, region, primary, secondary, livery: { fin: primary, stripe: primary, engine: primary, tips: secondary, rear: true, ...livery } }];

export const BRANDS = Object.fromEntries([
  B('6E', 'IndiGo', 'IndiGo', 'IGO', 'IndiGo (InterGlobe)', null, 'lcc', 'India', '#1c3e96', '#ffffff', { tips: '#1c3e96' }),
  B('AI', 'Air India', 'Air India', 'AIC', 'Air India Group (Tata)', 'Star Alliance', 'full', 'India', '#b5173b', '#e8a33d', { fin: '#5b1f4a', fin2: '#b5173b', stripe: '#b5173b', engine: '#5b1f4a', tips: '#e8a33d', rear: true }),
  B('IX', 'Air India Express', 'AI Express', 'AXB', 'Air India Group (Tata)', null, 'lcc', 'India', '#d9262c', '#f5b223', { fin: '#d9262c', fin2: '#f5b223', stripe: '#d9262c', tips: '#f5b223' }),
  B('SG', 'SpiceJet', 'SpiceJet', 'SEJ', 'SpiceJet', null, 'lcc', 'India', '#d61f26', '#ffc20e', { fin: '#d61f26', fin2: '#ffc20e', stripe: '#d61f26', tips: '#ffc20e' }),
  B('QP', 'Akasa Air', 'Akasa Air', 'AKJ', 'Akasa Air', null, 'lcc', 'India', '#ff6b1a', '#5b2a86', { fin: '#ff6b1a', stripe: '#5b2a86', engine: '#ff6b1a', tips: '#5b2a86', rear: true }),
  B('9I', 'Alliance Air', 'Alliance Air', 'LLR', 'Alliance Air (Govt. of India)', null, 'regional', 'India', '#1d4f91', '#e1261c', { fin: '#1d4f91', stripe: '#e1261c', tips: '#e1261c' }),

  B('EK', 'Emirates', 'Emirates', 'UAE', 'The Emirates Group', null, 'full', 'Gulf', '#d71920', '#c9a24b', { fin: '#d71920', stripe: '#c9a24b', engine: '#d71920', tips: '#d71920' }),
  B('QR', 'Qatar Airways', 'Qatar Airways', 'QTR', 'Qatar Airways Group', 'Oneworld', 'full', 'Gulf', '#5c0a2e', '#8a8d8f', { fin: '#5c0a2e', stripe: '#8a8d8f', engine: '#5c0a2e', tips: '#5c0a2e', rear: true }),
  B('EY', 'Etihad', 'Etihad', 'ETD', 'Etihad Aviation Group', null, 'full', 'Gulf', '#bd8b13', '#4a4642', { fin: '#bd8b13', stripe: '#4a4642', engine: '#bd8b13', tips: '#4a4642' }),
  B('FZ', 'flydubai', 'flydubai', 'FDB', 'flydubai (Dubai Govt.)', null, 'lcc', 'Gulf', '#e8472b', '#17325c', { fin: '#e8472b', fin2: '#17325c', stripe: '#17325c', tips: '#17325c' }),
  B('G9', 'Air Arabia', 'Air Arabia', 'ABY', 'Air Arabia', null, 'lcc', 'Gulf', '#e1252b', '#4d4d4d', { fin: '#e1252b', stripe: '#4d4d4d', tips: '#4d4d4d' }),
  B('WY', 'Oman Air', 'Oman Air', 'OMA', 'Oman Air', null, 'full', 'Gulf', '#0b6e78', '#b5122e', { fin: '#0b6e78', fin2: '#b5122e', stripe: '#b5122e', tips: '#b5122e' }),
  B('GF', 'Gulf Air', 'Gulf Air', 'GFA', 'Gulf Air (Bahrain)', null, 'full', 'Gulf', '#c19a28', '#5a4b2b', { fin: '#c19a28', stripe: '#5a4b2b', engine: '#c19a28', tips: '#5a4b2b' }),
  B('KU', 'Kuwait Airways', 'Kuwait Airways', 'KAC', 'Kuwait Airways', null, 'full', 'Gulf', '#0b5e9b', '#f2b705', { fin: '#0b5e9b', fin2: '#f2b705', stripe: '#0b5e9b', tips: '#f2b705' }),
  B('SV', 'Saudia', 'Saudia', 'SVA', 'Saudia Group', 'SkyTeam', 'full', 'Gulf', '#00633a', '#0b8dc4', { fin: '#00633a', fin2: '#0b8dc4', stripe: '#00633a', tips: '#0b8dc4' }),

  B('SQ', 'Singapore Airlines', 'Singapore Air', 'SIA', 'Singapore Airlines Group', 'Star Alliance', 'full', 'South-East Asia', '#14275f', '#f0a800', { fin: '#14275f', stripe: '#14275f', engine: '#14275f', tips: '#f0a800' }),
  B('MH', 'Malaysia Airlines', 'Malaysia Air', 'MAS', 'Malaysia Aviation Group', 'Oneworld', 'full', 'South-East Asia', '#1c3b8c', '#d22630', { fin: '#1c3b8c', fin2: '#d22630', stripe: '#d22630', tips: '#d22630' }),
  B('TG', 'Thai Airways', 'Thai', 'THA', 'Thai Airways', 'Star Alliance', 'full', 'South-East Asia', '#5e2a84', '#d4a12a', { fin: '#5e2a84', fin2: '#d4a12a', stripe: '#d4a12a', tips: '#d4a12a' }),
  B('UL', 'SriLankan Airlines', 'SriLankan', 'ALK', 'SriLankan Airlines', 'Oneworld', 'full', 'South Asia', '#1d2e7c', '#e2261c', { fin: '#1d2e7c', fin2: '#e2261c', stripe: '#e2261c', tips: '#e2261c' }),

  B('LH', 'Lufthansa', 'Lufthansa', 'DLH', 'Lufthansa Group', 'Star Alliance', 'full', 'Europe', '#05164d', '#ffad00', { fin: '#05164d', stripe: '#05164d', engine: '#05164d', tips: '#ffad00' }),
  B('BA', 'British Airways', 'British Airways', 'BAW', 'IAG (International Airlines Group)', 'Oneworld', 'full', 'Europe', '#0b3a7e', '#ce1126', { fin: '#0b3a7e', fin2: '#ce1126', stripe: '#0b3a7e', engine: '#0b3a7e', tips: '#ce1126' }),

  // Cargo-only operators and general aviation (passenger airlines' freighters use their own brand).
  B('BZ', 'Blue Dart Aviation', 'Blue Dart', 'BDA', 'Blue Dart (DHL Group)', null, 'cargo', 'India', '#2b2f8f', '#f4c300', { fin: '#2b2f8f', stripe: '#f4c300', engine: '#2b2f8f', tips: '#f4c300' }),
  B('QO', 'Quikjet Cargo', 'Quikjet', 'FQA', 'Quikjet Airlines', null, 'cargo', 'India', '#0e5aa7', '#f7a823', { fin: '#0e5aa7', stripe: '#0e5aa7', tips: '#f7a823' }),
  B('TK', 'Turkish Airlines', 'Turkish', 'THY', 'Turkish Airlines Group', 'Star Alliance', 'full', 'Europe', '#c8102e', '#ffffff', { fin: '#c8102e', stripe: '#c8102e', engine: '#c8102e', tips: '#c8102e' }),
  B('GA', 'General aviation', 'Private', 'GA_', 'Private and charter operators', null, 'ga', 'India', '#4a5a6a', '#ffffff', { fin: '#4a5a6a', stripe: '#8796a5', engine: '#4a5a6a', tips: '#8796a5', rear: false }),
].map(([k, v]) => [k, v]));

// Airlines that are not in the table (for example from an imported timetable) get a neutral livery.
const FALLBACK = (code) => ({
  code, name: code, short: code, icao: '', group: 'Other airlines', alliance: null, kind: 'full', region: 'Other',
  primary: '#5d6b7a', secondary: '#ffffff', livery: { fin: '#5d6b7a', stripe: '#5d6b7a', engine: '#5d6b7a', tips: '#8e99a5' },
});

export const brandOf = (code) => BRANDS[code] ?? FALLBACK(code);

export const KIND_LABEL = { lcc: 'Low-cost', full: 'Full-service', regional: 'Regional', cargo: 'Cargo', ga: 'General aviation' };
export const ALLIANCES = ['Star Alliance', 'Oneworld', 'SkyTeam'];

// Airline from a real callsign such as "IGO6E123" or "UAE544" (Live Watch aircraft).
const ICAO = Object.fromEntries(Object.values(BRANDS).map((b) => [b.icao, b.code]));
export const airlineFromCallsign = (callsign) => ICAO[(callsign ?? '').slice(0, 3).toUpperCase()] ?? null;

// Readable text colour on a colour: black or white, whichever has the higher contrast.
export function onColour(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#101418' : '#ffffff';
}

// Group airline codes by a key function; entries keep the order of `codes`.
export function groupBy(codes, by) {
  const key = (code) => {
    const b = brandOf(code);
    if (by === 'alliance') return b.alliance ?? 'Not in an alliance';
    if (by === 'group') return b.group;
    if (by === 'kind') return KIND_LABEL[b.kind];
    if (by === 'region') return b.region;
    return 'All airlines';
  };
  const out = new Map();
  for (const code of codes) {
    const k = key(code);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(code);
  }
  return [...out].map(([name, list]) => ({ name, codes: list }));
}

// Aircraft registration made up for the simulation: the airline's country prefix plus letters taken from
// the flight's id (the same flight always shows the same one). Real aircraft are not identified.
const REG = { '6E': 'VT-', AI: 'VT-', IX: 'VT-', SG: 'VT-', QP: 'VT-', '9I': 'VT-', EK: 'A6-E', QR: 'A7-', EY: 'A6-', FZ: 'A6-F', G9: 'A6-A', WY: 'A4O-', GF: 'A9C-', KU: '9K-', SV: 'HZ-', SQ: '9V-S', MH: '9M-M', TG: 'HS-T', UL: '4R-A', LH: 'D-A', BA: 'G-' };
export function registration(code, id) {
  const prefix = REG[code] ?? 'N';
  const need = prefix.endsWith('-') ? 3 : prefix.length >= 4 ? 2 : 3;
  let h = (id * 2654435761) >>> 0;
  let out = '';
  for (let i = 0; i < need; i++) {
    out += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26) + 7 * (i + 1);
  }
  return prefix + out;
}
