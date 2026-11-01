// The game clock. It is the game's own: every new game and every new sim day starts at 06:00 IST whatever
// the time is in the real world. Speeds are measured against real time: Normal is 2×, so one game minute takes
// 30 real seconds and a full day 12 hours. Everything shares this one clock: flying, taxiing, driving, ground
// services, inspections, repairs, construction and the timetable all keep their real durations on it, so they
// stay in step at every speed.
const IST_MS = 5.5 * 3600e3;

export const DAY_START_H = 6;
// The one dial for how long work takes: 1 = real durations (a 10-minute job takes 10 clock minutes, 5 real
// minutes at Normal). Below about 0.8 aircraft finish early and sit idle until departure.
export const SERVICE_TIME = 1;

// Real seconds or minutes of work → the same unit on the game clock.
export const serviceTime = (real) => real * SERVICE_TIME;

const DAY_START_S = DAY_START_H * 3600;

// Clock seconds per real second.
export const DEFAULT_SPEED = 2;
export const SPEEDS = [
  { value: DEFAULT_SPEED, label: 'Normal', title: 'Normal, 2×: 1 game minute = 30 seconds, a full day = 12 hours' },
  { value: 4, label: '4×', title: '4×: 1 game minute = 15 seconds, a full day = 6 hours' },
  { value: 10, label: '10×', title: '10×: 1 game minute = 6 seconds, a full day = 2 h 24 min' },
  { value: 20, label: '20×', title: '20×: 1 game minute = 3 seconds, a full day = 1 h 12 min' },
  { value: 60, label: '60×', title: '60×: 1 game minute = 1 second, a full day = 24 minutes' },
];

// Which sim day a clock time belongs to (the first day is 0; a day runs 06:00 to 06:00).
export const simDay = (t) => Math.floor((t - DAY_START_S) / 86400);

// Hours since the current sim day started, 0 ≤ h < 24.
export const hoursIntoDay = (t) => (((t - DAY_START_S) % 86400) + 86400) % 86400 / 3600;

// Start time (ms) of a game begun at `now`: today's date in IST, at 06:00 unless a test asks otherwise.
export function gameStart(now = Date.now(), hour = DAY_START_H, minute = 0) {
  const ist = new Date(now + IST_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour, minute) - IST_MS;
}
