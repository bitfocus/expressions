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
	const parts = getZonedDateParts(new Date(ts), tz)
	if (!parts) return 0
	// The wall-clock time in the zone, reinterpreted as if it were UTC.
	const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
	return asUtc - ts
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
	let instant = naiveUtc - getZoneOffsetMs(tz, naiveUtc)
	// ...then refine once using the offset at the resulting instant. This resolves DST
	// boundaries where the offset at the naive instant differs from the real one.
	instant = naiveUtc - getZoneOffsetMs(tz, instant)
	return instant
}
