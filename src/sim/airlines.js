// Airlines serving Chennai (MAA) and their typical fleet here, as plain factual text only
// (no logos or liveries). Shares follow the research notes: IndiGo flies ~65 % of departures.
export const DOMESTIC_AIRLINES = [
  { code: '6E', name: 'IndiGo', callsign: 'IFLY', weight: 65, fleet: { A20N: 0.55, A21N: 0.3, AT76: 0.15 }, intlShare: 0.12, intl: ['DXB', 'SIN', 'CMB', 'KUL', 'DOH', 'MCT', 'BKK', 'AUH', 'KWI', 'JED'] },
  { code: 'AI', name: 'Air India', callsign: 'AIR INDIA', weight: 9, fleet: { A20N: 0.52, A21N: 0.38, B788: 0.1 }, intlShare: 0, intl: [] },
  { code: 'IX', name: 'Air India Express', callsign: 'EXPRESS INDIA', weight: 8, fleet: { B738: 0.7, B38M: 0.3 }, intlShare: 0.35, intl: ['DXB', 'SIN', 'MCT', 'SHJ', 'KUL'] },
  { code: 'SG', name: 'SpiceJet', callsign: 'SPICEJET', weight: 4, fleet: { B38M: 0.45, B738: 0.3, DH8D: 0.25 }, intlShare: 0.1, intl: ['DXB', 'CMB'] },
  { code: 'QP', name: 'Akasa Air', callsign: 'AKASA AIR', weight: 4, fleet: { B38M: 1 }, intlShare: 0, intl: [] },
  { code: '9I', name: 'Alliance Air', callsign: 'ALLIED', weight: 2, fleet: { AT76: 1 }, intlShare: 0, intl: [] },
];

// Foreign airlines: destinations, type and roughly how many rotations a day; arrival bank hours (IST).
export const FOREIGN_AIRLINES = [
  { code: 'EK', name: 'Emirates', callsign: 'EMIRATES', dest: ['DXB'], type: 'B77W', perDay: 3, banks: [2.7, 9.3, 21.2] },
  { code: 'QR', name: 'Qatar Airways', callsign: 'QATARI', dest: ['DOH'], type: 'B788', perDay: 2, banks: [2.2, 19.6] },
  { code: 'EY', name: 'Etihad', callsign: 'ETIHAD', dest: ['AUH'], type: 'B789', perDay: 2, banks: [2.9, 13.4] },
  { code: 'SQ', name: 'Singapore Airlines', callsign: 'SINGAPORE', dest: ['SIN'], type: 'A359', perDay: 2, banks: [10.4, 22.6] },
  { code: 'LH', name: 'Lufthansa', callsign: 'LUFTHANSA', dest: ['FRA'], type: 'A343', perDay: 1, banks: [23.6] },
  { code: 'BA', name: 'British Airways', callsign: 'SPEEDBIRD', dest: ['LHR'], type: 'B789', perDay: 1, banks: [4.6] },
  { code: 'UL', name: 'SriLankan Airlines', callsign: 'SRILANKAN', dest: ['CMB'], type: 'A20N', perDay: 3, banks: [8.1, 13.8, 20.3] },
  { code: 'MH', name: 'Malaysia Airlines', callsign: 'MALAYSIAN', dest: ['KUL'], type: 'B738', perDay: 2, banks: [9.7, 23.1] },
  { code: 'TG', name: 'Thai Airways', callsign: 'THAI', dest: ['BKK'], type: 'A20N', perDay: 1, banks: [23.9] },
  { code: 'FZ', name: 'flydubai', callsign: 'SKYDUBAI', dest: ['DXB'], type: 'B38M', perDay: 1, banks: [4.1] },
  { code: 'G9', name: 'Air Arabia', callsign: 'ARABIA', dest: ['SHJ'], type: 'A20N', perDay: 2, banks: [3.4, 15.2] },
  { code: 'WY', name: 'Oman Air', callsign: 'OMAN', dest: ['MCT'], type: 'B38M', perDay: 1, banks: [1.6] },
  { code: 'GF', name: 'Gulf Air', callsign: 'GULF AIR', dest: ['BAH'], type: 'A20N', perDay: 1, banks: [3.1] },
  { code: 'KU', name: 'Kuwait Airways', callsign: 'KUWAITI', dest: ['KWI'], type: 'A20N', perDay: 1, banks: [5.2] },
  { code: 'SV', name: 'Saudia', callsign: 'SAUDIA', dest: ['JED', 'RUH'], type: 'A20N', perDay: 1, banks: [6.3] },
];

// Freighters at Chennai's cargo terminal: the overnight domestic express network (Blue Dart, Quikjet,
// IndiGo CarGo) and the Gulf / European wide-body freighters. perDay may be a fraction (a few times a
// week). banks: arrival hours (IST); ground: hours on the stand [min, max]; nums: flight-number range.
export const CARGO_AIRLINES = [
  { code: 'BZ', name: 'Blue Dart Aviation', callsign: 'BLUE DART', type: 'B738', perDay: 3, intl: false, dest: ['DEL', 'BOM', 'CCU', 'HYD'], banks: [0.6, 1.7, 3.1], ground: [2, 3.5], nums: [100, 900] },
  { code: 'QO', name: 'Quikjet Cargo', callsign: 'QUIKJET', type: 'B738', perDay: 1, intl: false, dest: ['DEL', 'BOM'], banks: [2.4], ground: [2, 4], nums: [4000, 4900] },
  { code: '6E', name: 'IndiGo CarGo', callsign: 'IFLY', type: 'A21N', perDay: 1, intl: false, dest: ['DEL', 'BOM', 'CCU'], banks: [1.2], ground: [2, 4], nums: [8000, 8900] },
  { code: '9I', name: 'Alliance Air Cargo', callsign: 'ALLIED', type: 'AT76', perDay: 0.5, intl: false, dest: ['IXZ', 'IXM'], banks: [6.5], ground: [1.5, 2.5], nums: [8400, 8600] },
  { code: 'QR', name: 'Qatar Airways Cargo', callsign: 'QATARI', type: 'B77F', perDay: 1, intl: true, dest: ['DOH'], banks: [5.4], ground: [3, 5], nums: [8000, 8900] },
  { code: 'EK', name: 'Emirates SkyCargo', callsign: 'EMIRATES', type: 'B77F', perDay: 0.6, intl: true, dest: ['DXB'], banks: [14.2], ground: [3, 5], nums: [9000, 9900] },
  { code: 'EY', name: 'Etihad Cargo', callsign: 'ETIHAD', type: 'B77F', perDay: 0.4, intl: true, dest: ['AUH'], banks: [17.5], ground: [3, 5], nums: [9000, 9900] },
  { code: 'LH', name: 'Lufthansa Cargo', callsign: 'LUFTHANSA', type: 'B77F', perDay: 0.4, intl: true, dest: ['FRA'], banks: [11.3], ground: [3, 5], nums: [8000, 8900] },
  { code: 'TK', name: 'Turkish Cargo', callsign: 'TURKISH', type: 'B77F', perDay: 0.4, intl: true, dest: ['IST'], banks: [20.4], ground: [3, 5], nums: [6000, 6900] },
];

// General aviation: business jets and turboprops of Indian charter operators, companies and private
// owners (registrations VT-xxx). Type mix, movements a day, where they come from and hours on the ground.
export const GENERAL_AVIATION = {
  perDay: 6,
  fleet: { B350: 0.4, C56X: 0.35, CL60: 0.25 },
  dest: [['BLR', 3], ['BOM', 3], ['DEL', 3], ['HYD', 2], ['COK', 1], ['CJB', 1], ['IXM', 1], ['GOI', 1], ['PNQ', 1]],
  hours: [6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18], // arrivals: business hours
  ground: [1, 9], // hours; a quarter stay overnight
};

// Domestic destinations with relative frequency weight; `short` marks turboprop-friendly routes.
export const DOMESTIC_DEST = [
  ['DEL', 'Delhi', 12], ['BOM', 'Mumbai', 11], ['HYD', 'Hyderabad', 7], ['CCU', 'Kolkata', 6], ['BLR', 'Bengaluru', 4, true],
  ['COK', 'Kochi', 3], ['IXM', 'Madurai', 3, true], ['CJB', 'Coimbatore', 3, true], ['PNQ', 'Pune', 3], ['AMD', 'Ahmedabad', 3],
  ['TRV', 'Thiruvananthapuram', 2], ['TRZ', 'Tiruchirappalli', 2, true], ['GOI', 'Goa', 2], ['JAI', 'Jaipur', 2], ['LKO', 'Lucknow', 2],
  ['GAU', 'Guwahati', 2], ['VTZ', 'Visakhapatnam', 2], ['BBI', 'Bhubaneswar', 2], ['IXZ', 'Port Blair', 2], ['IXE', 'Mangaluru', 1, true],
  ['TCR', 'Thoothukudi', 1, true], ['SXV', 'Salem', 1, true], ['VGA', 'Vijayawada', 1, true], ['RJA', 'Rajahmundry', 1, true],
  ['PAT', 'Patna', 1], ['VNS', 'Varanasi', 1], ['NAG', 'Nagpur', 1], ['IDR', 'Indore', 1], ['IXJ', 'Jammu', 1], ['SXR', 'Srinagar', 1],
];

export const INTL_CITY = {
  MAA: 'Chennai', DXB: 'Dubai', DOH: 'Doha', AUH: 'Abu Dhabi', SIN: 'Singapore', FRA: 'Frankfurt', LHR: 'London Heathrow', CMB: 'Colombo',
  KUL: 'Kuala Lumpur', BKK: 'Bangkok', SHJ: 'Sharjah', MCT: 'Muscat', BAH: 'Bahrain', KWI: 'Kuwait', JED: 'Jeddah', RUH: 'Riyadh',
  IST: 'Istanbul',
};

export const cityName = (code) => INTL_CITY[code] ?? DOMESTIC_DEST.find((d) => d[0] === code)?.[1] ?? code;

// Airport positions (latitude, longitude), for route distances.
export const AIRPORTS = {
  MAA: [12.994, 80.171], DEL: [28.556, 77.1], BOM: [19.089, 72.868], HYD: [17.24, 78.43], CCU: [22.655, 88.447], BLR: [13.199, 77.706], COK: [10.152, 76.402],
  IXM: [9.835, 78.093], CJB: [11.03, 77.044], PNQ: [18.582, 73.92], AMD: [23.077, 72.634], TRV: [8.482, 76.92], TRZ: [10.765, 78.709], GOI: [15.38, 73.831],
  JAI: [26.824, 75.812], LKO: [26.761, 80.889], GAU: [26.106, 91.586], VTZ: [17.721, 83.225], BBI: [20.244, 85.818], IXZ: [11.641, 92.73], IXE: [12.961, 74.89],
  TCR: [8.724, 78.026], SXV: [11.783, 78.066], VGA: [16.53, 80.797], RJA: [17.11, 81.82], PAT: [25.591, 85.088], VNS: [25.452, 82.86], NAG: [21.092, 79.047],
  IDR: [22.722, 75.801], IXJ: [32.689, 74.838], SXR: [33.987, 74.774],
  DXB: [25.253, 55.366], DOH: [25.273, 51.608], AUH: [24.433, 54.651], SIN: [1.364, 103.989], FRA: [50.033, 8.571], LHR: [51.47, -0.454], CMB: [7.18, 79.884],
  KUL: [2.746, 101.71], BKK: [13.69, 100.75], SHJ: [25.329, 55.517], MCT: [23.593, 58.284], BAH: [26.271, 50.634], KWI: [29.226, 47.969], JED: [21.68, 39.156], RUH: [24.958, 46.699],
  IST: [41.262, 28.742],
};

// Great-circle distance between two airports in kilometres, or null if one is unknown.
export function distanceKm(a, b) {
  const p = AIRPORTS[a];
  const q = AIRPORTS[b];
  if (!p || !q) return null;
  const rad = Math.PI / 180;
  const dLat = (q[0] - p[0]) * rad;
  const dLon = (q[1] - p[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * rad) * Math.cos(q[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
