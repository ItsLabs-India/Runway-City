// The game clock and how long work takes on it. The clock is the game's own: every new game and every
// new sim day starts at 06:00 IST whatever the time is in the real world, and at 1× it ticks one second
// per real second. Movement (flying, taxiing, driving, walking) happens at real speed on that clock; work
// (ground services, inspections, repairs) takes SERVICE_TIME of its real duration: 10 minutes become 3.
const IST_MS = 5.5 * 3600e3;

export const DAY_START_H = 6;
export const SERVICE_TIME = 0.3;

// Real seconds or minutes of work → the same unit on the game clock.
export const serviceTime = (real) => real * SERVICE_TIME;

const DAY_START_S = DAY_START_H * 3600;

// Which sim day a clock time belongs to (the first day is 0; a day runs 06:00 to 06:00).
export const simDay = (t) => Math.floor((t - DAY_START_S) / 86400);

// Hours since the current sim day started, 0 ≤ h < 24.
export const hoursIntoDay = (t) => (((t - DAY_START_S) % 86400) + 86400) % 86400 / 3600;

// Start time (ms) of a game begun at `now`: today's date in IST, at 06:00 unless a test asks otherwise.
export function gameStart(now = Date.now(), hour = DAY_START_H, minute = 0) {
  const ist = new Date(now + IST_MS);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hour, minute) - IST_MS;
}
