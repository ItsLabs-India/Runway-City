// Expansion projects: the real airport's pending works as career goals. Costs and build times are
// scaled for gameplay (a real terminal takes years). Effects are read through World getters.
export const PROJECTS = {
  rets: {
    name: 'Rapid-exit taxiways',
    story: 'AAI is building 10 rapid-exit taxiways to lift the runway from 36 to about 45 movements an hour.',
    cost: 9e7, hours: 12, needs: [],
    effect: 'Landing and departure spacing 20 % tighter (36 → 45 movements/h)',
  },
  cat3: {
    name: 'CAT-III landing system',
    story: 'Chennai has only CAT-I landing aids, so smoke and fog cut capacity and force diversions.',
    cost: 14e7, hours: 10, needs: [],
    effect: 'Low-visibility spacing 1.3× instead of 2×',
  },
  hydrant: {
    name: 'Fuel hydrant system',
    story: 'Fuel arrives by tanker truck today; a hydrant network would speed up refuelling.',
    cost: 6e7, hours: 8, needs: [],
    effect: 'Refuelling 30 % faster, +6 dispensers',
  },
  t3: {
    name: 'Terminal 3 (phase 2)',
    story: 'The next phase of the new integrated terminal: more counters, lanes and new jet bridges (8 in real life).',
    cost: 30e7, hours: 36, needs: [],
    effect: 'Opens Terminal 3 with 3 new jet-bridge stands on this map',
  },
  t5: {
    name: 'Terminal 5',
    story: 'After the Parandur airport was cancelled in August 2026, a Terminal 5 on the north-west side is planned.',
    cost: 60e7, hours: 72, needs: ['t3'],
    effect: 'Opens Terminal 5 (about 20 million passengers a year in real life)',
  },
};

export const freshProjects = () => Object.fromEntries(Object.keys(PROJECTS).map((k) => [k, { state: 'idle', finishAt: 0, startedAt: 0 }]));
