/*
 * Timezone helpers built on the `Intl` builtins (no external date library).
 *
 * All helpers accept an optional IANA timezone name (e.g. `America/New_York`).
 * When the timezone is `undefined` (or empty), they fall back to the process-local
 * timezone, producing behaviour identical to plain `Date` usage.
 */

export interface ZonedDateParts {
	/** Full year, e.g. 2026 */
	year: number
	/** Month, 1-12 */
	month: number
	/** Day of month, 1-31 */
	day: number
	/** Hour, 0-23 */
	hour: number
	/** Minute, 0-59 */
	minute: number
	/** Second, 0-59 */
	second: number
	/** Day of week, 0 (Sunday) - 6 (Saturday) */
	weekday: number
}

const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/**
 * Break a `Date` down into its calendar/clock parts as observed in the given timezone.
 * Returns `null` if the timezone is invalid.
 */
export function getZonedDateParts(d: Date, tz?: string): ZonedDateParts | null {
	if (!tz) {
		return {
			year: d.getFullYear(),
			month: d.getMonth() + 1,
			day: d.getDate(),
			hour: d.getHours(),
			minute: d.getMinutes(),
			second: d.getSeconds(),
			weekday: d.getDay(),
		}
	}
	try {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
			weekday: 'short',
			hourCycle: 'h23',
		}).formatToParts(d)
		const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
		const wd = parts.find((p) => p.type === 'weekday')?.value
		const weekday = wd !== undefined ? weekdayMap[wd] : undefined
		if (weekday === undefined) return null
		const out: ZonedDateParts = {
			year: get('year'),
			month: get('month'),
			day: get('day'),
			hour: get('hour'),
			minute: get('minute'),
			second: get('second'),
			weekday,
		}
		return Object.values(out).some((v) => isNaN(v)) ? null : out
	} catch {
		return null
	}
}

/**
 * Get the UTC offset (in milliseconds) of the given timezone at the given instant.
 * A positive value means the zone is ahead of UTC (e.g. +60min for CET).
 * Returns 0 if the timezone is invalid.
 */
export function getZoneOffsetMs(tz: string, ts: number): number {
	// `getZonedDateParts` only resolves whole-second fields, so the sub-second portion of `ts`
	// would otherwise leak into the computed offset (e.g. an offset reported as 4h-123ms). Floor
	// to the containing second before differencing so the result is a clean zone offset.
	const wholeSecondTs = Math.floor(ts / 1000) * 1000
	const parts = getZonedDateParts(new Date(wholeSecondTs), tz)
	if (!parts) return 0
	// The wall-clock time in the zone, reinterpreted as if it were UTC.
	const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
	return asUtc - wholeSecondTs
}

export interface WallClockFields {
	year: number
	/** Month, 1-12 */
	month: number
	day: number
	hour: number
	minute: number
	second: number
}

/**
 * Convert a wall-clock time (as it would read on a clock in the given timezone) into the
 * absolute UTC instant (ms) at which it occurs.
 *
 * When `tz` is undefined, the fields are interpreted in the process-local timezone, matching
 * plain `new Date(y, m, d, ...)` construction.
 */
export function zonedTimeToUtc(fields: WallClockFields, tz?: string): number {
	const { year, month, day, hour, minute, second } = fields

	if (!tz) {
		return new Date(year, month - 1, day, hour, minute, second, 0).getTime()
	}

	// Treat the wall-clock fields as if they were UTC, then correct by the zone's offset.
	const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second)
	// First approximation using the offset at the naive instant...
	const firstApprox = naiveUtc - getZoneOffsetMs(tz, naiveUtc)
	// ...then refine once using the offset at the resulting instant. This resolves DST
	// boundaries where the offset at the naive instant differs from the real one.
	const refined = naiveUtc - getZoneOffsetMs(tz, firstApprox)

	// During a spring-forward gap the requested wall-clock time does not exist (e.g.
	// 2026-03-08 02:30 in America/New_York). There the refinement over-corrects and lands on an
	// instant that reads an hour *earlier* on the clock than requested, which would make a
	// time-of-day trigger fire early. Detect that by round-tripping the refined instant back to
	// wall-clock parts: if they don't match the request, the time is in a gap, so normalise
	// forward to `firstApprox` (the pre-transition offset), matching how plain `Date`
	// construction shifts non-existent local times forward.
	if (roundTripsTo(refined, tz, fields)) return refined
	return firstApprox
}

/** True if `instant`, observed in `tz`, reads exactly the requested wall-clock fields. */
function roundTripsTo(instant: number, tz: string, fields: WallClockFields): boolean {
	const parts = getZonedDateParts(new Date(instant), tz)
	if (!parts) return false
	return (
		parts.year === fields.year &&
		parts.month === fields.month &&
		parts.day === fields.day &&
		parts.hour === fields.hour &&
		parts.minute === fields.minute &&
		parts.second === fields.second
	)
}
