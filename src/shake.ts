/**
 * Optional shake-to-arm.
 *
 * `expo-sensors` is an OPTIONAL peer, resolved by a lazy `require` exactly
 * like `react-native-view-shot` in screenshot.ts: when the host app does not
 * have it installed the module still loads, `shakeAvailable()` is false, and
 * subscribing is a no-op that returns an unsubscribe function. No hard
 * dependency, no crash, no console noise on the absent path.
 *
 * The detector itself is a pure function (no sensors, no timers) so the
 * threshold and debounce are testable in the node suite.
 */

/** Accelerometer sample in g units (what expo-sensors reports). */
export interface AccelerationSample {
  x: number;
  y: number;
  z: number;
}

export interface ShakeDetectorOptions {
  /**
   * Total acceleration magnitude, in g, above which a sample counts as a
   * shake. At rest a device reads ~1g (gravity); a deliberate shake spikes
   * well past 1.8g while ordinary handling/scrolling stays below it.
   */
  threshold?: number;
  /**
   * Quiet period after a fired shake. A single physical shake is a burst of
   * many over-threshold samples (60Hz sampling ⇒ dozens per gesture); without
   * this the overlay would toggle on and immediately off again.
   */
  debounceMs?: number;
}

export const DEFAULT_SHAKE_THRESHOLD = 1.8;
export const DEFAULT_SHAKE_DEBOUNCE_MS = 1000;

/**
 * Stateful-but-pure shake detector: feed it samples with their timestamps,
 * it returns true exactly once per shake gesture.
 */
export function createShakeDetector(options?: ShakeDetectorOptions): {
  feed: (sample: AccelerationSample, timestampMs: number) => boolean;
} {
  const threshold = options?.threshold ?? DEFAULT_SHAKE_THRESHOLD;
  const debounceMs = options?.debounceMs ?? DEFAULT_SHAKE_DEBOUNCE_MS;
  let lastFiredAt: number | null = null;

  return {
    feed(sample, timestampMs) {
      if (!sample) return false;
      const { x, y, z } = sample;
      if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return false;
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (!Number.isFinite(magnitude) || magnitude < threshold) return false;
      if (lastFiredAt !== null && timestampMs - lastFiredAt < debounceMs) return false;
      lastFiredAt = timestampMs;
      return true;
    },
  };
}

// ── Optional expo-sensors binding ────────────────────────────────────────────

interface AccelerometerSubscription {
  remove: () => void;
}
interface AccelerometerModule {
  setUpdateInterval?: (intervalMs: number) => void;
  addListener: (listener: (sample: AccelerationSample) => void) => AccelerometerSubscription;
  isAvailableAsync?: () => Promise<boolean>;
}

let accelerometer: AccelerometerModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sensors = require("expo-sensors") as { Accelerometer?: AccelerometerModule };
  if (sensors?.Accelerometer && typeof sensors.Accelerometer.addListener === "function") {
    accelerometer = sensors.Accelerometer;
  }
} catch {
  accelerometer = null;
}

export function shakeAvailable(): boolean {
  return accelerometer !== null;
}

/** Sampling interval: fast enough to catch a shake, slow enough to be free. */
const SAMPLE_INTERVAL_MS = 100;

/**
 * Subscribe to shakes. Always returns an unsubscribe function — including
 * when expo-sensors is missing or the sensor throws, in which case it is
 * simply never called back.
 */
export function subscribeToShake(
  onShake: () => void,
  options?: ShakeDetectorOptions,
): () => void {
  if (!accelerometer) return () => {};
  const detector = createShakeDetector(options);
  let subscription: AccelerometerSubscription | null = null;
  try {
    accelerometer.setUpdateInterval?.(SAMPLE_INTERVAL_MS);
    subscription = accelerometer.addListener((sample) => {
      try {
        if (detector.feed(sample, Date.now())) onShake();
      } catch (e) {
        console.warn("[annokit] shake handler failed:", e);
      }
    });
  } catch (e) {
    console.warn("[annokit] shake detection unavailable:", e);
    subscription = null;
  }
  return () => {
    try {
      subscription?.remove();
    } catch {
      /* nothing to do; teardown must never throw */
    }
  };
}
