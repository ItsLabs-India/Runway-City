// Weather, daylight and lighting for the HUD: the chip in the top bar, the weather card at the top of the
// Operations panel (forecast, effects, light controls) and the weather line of the day report.
import { SPELLS, SEASON_LABEL, seasonOf } from '../sim/weather.js';
import { sunTimes } from '../sim/sky.js';
import { esc } from '../logos.js';

const hhmm = (s) => `${String(Math.floor((s % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;

export function wxIcon(type, night = false) {
  switch (type) {
    case 'clear': return night ? '☾' : '☀';
    case 'fair': return night ? '☾' : '🌤';
    case 'cloudy': return '⛅';
    case 'overcast': return '☁';
    case 'haze': case 'mist': case 'fog': case 'smoke': return '🌫';
    case 'drizzle': case 'rain': return '🌦';
    case 'heavy': return '🌧';
    case 'storm': return '⛈';
    default: return '☁';
  }
}

const phaseIcon = (l) => (l.night ? '🌙' : l.phase === 'Day' ? '☀' : l.sunEl > 0 ? '🌅' : '🌆');
const km = (m) => (m >= 10000 ? '10+ km' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 50) * 50} m`);

// Top bar: icon, temperature, weather, part of the day. Opens the Operations panel.
export function weatherChip(w) {
  const x = w.weather.now;
  const l = w.lights;
  return `<button class="chip-btn" data-action="openTab" data-arg="ops" title="Weather and lighting: ${esc(x.label)}, ${Math.round(x.tempC)} °C, visibility ${km(w.visibility())}, ${esc(l.phase)}">${wxIcon(x.type, l.night)} ${Math.round(x.tempC)}° ${phaseIcon(l)}</button>`;
}

function effects(w) {
  const x = w.weather.now;
  const out = [];
  const rainPct = Math.round((1 - w.fx.ground) * 100);
  if (rainPct >= 3) out.push(`Taxiing ${rainPct} % slower`);
  const rampPct = Math.round((w.fx.ramp - 1) * 100);
  if (rampPct >= 3) out.push(`Ramp work ${rampPct} % slower`);
  if (x.rain > 0.05) out.push(`Landing spacing ×${(1 + 0.12 * x.rain).toFixed(2)} (wet runway)`);
  const vis = w.visibility();
  if (vis < 1200) out.push(`Low-visibility procedures: spacing ×${w.sepScale.toFixed(1)}${w.projects.cat3.state === 'done' ? ' (CAT-III)' : ' (build CAT-III to reduce)'}`);
  if (w.rampClosed) out.push(`Lightning: outdoor ramp work stopped until ${hhmm(w.rampClosedUntil)}`);
  const { head, cross } = w.windComponents();
  if (cross > 15 || head < -5) out.push(`Runway ${w.active}: ${Math.round(head)} kt headwind, ${Math.round(cross)} kt crosswind`);
  if (w.lighting.dark && w.t < w.lighting.dark.until) out.push(`Lighting fault: part of the apron is dark until ${hhmm(w.lighting.dark.until)} (work there 25 % slower)`);
  if (w.lights.night && !w.lights.apron) out.push('Apron floodlights are off in the dark: ramp work 30 % slower');
  return out.length ? out : ['No weather restrictions'];
}

// Weather card for the top of the Operations panel.
export function weatherPanel(w) {
  const x = w.weather.now;
  const l = w.lights;
  const abs = w.clockEpoch + w.t;
  const st = sunTimes(abs);
  const wind = w.wind;
  const season = SEASON_LABEL[seasonOf(w.weather.month)];
  const mode = w.weatherMode;
  const cells = w.weather.forecast(w.t, 12).map((f) => {
    const night = ((f.t % 86400) / 3600 < 6 || (f.t % 86400) / 3600 >= 18.2);
    const h = Math.min(100, Math.round(Math.max(f.rain, f.storm * 0.9) * 100));
    return `<div class="fc ${f.storm > 0.6 ? 'storm' : f.rain > 0.3 ? 'rain' : ''}" title="${esc(f.label)}, ${Math.round(f.tempC)}°C, visibility ${km(f.vis)}"><b>${String(Math.floor((f.t % 86400) / 3600)).padStart(2, '0')}</b><span>${wxIcon(f.type, night)}</span><i style="--h:${h}%"></i><small>${Math.round(f.tempC)}°</small></div>`;
  }).join('');
  const seg = (kind, cur, opts) => opts.map(([v, label]) => `<button data-action="lighting" data-arg="${kind}:${v}" class="${String(cur) === String(v) ? 'on' : ''}">${label}</button>`).join('');
  const nextLine = x.next ? `Next: ${esc(SPELLS[x.next].label.toLowerCase())} from ${hhmm(x.until)}` : '';
  return `
    <h3>Weather</h3>
    <div class="wx-head"><span class="wx-ico">${wxIcon(x.type, l.night)}</span><div><b>${esc(x.label)}, ${Math.round(x.tempC)} °C</b><small>${esc(season)} · ${esc(nextLine)}</small></div>
      <div class="seg"><button data-action="weatherMode" data-arg="random" class="${mode === 'random' ? 'on' : ''}" title="The season decides: rain, fog, storms">Random</button><button data-action="weatherMode" data-arg="calm" class="${mode === 'calm' ? 'on' : ''}" title="No rain, fog or storms">Calm</button></div></div>
    <div class="kpis wx-grid">
      <span>Wind <b>${String(wind.from).padStart(3, '0')}° ${wind.kt} kt${wind.gust ? ` G${wind.gust}` : ''}</b></span><span>Visibility <b>${km(w.visibility())}</b></span>
      <span>Cloud base <b>${x.ceil > 20000 ? 'none' : `${Math.round(x.ceil / 100) * 100} ft`}</b></span><span>Cloud <b>${Math.round(x.cloud * 100)} %</b></span>
      <span>Rain <b>${x.rain > 0.05 ? `${Math.round(x.rain * 100)} %` : 'none'}</b></span><span>QNH <b>${x.qnh}</b></span>
    </div>
    <p class="metar" title="Generated from the simulated weather">${esc(w.weather.metar(w.t, w.wind))}</p>
    <div class="forecast" aria-label="Forecast for the next 12 hours">${cells}</div>
    <ul class="obj fx">${effects(w).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    <h3>Daylight and lighting</h3>
    <div class="kpis wx-grid"><span>${phaseIcon(l)} <b>${esc(l.phase)}</b></span><span>Daylight <b>${Math.round(l.amb * 100)} %</b></span><span>Sunrise <b>${hhmm(st.rise)}</b></span><span>Sunset <b>${hhmm(st.set)}</b></span></div>
    <div class="lightrow"><span class="lbl">Apron floodlights <small>${l.apron ? 'on' : 'off'}</small></span><div class="seg">${seg('apron', w.lighting.apron, [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']])}</div></div>
    <div class="lightrow"><span class="lbl">Runway lights <small>${l.rwyStep ? `step ${l.rwyStep}` : 'off'}${w.t < w.lighting.rwyFaultUntil ? ' · fault' : ''}</small></span><div class="seg">${seg('runway', w.lighting.runway, [['auto', 'Auto'], [2, '2'], [3, '3'], [4, '4'], [5, '5']])}</div></div>
    <p class="muted fine">Taxiway lights ${l.taxi ? 'on' : 'off'} · terminals ${l.terminal ? 'lit' : 'dark'} · electricity ${Math.round(w.lightingCostPerHour() / 100) / 10} thousand rupees an hour. Auto turns lights on at dusk and with the visibility; switching them off in the dark slows the ramp. Faults are likelier at night.</p>`;
}

// Weather line of the day report.
export function reportWeather(d) {
  if (!d) return '';
  const h = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
  const parts = [];
  parts.push(d.rain > 0 ? `rain ${h(d.rain)}` : 'no rain');
  if (d.storm > 0) parts.push(`lightning ${h(d.storm)}`);
  if (d.ramp > 0) parts.push(`ramp closed ${h(d.ramp)}`);
  if (d.lowVis > 0) parts.push(`low visibility ${h(d.lowVis)} (down to ${d.minVis} m)`);
  parts.push(`${Math.round(d.minT)}–${Math.round(d.maxT)} °C`);
  parts.push(`strongest wind ${d.maxWind} kt`);
  return `<h3>Weather today</h3><p class="muted">${esc(SEASON_LABEL[seasonOf(d.season)])} · ${parts.join(' · ')}</p>`;
}
