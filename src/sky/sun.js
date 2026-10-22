// The time of day and the sun's path. Pure and Node-importable: params.js, the
// views test and tools/screenshot.js use it too.
//
// The path is solar geometry at an art-directed latitude and season
// (config.sky.sun), turned so the sun sets towards config.sky.sun.sunsetYaw,
// the direction the beach looks out to sea (PLAN.md, Decisions). Hours are
// solar time: the sun stands highest at 12.
//
// Daylight runs from the moment the sun's centre crosses the horizon in the
// morning to the moment it does in the evening. There is no night (PLAN.md,
// Decisions): nothing may set a time outside it. The named times, which ?time=,
// views and captures accept, stand the sun config.sky.namedElevations up:
//   sunrise       morning, the sun a degree up, a few minutes into daylight
//   midday        solar noon
//   golden-hour   evening, the sun goldenHour degrees up
//   sunset        evening, the sun a degree up, a few minutes before daylight ends
import { config } from '../config.js';

const HOUR_ANGLE = Math.PI / 12; // radians the sky turns per hour
const DEG = Math.PI / 180;

export function createSunPath({ latitude, declination, sunsetYaw }, { sunset, goldenHour }) {
  const sinLat = Math.sin(latitude * DEG);
  const cosLat = Math.cos(latitude * DEG);
  const sinDec = Math.sin(declination * DEG);
  const cosDec = Math.cos(declination * DEG);

  // Hours from noon at which the sun's centre stands `elevation` radians up.
  function hoursFromNoon(elevation) {
    const cos = (Math.sin(elevation) - sinLat * sinDec) / (cosLat * cosDec);
    if (!(Math.abs(cos) <= 1)) throw new Error(`config.sky.sun: the sun never stands ${(elevation / DEG).toFixed(1)}° up on this path`);
    return Math.acos(cos) / HOUR_ANGLE;
  }

  // East, north and up components of the direction to the sun.
  function local(hours) {
    const h = (hours - 12) * HOUR_ANGLE;
    return {
      east: -cosDec * Math.sin(h),
      north: cosLat * sinDec - sinLat * cosDec * Math.cos(h),
      up: sinLat * sinDec + cosLat * cosDec * Math.cos(h),
    };
  }

  const halfDay = hoursFromNoon(0);
  const daylight = { start: 12 - halfDay, end: 12 + halfDay };
  const set = local(daylight.end);
  const setAzimuth = Math.atan2(set.east, set.north);

  const low = hoursFromNoon(sunset * DEG);
  const times = {
    sunrise: 12 - low,
    midday: 12,
    'golden-hour': 12 + hoursFromNoon(goldenHour * DEG),
    sunset: 12 + low,
  };

  // Hours of daylight from a number of hours or a name; throws for anything else.
  function toHours(value) {
    if (typeof value === 'string' && Object.hasOwn(times, value)) return times[value];
    if (typeof value === 'number' && value >= daylight.start && value <= daylight.end) return value;
    throw new Error(`time of day ${value} must be in daylight, ${describe()}`);
  }

  function describe() {
    return `${clock(daylight.start)}–${clock(daylight.end)} (${round(daylight.start)}–${round(daylight.end)} h), or one of: ${Object.keys(times).join(', ')}`;
  }

  return {
    daylight,
    times,
    toHours,
    describe,
    clamp: (hours) => Math.min(Math.max(hours, daylight.start), daylight.end),

    // The time a step away from `hours` (dir +1 later, -1 earlier): `minutes`
    // on, or with `named` the nearest named time that way. Stays in daylight.
    step(hours, dir, { minutes, named = false }) {
      if (!named) return Math.min(Math.max(hours + (dir * minutes) / 60, daylight.start), daylight.end);
      // A minute's slack, so a step from just beside a named time still moves.
      const ahead = Object.values(times).filter((h) => (h - hours) * dir > 1 / 60);
      if (!ahead.length) return hours;
      return dir > 0 ? Math.min(...ahead) : Math.max(...ahead);
    },

    // { elevation, azimuth } in radians (azimuth clockwise from north), and
    // direction: the unit vector towards the sun in world space, [x, y, z].
    position(hours) {
      const { east, north, up } = local(hours);
      const elevation = Math.asin(Math.max(-1, Math.min(1, up)));
      const azimuth = Math.atan2(east, north);
      // Views turn anticlockwise seen from above, azimuths clockwise.
      const yaw = sunsetYaw * DEG + setAzimuth - azimuth;
      const flat = Math.cos(elevation);
      return { elevation, azimuth, direction: [-Math.sin(yaw) * flat, Math.sin(elevation), -Math.cos(yaw) * flat] };
    },
  };
}

export const sunPath = createSunPath(config.sky.sun, config.sky.namedElevations);

// Makes target.timeOfDay hold the time in hours: it reads hours, and takes hours
// or a name. Anything outside daylight throws, so night can't sneak in.
export function defineTimeOfDay(target, value, path = sunPath) {
  let hours = path.toHours(value);
  Object.defineProperty(target, 'timeOfDay', {
    enumerable: true,
    get: () => hours,
    set: (next) => {
      hours = path.toHours(next);
    },
  });
}

// Hours as a clock time, "17:38".
export function clock(hours) {
  const minutes = Math.round(hours * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function round(n) {
  return Number(n.toFixed(2));
}
