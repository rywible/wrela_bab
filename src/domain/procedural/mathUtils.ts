export function hash01(seed: number, x: number, y = 0) {
  const value = Math.sin(seed * 12.9898 + x * 78.233 + y * 37.719) * 43_758.5453123;
  return value - Math.floor(value);
}

export function valueNoise2D(seed: number, x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;

  const v00 = hash01(seed, x0, y0);
  const v10 = hash01(seed, x0 + 1, y0);
  const v01 = hash01(seed, x0, y0 + 1);
  const v11 = hash01(seed, x0 + 1, y0 + 1);

  const sx = smoothstep(0, 1, tx);
  const sy = smoothstep(0, 1, ty);

  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}

export function fbm2D(
  seed: number,
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
) {
  let amplitude = 0.5;
  let frequency = 1;
  let value = 0;
  let sum = 0;

  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise2D(seed + octave * 97, x * frequency, y * frequency) * amplitude;
    sum += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return sum > 0 ? value / sum : 0;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function smoothstep(min: number, max: number, value: number) {
  const t = clamp01((value - min) / Math.max(0.0001, max - min));
  return t * t * (3 - 2 * t);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number) {
  return clamp(value, 0, 1);
}

export function gaussian(value: number, mean: number, width: number) {
  const delta = (value - mean) / Math.max(width, 0.0001);
  return Math.exp(-(delta * delta));
}

export function grooveDensity(redwoodSuitability: number, slope: number) {
  return clamp01(redwoodSuitability * 0.72 + (1 - slope) * 0.18);
}

export function normalize2(x: number, z: number, fallback: [number, number]): [number, number] {
  const length = Math.hypot(x, z);
  if (length < 0.0001) {
    return fallback;
  }

  return [x / length, z / length];
}

export function normalize3(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function mixColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
