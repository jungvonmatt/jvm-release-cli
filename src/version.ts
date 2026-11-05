import semver from "semver";
import type { ReleaseType, SemVer } from "semver";
import pc from "picocolors";

/**
 * SemVer helper utilities for the release/publish CLI.
 *
 * This module wraps `semver` to provide:
 * - Validation/guard rails for version increments
 * - A small `Version` class that can bump versions and pretty-print diffs
 */

export const SEMVER_INCREMENTS: ReleaseType[] = [
  "patch",
  "minor",
  "major",
  "prepatch",
  "preminor",
  "premajor",
  "prerelease",
];

const SEMVER_INCREMENTS_LIST = SEMVER_INCREMENTS.join(", ");
const SEMVER_INCREMENTS_LIST_LAST_OR = `${SEMVER_INCREMENTS.slice(0, -1).join(", ")}, or ${String(SEMVER_INCREMENTS.slice(-1))}`;

const isSemVersionIncrement = (input: unknown): input is ReleaseType =>
  SEMVER_INCREMENTS.includes(input as ReleaseType);

const isInvalidSemVersion = (input: string): boolean => !semver.valid(input);

type ColorName = keyof typeof pc;

const formatFirstDifference = (
  current: (string | number)[],
  previous: readonly (string | number)[] | null,
  diffColor: ColorName,
): string => {
  const parts = current.map(String);
  const prevParts = previous ? previous.map(String) : [];
  const firstDifferenceIndex = parts.findIndex((part, i) => prevParts[i] !== part);
  const colorFn = (pc as unknown as Record<string, (s: string) => string>)[diffColor];
  if (colorFn) {
    parts[firstDifferenceIndex] = colorFn(parts[firstDifferenceIndex]!);
  }
  return parts.join(".");
};

/**
 * Stops a release whose version is not higher than the version in package.json, before anything
 * changes. `pnpm version` refuses the same version and would accept a lower one.
 */
export const verifyVersionIsNewer = (version: string, packageVersion: string): void => {
  if (!semver.gt(version, packageVersion)) {
    throw new Error(
      `Cannot release ${version}: package.json is already at ${packageVersion}. ` +
        `Tag v${packageVersion} first, or set package.json back to the version of the latest tag.`,
    );
  }
};

export default class Version {
  #version: SemVer;
  #diff: ReleaseType | null | undefined = undefined;
  #prereleasePrefix: string | undefined = undefined;

  toString(): string {
    return `v${this.#version.version}`;
  }

  #trySetVersion(version: string): void {
    const parsed = semver.parse(version);
    if (parsed === null) {
      throw new Error(`Version ${version} should be a valid SemVer version.`);
    }
    this.#version = parsed;
  }

  constructor(
    version: string,
    increment?: ReleaseType,
    { prereleasePrefix = "pre" }: { prereleasePrefix?: string } = {},
  ) {
    this.#prereleasePrefix = prereleasePrefix;
    this.#version = null as unknown as SemVer; // will be set by #trySetVersion
    this.#trySetVersion(version);

    if (increment) {
      if (!isSemVersionIncrement(increment)) {
        throw new Error(
          `Increment ${String(increment)} should be one of ${SEMVER_INCREMENTS_LIST_LAST_OR}.`,
        );
      }

      this.setFrom(increment);
    }
  }

  /**
   * Sets a new version based on `input`. If `input` is a valid SemVer increment,
   * the current version will be incremented by that amount. If `input` is a valid
   * SemVer version, the current version will be set to `input` if it is greater
   * than the current version.
   */
  setFrom(input: string, { prereleasePrefix = "pre" }: { prereleasePrefix?: string } = {}): this {
    this.#prereleasePrefix ??= prereleasePrefix;
    const previousVersion = this.toString();

    if (isSemVersionIncrement(input)) {
      this.#version.inc(input, this.#prereleasePrefix);
    } else {
      if (isInvalidSemVersion(input)) {
        throw new Error(
          `New version ${input} should either be one of ${SEMVER_INCREMENTS_LIST}, or a valid SemVer version.`,
        );
      }

      if (this.#isGreaterThanOrEqualTo(input)) {
        throw new Error(
          `New version ${input} should be higher than current version ${this.toString()}.`,
        );
      }

      this.#trySetVersion(input);
    }

    // Set `this.#diff` to format version diffs
    this.#diff = semver.diff(previousVersion, this.#version);
    return this;
  }

  /**
   * Formats the current version with color, pretty-printing the version's diff
   * if possible.
   */
  format({
    color = "dim",
    diffColor = "cyan",
    previousVersion,
  }: {
    color?: ColorName;
    diffColor?: ColorName;
    previousVersion?: string | SemVer;
  } = {}): string {
    const base =
      (pc as unknown as Record<string, (s: string) => string>)[color] ?? ((text: string) => text);
    const diff =
      (pc as unknown as Record<string, (s: string) => string>)[diffColor] ??
      ((text: string) => text);

    if (typeof previousVersion === "string") {
      const previousSemver = semver.parse(previousVersion);

      if (previousSemver === null) {
        throw new Error(`Previous version ${previousVersion} should be a valid SemVer version.`);
      }

      previousVersion = previousSemver;
    }

    if (!this.#diff) {
      if (!previousVersion) {
        return base(this.toString());
      }

      this.#diff = semver.diff(previousVersion, this.#version);
    }

    const { major, minor, patch, prerelease } = this.#version;
    const previousPrerelease = previousVersion ? semver.prerelease(previousVersion) : null;

    if (prerelease && prerelease.length > 0 && previousPrerelease) {
      const prereleaseDiff = formatFirstDifference([...prerelease], previousPrerelease, diffColor);

      return base(`${major}.${minor}.${patch}-${prereleaseDiff}`);
    }

    const majorText = String(major);
    const minorText = String(minor);
    const patchText = String(patch);
    const prereleaseText = prerelease?.map(String).join(".") ?? "";

    const dot = base(".");
    const dash = base("-");

    switch (this.#diff) {
      case "major":
        return `${base("v")}${diff(majorText)}${dot}${base(minorText)}${dot}${base(patchText)}`;
      case "minor":
        return `${base("v")}${base(majorText)}${dot}${diff(minorText)}${dot}${base(patchText)}`;
      case "patch":
        return `${base("v")}${base(majorText)}${dot}${base(minorText)}${dot}${diff(patchText)}`;
      case "premajor":
        return `${base("v")}${diff(majorText)}${dot}${base(minorText)}${dot}${base(patchText)}${dash}${diff(prereleaseText)}`;
      case "preminor":
        return `${base("v")}${base(majorText)}${dot}${diff(minorText)}${dot}${base(patchText)}${dash}${diff(prereleaseText)}`;
      case "prepatch":
        return `${base("v")}${base(majorText)}${dot}${base(minorText)}${dot}${diff(patchText)}${dash}${diff(prereleaseText)}`;
      case "prerelease":
        return `${base("v")}${base(majorText)}${dot}${base(minorText)}${dot}${base(patchText)}${dash}${diff(prereleaseText)}`;
      default:
        return "";
    }
  }

  /**
   * If the current version satisfies the given SemVer range.
   */
  satisfies(range: string): boolean {
    if (!semver.validRange(range)) {
      throw new Error(`Range ${range} is not a valid SemVer range.`);
    }

    return semver.satisfies(this.#version, range, {
      includePrerelease: true,
    });
  }

  /**
   * If the current version has any prerelease components.
   */
  isPrerelease(): boolean {
    return Boolean(semver.prerelease(this.#version));
  }

  #isGreaterThanOrEqualTo(otherVersion: string): boolean {
    return semver.gte(this.#version, otherVersion);
  }
}
