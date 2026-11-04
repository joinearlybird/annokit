/** The device snapshot that rides on a task (src/device.ts): read from RN pieces, described in one line. */

import { describe, expect, it } from "vitest";
import { describeDevice, readDevice } from "../src/device";
import type { DeviceSources } from "../src/device";

const window = (width: number, height: number) => ({ get: () => ({ width, height }) });
const ratio = (px: number, font = 1) => ({ get: () => px, getFontScale: () => font });
const scheme = (value: string | null) => ({ getColorScheme: () => value });

const IPHONE: DeviceSources = {
  Platform: { OS: "ios", Version: "26.0", constants: { systemName: "iOS", osVersion: "26.0", interfaceIdiom: "phone" } },
  Dimensions: window(402, 874),
  PixelRatio: ratio(3),
  Appearance: scheme("dark"),
};

const PIXEL: DeviceSources = {
  Platform: {
    OS: "android", Version: 35,
    constants: { Model: "Pixel 8", Brand: "google", Manufacturer: "Google", Release: "15", Version: 35, Fingerprint: "google/shiba/shiba:15/AP3A/12345:user/release-keys", uiMode: "normal" },
  },
  Dimensions: window(411.4, 914.3),
  PixelRatio: ratio(2.625, 1.15),
  Appearance: scheme("light"),
};

describe("readDevice", () => {
  it("reads an iPhone: OS version from the constants, no model, phone idiom", () => {
    expect(readDevice(IPHONE)).toEqual({
      platform: "ios",
      osVersion: "26.0",
      idiom: "phone",
      window: { width: 402, height: 874 },
      pixelRatio: 3,
      fontScale: 1,
      colorScheme: "dark",
      orientation: "portrait",
    });
    expect(readDevice(IPHONE)).not.toHaveProperty("model");
    expect(readDevice(IPHONE)).not.toHaveProperty("simulator");
  });

  it("calls an iPad a tablet, from the interface idiom or the isPad flag", () => {
    const idiom = { ...IPHONE, Platform: { ...IPHONE.Platform, constants: { ...IPHONE.Platform!.constants, interfaceIdiom: "pad" } } };
    expect(readDevice(idiom)?.idiom).toBe("tablet");
    const flag = { ...IPHONE, Platform: { ...IPHONE.Platform, isPad: true } };
    expect(readDevice(flag)?.idiom).toBe("tablet");
  });

  it("reads an Android phone: brand and model, release as the OS version, rounded sizes", () => {
    expect(readDevice(PIXEL)).toEqual({
      platform: "android",
      osVersion: "15",
      model: "google Pixel 8",
      idiom: "phone",
      window: { width: 411.4, height: 914.3 },
      pixelRatio: 2.6,
      fontScale: 1.15,
      colorScheme: "light",
      orientation: "portrait",
    });
  });

  it("does not repeat a brand the model already names, and spots an emulator", () => {
    const emulator = {
      ...PIXEL,
      Platform: { ...PIXEL.Platform, constants: { ...PIXEL.Platform!.constants, Model: "sdk_gphone64_arm64", Brand: "google", Fingerprint: "google/sdk_gphone64_arm64/emu64a:15/AE3A/1:userdebug/dev-keys" } },
    };
    const d = readDevice(emulator);
    expect(d?.model).toBe("google sdk_gphone64_arm64");
    expect(d?.simulator).toBe(true);
    const samsung = { ...PIXEL, Platform: { ...PIXEL.Platform, constants: { ...PIXEL.Platform!.constants, Model: "Samsung SM-S928B", Brand: "samsung" } } };
    expect(readDevice(samsung)?.model).toBe("Samsung SM-S928B");
    expect(readDevice(samsung)).not.toHaveProperty("simulator");
  });

  it("calls a wide Android window a tablet and a sideways one landscape", () => {
    const tablet = { ...PIXEL, Dimensions: window(800, 1280) };
    expect(readDevice(tablet)?.idiom).toBe("tablet");
    const sideways = { ...IPHONE, Dimensions: window(874, 402) };
    expect(readDevice(sideways)?.orientation).toBe("landscape");
  });

  it("reads the web as a browser with no OS version", () => {
    const web = { Platform: { OS: "web", Version: "Mozilla/5.0" }, Dimensions: window(1280, 720), PixelRatio: ratio(2), Appearance: scheme(null) };
    expect(readDevice(web)).toEqual({
      platform: "web",
      idiom: "desktop",
      window: { width: 1280, height: 720 },
      pixelRatio: 2,
      fontScale: 1,
      colorScheme: null,
      orientation: "landscape",
    });
  });

  it("falls back when a source is missing or hostile, and gives up on an unknown platform", () => {
    expect(readDevice({ Platform: { OS: "ios" } })).toEqual({
      platform: "ios", idiom: "phone", window: { width: 0, height: 0 }, pixelRatio: 1, fontScale: 1, colorScheme: null, orientation: "portrait",
    });
    const throwing: DeviceSources = { Platform: { OS: "ios" }, Dimensions: { get: () => { throw new Error("no window"); } } };
    expect(readDevice(throwing)).toBeUndefined();
    expect(readDevice({ Platform: { OS: "windows" } })).toBeUndefined();
    expect(readDevice(undefined)).toBeUndefined();
  });
});

describe("describeDevice", () => {
  it("prints the one line the prompt and the panel show", () => {
    expect(describeDevice(readDevice(IPHONE)!)).toBe("iPhone · iOS 26.0 · 402×874 pt @3x · dark · font scale 1.0");
    expect(describeDevice(readDevice(PIXEL)!)).toBe("google Pixel 8 · Android 15 · 411.4×914.3 pt @2.6x · light · font scale 1.15");
  });

  it("names an iPad and iPadOS, and adds landscape and simulator only when they apply", () => {
    const ipad = readDevice({ ...IPHONE, Platform: { ...IPHONE.Platform, isPad: true }, Dimensions: window(1194, 834), Appearance: scheme(null) })!;
    expect(describeDevice(ipad)).toBe("iPad · iPadOS 26.0 · 1194×834 pt @3x · landscape · font scale 1.0");
    expect(describeDevice({ platform: "android", window: { width: 411, height: 914 }, pixelRatio: 2.6, fontScale: 1, colorScheme: "dark", orientation: "portrait", simulator: true }))
      .toBe("Android device · Android · 411×914 pt @2.6x · dark · font scale 1.0 · simulator");
    expect(describeDevice({ platform: "web", window: { width: 1280, height: 720 }, pixelRatio: 2, fontScale: 1, colorScheme: null, orientation: "landscape" }))
      .toBe("Browser · 1280×720 pt @2x · landscape · font scale 1.0");
  });
});
