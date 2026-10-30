// Aircraft types by ICAO type code, with real published dimensions in metres (manufacturer airport
// planning documents; positions are approximate to about half a metre). MTOW in tonnes.
//
// Positions along the aircraft are "distance from the nose tip" (nose = 0), the way plan drawings
// give them. src/sim/airframe.js turns this into the geometry that both the drawing and the
// collision footprints use, so what you see is what the simulation collides.
//
//   width        fuselage diameter           noseGear   nose gear ahead of the centre, fraction of length
//   wheelbase    nose gear to main gear (m)  code       ICAO aerodrome reference code letter (stand size)
//   wing         root = wing leading edge at the fuselage; chords at root / kink / tip; leading-edge
//                sweep in degrees; kink = spanwise position of the trailing-edge break (0..1 of the
//                semi-span); rake = swept-back tip extension; tip = winglet kind
//   stab / fin   horizontal tailplane (root leading edge, span, chords, sweep) and vertical fin
//   nacelle      engine pod: d = diameter, len, y = spanwise position(s), fwd = how far the inlet sits
//                ahead of the wing leading edge, chevrons = serrated exhaust, prop = propeller diameter
//                rear = engines on the rear fuselage (business jets): x = inlet position from the nose,
//                y = sideways offset of the pod centre
//   doors/exits  passenger-door and overwing-exit positions (for the drawing)
//   freighter    no cabin windows; freightT = maximum payload in tonnes (cargo flights use it for the
//                tonnage; passenger types flown as converted freighters have it too)
export const AIRCRAFT_TYPES = {
  AT76: {
    name: 'ATR 72-600', maker: 'ATR', engineModel: 'Pratt & Whitney Canada PW127M', props: true, engines: 2,
    length: 27.17, span: 27.05, width: 2.87, mtow: 23, seats: 72, wake: 'M', code: 'C', turnMin: 25, approachKt: 115, rotateKt: 105,
    noseGear: 0.39, wheelbase: 10.8,
    wing: { root: 11.2, rootChord: 2.75, tipChord: 1.55, sweep: 3, tip: null, highWing: true },
    stab: { root: 23.2, span: 7.3, rootChord: 1.9, tipChord: 1.25, sweep: 8 },
    fin: { le: 20.8, te: 25.6, tTail: true },
    nose: 3.2, tailCone: 7.0, tailEnd: 0.28,
    nacelle: { d: 0.95, len: 5.3, y: 4.1, fwd: 2.2, prop: 3.93, blades: 6 },
    doors: [3.9, 22.6], exits: [], freightT: 8.9, // ATR 72-600F
  },
  DH8D: {
    name: 'De Havilland Dash 8-400', maker: 'De Havilland Canada', engineModel: 'Pratt & Whitney Canada PW150A', props: true, engines: 2,
    length: 32.83, span: 28.42, width: 2.69, mtow: 29.3, seats: 78, wake: 'M', code: 'C', turnMin: 25, approachKt: 118, rotateKt: 108,
    noseGear: 0.378, wheelbase: 12.75,
    wing: { root: 12.8, rootChord: 3.25, tipChord: 1.35, sweep: 3, tip: null, highWing: true },
    stab: { root: 28.4, span: 9.8, rootChord: 2.2, tipChord: 1.4, sweep: 8 },
    fin: { le: 25.4, te: 31.4, tTail: true },
    nose: 3.6, tailCone: 8.0, tailEnd: 0.3,
    nacelle: { d: 1.1, len: 6.0, y: 5.5, fwd: 2.6, prop: 4.11, blades: 6 },
    doors: [4.0, 27.2], exits: [],
  },
  A20N: {
    name: 'Airbus A320neo', maker: 'Airbus', engineModel: 'CFM LEAP-1A', engines: 2,
    length: 37.57, span: 35.8, width: 3.95, mtow: 79, seats: 186, wake: 'M', code: 'C', turnMin: 40, approachKt: 135, rotateKt: 145,
    noseGear: 0.375, wheelbase: 12.6,
    wing: { root: 13.6, rootChord: 5.9, kink: 0.34, kinkChord: 3.7, tipChord: 1.45, sweep: 28, tip: { kind: 'sharklet', chord: 1.5 } },
    stab: { root: 29.3, span: 12.45, rootChord: 3.6, tipChord: 1.2, sweep: 29 },
    fin: { le: 26.6, te: 34.2 },
    nose: 5.0, tailCone: 8.6, tailEnd: 0.5,
    nacelle: { d: 2.3, len: 4.4, y: 5.75, fwd: 2.4 },
    doors: [6.4, 32.0], exits: [18.8, 20.2],
  },
  B738: {
    name: 'Boeing 737-800', maker: 'Boeing', engineModel: 'CFM56-7B', engines: 2,
    length: 39.5, span: 35.8, width: 3.76, mtow: 79, seats: 189, wake: 'M', code: 'C', turnMin: 40, approachKt: 140, rotateKt: 150,
    noseGear: 0.376, wheelbase: 15.6,
    wing: { root: 15.0, rootChord: 6.8, kink: 0.33, kinkChord: 4.1, tipChord: 1.6, sweep: 27, tip: { kind: 'blended', chord: 1.7 } },
    stab: { root: 31.6, span: 14.35, rootChord: 3.7, tipChord: 1.3, sweep: 33 },
    fin: { le: 28.4, te: 36.4 },
    nose: 5.3, tailCone: 9.0, tailEnd: 0.5,
    nacelle: { d: 1.95, len: 4.5, y: 5.7, fwd: 2.0, flat: true },
    doors: [5.7, 34.0], exits: [19.6, 21.0], freightT: 23.9, // 737-800BCF
  },
  B38M: {
    name: 'Boeing 737 MAX 8', maker: 'Boeing', engineModel: 'CFM LEAP-1B', engines: 2,
    length: 39.52, span: 35.92, width: 3.76, mtow: 82.2, seats: 189, wake: 'M', code: 'C', turnMin: 40, approachKt: 140, rotateKt: 150,
    noseGear: 0.376, wheelbase: 15.6,
    wing: { root: 15.0, rootChord: 6.8, kink: 0.33, kinkChord: 4.1, tipChord: 1.6, sweep: 27, tip: { kind: 'split', chord: 2.2 } },
    stab: { root: 31.6, span: 14.35, rootChord: 3.7, tipChord: 1.3, sweep: 33 },
    fin: { le: 28.4, te: 36.4 },
    nose: 5.3, tailCone: 9.0, tailEnd: 0.5,
    nacelle: { d: 2.1, len: 4.4, y: 5.7, fwd: 2.2, chevrons: true, flat: true },
    doors: [5.7, 34.0], exits: [19.6, 21.0],
  },
  A21N: {
    name: 'Airbus A321neo', maker: 'Airbus', engineModel: 'CFM LEAP-1A', engines: 2,
    length: 44.51, span: 35.8, width: 3.95, mtow: 97, seats: 222, wake: 'M', code: 'C', turnMin: 45, approachKt: 140, rotateKt: 155,
    noseGear: 0.394, wheelbase: 16.9,
    wing: { root: 16.3, rootChord: 5.9, kink: 0.34, kinkChord: 3.7, tipChord: 1.45, sweep: 28, tip: { kind: 'sharklet', chord: 1.5 } },
    stab: { root: 36.0, span: 12.45, rootChord: 3.6, tipChord: 1.2, sweep: 29 },
    fin: { le: 33.3, te: 40.9 },
    nose: 5.0, tailCone: 8.6, tailEnd: 0.5,
    nacelle: { d: 2.3, len: 4.4, y: 5.75, fwd: 2.4 },
    doors: [6.4, 38.8], exits: [20.4, 21.8, 27.0, 28.4], freightT: 27.9, // A321P2F
  },
  B788: {
    name: 'Boeing 787-8', maker: 'Boeing', engineModel: 'GEnx-1B / Trent 1000', engines: 2,
    length: 56.72, span: 60.12, width: 5.77, mtow: 227.9, seats: 242, wake: 'H', code: 'E', turnMin: 80, approachKt: 140, rotateKt: 155,
    noseGear: 0.341, wheelbase: 22.3,
    wing: { root: 21.4, rootChord: 10.6, kink: 0.3, kinkChord: 6.6, tipChord: 1.9, sweep: 32, rake: { frac: 0.08, extra: 22 }, tip: { kind: 'raked' } },
    stab: { root: 45.6, span: 18.26, rootChord: 6.0, tipChord: 2.1, sweep: 34 },
    fin: { le: 42.0, te: 54.2 },
    nose: 8.0, tailCone: 14.0, tailEnd: 0.7,
    nacelle: { d: 3.0, len: 5.8, y: 9.3, fwd: 3.4, chevrons: true },
    doors: [7.8, 15.4, 42.0, 51.6], exits: [23.2],
  },
  B789: {
    name: 'Boeing 787-9', maker: 'Boeing', engineModel: 'GEnx-1B / Trent 1000', engines: 2,
    length: 62.81, span: 60.12, width: 5.77, mtow: 254, seats: 290, wake: 'H', code: 'E', turnMin: 90, approachKt: 145, rotateKt: 160,
    noseGear: 0.347, wheelbase: 25.9,
    wing: { root: 24.6, rootChord: 10.6, kink: 0.3, kinkChord: 6.6, tipChord: 1.9, sweep: 32, rake: { frac: 0.08, extra: 22 }, tip: { kind: 'raked' } },
    stab: { root: 51.6, span: 18.26, rootChord: 6.0, tipChord: 2.1, sweep: 34 },
    fin: { le: 48.0, te: 60.2 },
    nose: 8.0, tailCone: 14.0, tailEnd: 0.7,
    nacelle: { d: 3.0, len: 5.8, y: 9.3, fwd: 3.4, chevrons: true },
    doors: [7.8, 15.4, 48.0, 57.6], exits: [26.0],
  },
  A359: {
    name: 'Airbus A350-900', maker: 'Airbus', engineModel: 'Rolls-Royce Trent XWB-84', engines: 2,
    length: 66.8, span: 64.75, width: 5.96, mtow: 283, seats: 315, wake: 'H', code: 'E', turnMin: 90, approachKt: 145, rotateKt: 160,
    noseGear: 0.358, wheelbase: 28.6,
    wing: { root: 26.2, rootChord: 11.4, kink: 0.32, kinkChord: 7.0, tipChord: 2.0, sweep: 32, rake: { frac: 0.1, extra: 14 }, tip: { kind: 'curved', chord: 1.6 } },
    stab: { root: 56.2, span: 17.05, rootChord: 5.6, tipChord: 1.8, sweep: 35 },
    fin: { le: 51.8, te: 64.2 },
    nose: 8.4, tailCone: 14.0, tailEnd: 0.7,
    nacelle: { d: 3.4, len: 6.2, y: 10.5, fwd: 3.6, chevrons: true },
    doors: [8.0, 16.0, 49.0, 60.0], exits: [28.0],
  },
  A343: {
    name: 'Airbus A340-300', maker: 'Airbus', engineModel: 'CFM56-5C', engines: 4,
    length: 63.69, span: 60.3, width: 5.64, mtow: 276.5, seats: 295, wake: 'H', code: 'E', turnMin: 90, approachKt: 145, rotateKt: 160,
    noseGear: 0.367, wheelbase: 25.4,
    wing: { root: 25.4, rootChord: 11.0, kink: 0.34, kinkChord: 7.0, tipChord: 2.3, sweep: 31, tip: { kind: 'blended', chord: 2.2 } },
    stab: { root: 54.2, span: 18.5, rootChord: 5.5, tipChord: 1.9, sweep: 33 },
    fin: { le: 50.0, te: 61.0 },
    nose: 8.4, tailCone: 13.0, tailEnd: 0.7,
    nacelle: { d: 2.4, len: 5.3, y: [10.0, 18.3], fwd: 3.0, flat: false },
    doors: [7.4, 15.0, 47.0, 56.0], exits: [26.0],
  },
  B77W: {
    name: 'Boeing 777-300ER', maker: 'Boeing', engineModel: 'GE90-115B', engines: 2,
    length: 73.86, span: 64.8, width: 6.2, mtow: 351.5, seats: 360, wake: 'H', code: 'E', turnMin: 100, approachKt: 150, rotateKt: 165,
    noseGear: 0.365, wheelbase: 31.2,
    wing: { root: 29.2, rootChord: 13.6, kink: 0.36, kinkChord: 8.4, tipChord: 2.3, sweep: 35, rake: { frac: 0.07, extra: 20 }, tip: { kind: 'raked' } },
    stab: { root: 62.4, span: 21.3, rootChord: 7.0, tipChord: 2.5, sweep: 36 },
    fin: { le: 58.4, te: 71.4 },
    nose: 9.0, tailCone: 15.0, tailEnd: 0.9,
    nacelle: { d: 4.0, len: 7.2, y: 10.6, fwd: 3.8, chevrons: false },
    doors: [8.6, 17.0, 29.0, 53.0, 62.0], exits: [34.0],
  },
  // 777 Freighter: the 777-200LR airframe (10.1 m shorter than the -300ER: plugs ahead of and behind
  // the wing), same wing and GE90 engines, one crew door and no cabin windows.
  B77F: {
    name: 'Boeing 777 Freighter', maker: 'Boeing', engineModel: 'GE90-110B1', engines: 2,
    length: 63.73, span: 64.8, width: 6.2, mtow: 347.8, seats: 0, wake: 'H', code: 'E', turnMin: 120, approachKt: 149, rotateKt: 165,
    noseGear: 0.359, wheelbase: 25.9,
    wing: { root: 23.9, rootChord: 13.6, kink: 0.36, kinkChord: 8.4, tipChord: 2.3, sweep: 35, rake: { frac: 0.07, extra: 20 }, tip: { kind: 'raked' } },
    stab: { root: 52.3, span: 21.3, rootChord: 7.0, tipChord: 2.5, sweep: 36 },
    fin: { le: 48.3, te: 61.3 },
    nose: 9.0, tailCone: 15.0, tailEnd: 0.9,
    nacelle: { d: 4.0, len: 7.2, y: 10.6, fwd: 3.8, chevrons: false },
    doors: [8.6], exits: [], freighter: true, freightT: 102,
  },

  // ---- General aviation ----------------------------------------------------------------------------
  B350: {
    name: 'Beechcraft King Air 350', maker: 'Textron Aviation', engineModel: 'Pratt & Whitney Canada PT6A-60A', props: true, engines: 2,
    length: 14.22, span: 17.65, width: 1.6, mtow: 6.8, seats: 9, wake: 'L', code: 'B', turnMin: 20, approachKt: 100, rotateKt: 95,
    noseGear: 0.366, wheelbase: 4.9,
    wing: { root: 5.4, rootChord: 2.2, tipChord: 1.0, sweep: 2, tip: null },
    stab: { root: 12.4, span: 5.6, rootChord: 1.5, tipChord: 0.9, sweep: 15 },
    fin: { le: 10.9, te: 14.0, tTail: true },
    nose: 1.7, tailCone: 4.0, tailEnd: 0.15,
    nacelle: { d: 0.75, len: 4.0, y: 2.6, fwd: 1.6, prop: 2.67, blades: 4 },
    doors: [10.3], exits: [],
  },
  C56X: {
    name: 'Cessna Citation XLS+', maker: 'Textron Aviation', engineModel: 'Pratt & Whitney Canada PW545C', engines: 2,
    length: 15.98, span: 17.17, width: 1.7, mtow: 9.2, seats: 9, wake: 'L', code: 'B', turnMin: 20, approachKt: 115, rotateKt: 110,
    noseGear: 0.344, wheelbase: 6.3,
    wing: { root: 5.9, rootChord: 2.6, tipChord: 1.1, sweep: 4, tip: null },
    stab: { root: 13.2, span: 6.4, rootChord: 1.5, tipChord: 0.8, sweep: 22 },
    fin: { le: 11.9, te: 15.6 },
    nose: 2.4, tailCone: 4.0, tailEnd: 0.2,
    nacelle: { rear: true, x: 10.0, d: 1.0, len: 2.9, y: 1.55 },
    doors: [2.9], exits: [],
  },
  CL60: {
    name: 'Bombardier Challenger 650', maker: 'Bombardier', engineModel: 'GE CF34-3B', engines: 2,
    length: 20.86, span: 19.61, width: 2.69, mtow: 21.9, seats: 12, wake: 'M', code: 'B', turnMin: 25, approachKt: 125, rotateKt: 125,
    noseGear: 0.356, wheelbase: 8.0,
    wing: { root: 7.9, rootChord: 3.9, tipChord: 1.1, sweep: 28, tip: { kind: 'blended', chord: 0.9 } },
    stab: { root: 18.0, span: 6.2, rootChord: 2.0, tipChord: 1.0, sweep: 35 },
    fin: { le: 15.6, te: 20.1, tTail: true },
    nose: 3.0, tailCone: 5.0, tailEnd: 0.3,
    nacelle: { rear: true, x: 13.4, d: 1.35, len: 3.9, y: 2.3 },
    doors: [3.6], exits: [],
  },
};

export const CODE_RANK = { A: -1, B: 0, C: 1, D: 2, E: 3, F: 4 };

// Neutral tail colours for generic liveries (deliberately not any airline's brand colours).
export const GENERIC_TAILS = ['#3d6fa8', '#5b8c5a', '#8a5a9e', '#c0803a', '#4b8f9a', '#a54b4b', '#6a6f78'];
