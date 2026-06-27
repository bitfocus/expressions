import { describe, expect, it } from 'vitest'
import { getZonedDateParts, getZoneOffsetMs, zonedTimeToUtc } from '../Timezone.js'

describe('Timezone helpers', () => {
	describe('getZonedDateParts', () => {
		it('breaks a UTC instant into parts for a given zone', () => {
			// 2026-06-25T12:00:00Z -> New York is UTC-4 (EDT) in summer -> 08:00 same day
			const d = new Date('2026-06-25T12:00:00Z')
			expect(getZonedDateParts(d, 'America/New_York')).toEqual({
				year: 2026,
				month: 6,
				day: 25,
				hour: 8,
				minute: 0,
				second: 0,
				weekday: 4, // Thursday
			})
		})

		it('rolls over the date when the zone is behind midnight', () => {
			// 2026-06-25T01:00:00Z -> Los Angeles is UTC-7 (PDT) -> previous day 18:00
			const d = new Date('2026-06-25T01:00:00Z')
			expect(getZonedDateParts(d, 'America/Los_Angeles')).toMatchObject({
				year: 2026,
				month: 6,
				day: 24,
				hour: 18,
			})
		})

		it('falls back to process-local time when no zone is given', () => {
			const d = new Date(2026, 5, 25, 9, 7, 8)
			expect(getZonedDateParts(d, undefined)).toEqual({
				year: d.getFullYear(),
				month: d.getMonth() + 1,
				day: d.getDate(),
				hour: d.getHours(),
				minute: d.getMinutes(),
				second: d.getSeconds(),
				weekday: d.getDay(),
			})
		})

		it('returns null for an invalid zone', () => {
			expect(getZonedDateParts(new Date(), 'Not/AZone')).toBeNull()
		})
	})

	describe('getZoneOffsetMs', () => {
		it('reports a negative offset for zones behind UTC', () => {
			// New York in summer is UTC-4
			const ts = new Date('2026-06-25T12:00:00Z').getTime()
			expect(getZoneOffsetMs('America/New_York', ts)).toBe(-4 * 60 * 60 * 1000)
		})

		it('reports a positive offset for zones ahead of UTC', () => {
			// Berlin in summer is UTC+2 (CEST)
			const ts = new Date('2026-06-25T12:00:00Z').getTime()
			expect(getZoneOffsetMs('Europe/Berlin', ts)).toBe(2 * 60 * 60 * 1000)
		})

		it('ignores the sub-second part of the instant', () => {
			// The offset is a whole-second quantity; a fractional-second instant must not leak into it.
			const ts = Date.parse('2026-06-25T12:00:00.123Z')
			expect(getZoneOffsetMs('America/New_York', ts)).toBe(-4 * 60 * 60 * 1000)
		})
	})

	describe('zonedTimeToUtc', () => {
		const fields = { year: 2026, month: 6, day: 25, hour: 12, minute: 30, second: 15 }

		it('treats fields as UTC wall-clock for the UTC zone', () => {
			expect(zonedTimeToUtc(fields, 'UTC')).toBe(Date.UTC(2026, 5, 25, 12, 30, 15))
		})

		it('converts a zoned wall-clock time to the correct UTC instant', () => {
			// 12:30:15 in New York (UTC-4 in summer) -> 16:30:15 UTC
			expect(zonedTimeToUtc(fields, 'America/New_York')).toBe(Date.UTC(2026, 5, 25, 16, 30, 15))
		})

		it('round-trips with getZonedDateParts', () => {
			const ts = zonedTimeToUtc(fields, 'Asia/Tokyo')
			expect(getZonedDateParts(new Date(ts), 'Asia/Tokyo')).toEqual({ ...fields, weekday: 4 })
		})

		it('handles times either side of a DST spring-forward boundary', () => {
			// US DST 2026 starts 2026-03-08: 02:00 EST -> 03:00 EDT
			// 01:30 is still EST (UTC-5) -> 06:30 UTC
			expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 1, minute: 30, second: 0 }, 'America/New_York')).toBe(
				Date.UTC(2026, 2, 8, 6, 30, 0)
			)
			// 03:30 is EDT (UTC-4) -> 07:30 UTC
			expect(zonedTimeToUtc({ year: 2026, month: 3, day: 8, hour: 3, minute: 30, second: 0 }, 'America/New_York')).toBe(
				Date.UTC(2026, 2, 8, 7, 30, 0)
			)
		})

		it('normalises a non-existent spring-forward wall time forward instead of an hour early', () => {
			// 2026-03-08 02:30 in New York does not exist (02:00 EST jumps to 03:00 EDT). Naively
			// refining the offset lands on 01:30 local (an hour early); the round-trip guard pushes it
			// forward to the post-transition wall clock (03:30 EDT = 07:30 UTC) instead.
			const instant = zonedTimeToUtc(
				{ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 },
				'America/New_York'
			)
			expect(instant).toBe(Date.UTC(2026, 2, 8, 7, 30, 0))
			expect(getZonedDateParts(new Date(instant), 'America/New_York')).toMatchObject({ hour: 3, minute: 30 })
		})

		it('falls back to process-local construction when no zone is given', () => {
			expect(zonedTimeToUtc(fields, undefined)).toBe(new Date(2026, 5, 25, 12, 30, 15).getTime())
		})
	})
})
