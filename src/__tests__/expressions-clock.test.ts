import type { JsonValue } from 'type-fest'
import { describe, expect, it } from 'vitest'
import { BLINK_DEFAULT_DUTY_CYCLE, MIN_CLOCK_PERIOD_MS } from '../ExpressionFunctions.js'
import { ParseExpression as parse } from '../ExpressionParse.js'
import { ResolveExpression, type ResolveExpressionOptions } from '../ExpressionResolve.js'

// The clock-driven builtins (`oscillate` and `blink`) are host hooks, so every case here is fully
// deterministic: the test supplies the cycle fraction / on-state directly instead of reading a real clock.
function run(expression: string, overrides: Partial<ResolveExpressionOptions>): JsonValue | undefined {
	return ResolveExpression(parse(expression), {
		unknownVariableValue: '$NA',
		getVariableValue: () => undefined,
		parseVariables: null,
		...overrides,
	})
}

/** Evaluate `oscillate()` with a clock pinned to `fraction` */
function oscillateAt(fraction: number, args: string, granularityMs?: number): number {
	return run(`oscillate(${args})`, {
		oscillate: { getCycleFraction: () => fraction, granularityMs },
	}) as number
}

const SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75]

describe('clock builtins', function () {
	describe('opt-in', function () {
		it.each(['oscillate(1000)', 'blink(1000)'])('%s throws when the option is not provided', function (expression) {
			expect(() => run(expression, {})).toThrow(/is not supported here/)
		})

		it('does not consult the hooks for an expression which does not call them', function () {
			let calls = 0
			const result = run('1 + 2', {
				oscillate: {
					getCycleFraction: () => {
						calls++
						return 0
					},
				},
				blink: () => {
					calls++
					return true
				},
			})
			expect(result).toBe(3)
			expect(calls).toBe(0)
		})
	})

	describe('oscillate clock contract', function () {
		it('is called with the clamped period', function () {
			const calls: number[] = []
			run('oscillate(50) + oscillate(1000)', {
				oscillate: {
					getCycleFraction: (periodMs) => {
						calls.push(periodMs)
						return 0
					},
				},
			})
			expect(calls).toEqual([MIN_CLOCK_PERIOD_MS, 1000])
		})

		it.each([
			{ granularityMs: undefined, expected: MIN_CLOCK_PERIOD_MS },
			// a clock finer than the floor does not lower it
			{ granularityMs: 40, expected: MIN_CLOCK_PERIOD_MS },
			// ...but a coarser one raises it
			{ granularityMs: 250, expected: 250 },
			// junk granularity is ignored rather than poisoning the floor
			{ granularityMs: -40, expected: MIN_CLOCK_PERIOD_MS },
			{ granularityMs: NaN, expected: MIN_CLOCK_PERIOD_MS },
		])('clamps a too-short period to $expected for a granularity of $granularityMs', function (options) {
			const calls: number[] = []
			run('oscillate(10)', {
				oscillate: {
					getCycleFraction: (periodMs) => {
						calls.push(periodMs)
						return 0
					},
					granularityMs: options.granularityMs,
				},
			})
			expect(calls).toEqual([options.expected])
		})

		it.each([
			{ raw: 1.25, expected: 1 },
			{ raw: -0.25, expected: 0 },
			{ raw: 4.75, expected: 0 },
		])('wraps a clock returning $raw into 0-1', function ({ raw, expected }) {
			expect(oscillateAt(raw, "1000, 'square'")).toBe(expected)
		})

		// The clamp happens before the check, so a NaN period stays NaN and yields 0 rather than
		// silently becoming the minimum period
		it.each(["'abc'", 'undefinedVariable', "'12px'"])(
			'returns 0 without consulting the clock for a non-numeric period %s',
			function (period) {
				let calls = 0
				const result = run(`oscillate(${period})`, {
					oscillate: {
						getCycleFraction: () => {
							calls++
							return 0.5
						},
					},
				})
				expect(result).toBe(0)
				expect(calls).toBe(0)
			}
		)
	})

	describe('oscillate waveforms', function () {
		it.each([
			{ waveform: 'sine', expected: [0, 0.5, 1, 0.5] },
			{ waveform: 'SINE', expected: [0, 0.5, 1, 0.5] },
			{ waveform: 'triangle', expected: [0, 0.5, 1, 0.5] },
			{ waveform: 'square', expected: [1, 1, 0, 0] },
			// a continuous clock needs no ramp headroom, so the sawtooth is exactly the cycle position
			{ waveform: 'sawtooth', expected: [0, 0.25, 0.5, 0.75] },
			// unrecognised waveform names fall back to the square wave
			{ waveform: 'not-a-waveform', expected: [1, 1, 0, 0] },
		])('$waveform samples correctly through a cycle', function ({ waveform, expected }) {
			const values = SAMPLE_FRACTIONS.map((fraction) => oscillateAt(fraction, `1000, '${waveform}'`))
			values.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6))
		})

		it.each([{ args: '1000' }, { args: '1000, 42' }, { args: '1000, null' }])(
			'uses the sine waveform for a non-string waveform ($args)',
			function ({ args }) {
				const values = SAMPLE_FRACTIONS.map((fraction) => oscillateAt(fraction, args))
				values.forEach((value, i) => expect(value).toBeCloseTo([0, 0.5, 1, 0.5][i], 6))
			}
		)

		it.each([
			// t * period / (period - granularity), so the ramp reaches 1 one sample before the cycle ends
			{ label: 'a 10Hz host', granularityMs: 100, expected: [0, 0.2777778, 0.5555556, 0.8333333] },
			{ label: 'a 25Hz host', granularityMs: 40, expected: [0, 0.2604167, 0.5208333, 0.78125] },
		])('sawtooth reserves the last sample of the cycle for $label', function ({ granularityMs, expected }) {
			const values = SAMPLE_FRACTIONS.map((fraction) => oscillateAt(fraction, "1000, 'sawtooth'", granularityMs))
			values.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6))

			// the ramp does reach full scale by the final sample, rather than jumping from ~0.9 straight to 0
			expect(oscillateAt(1 - granularityMs / 1000, "1000, 'sawtooth'", granularityMs)).toBeCloseTo(1, 6)
		})

		it('sawtooth is 0 when a cycle is no longer than a single sample', function () {
			for (const fraction of SAMPLE_FRACTIONS) {
				// the period clamps up to the granularity, leaving no room to ramp through
				expect(oscillateAt(fraction, "100, 'sawtooth'", 250)).toBe(0)
				expect(oscillateAt(fraction, "250, 'sawtooth'", 250)).toBe(0)
			}
		})

		it.each([
			{ phase: '0.25', expected: 1 },
			{ phase: '0.5', expected: 0 },
			{ phase: '-0.25', expected: 0 },
			{ phase: '1.25', expected: 1 },
			{ phase: '-2.75', expected: 1 },
			// a non-numeric phase is ignored rather than poisoning the result
			{ phase: "'abc'", expected: 1 },
			{ phase: 'undefinedVariable', expected: 1 },
		])('offsets the cycle by a phase of $phase', function ({ phase, expected }) {
			expect(oscillateAt(0, `1000, 'square', ${phase}`)).toBe(expected)
		})

		it.each(['sine', 'triangle', 'square', 'sawtooth', 'unknown'])(
			'%s stays within 0-1 across a swept cycle',
			function (waveform) {
				for (const granularityMs of [undefined, 40, 100]) {
					for (let step = 0; step <= 40; step++) {
						const value = oscillateAt(step / 40, `1000, '${waveform}', ${step / 80}`, granularityMs)
						expect(value).toBeGreaterThanOrEqual(0)
						expect(value).toBeLessThanOrEqual(1)
					}
				}
			}
		)
	})

	describe('blink', function () {
		it.each([
			{ label: 'true', hookResult: true, expected: 1 },
			{ label: 'false', hookResult: false, expected: 0 },
			{ label: 'a truthy string', hookResult: 'yes', expected: 1 },
			{ label: 'an empty string', hookResult: '', expected: 0 },
			{ label: 'zero', hookResult: 0, expected: 0 },
			{ label: 'undefined', hookResult: undefined, expected: 0 },
		])('coerces $label to $expected', function ({ hookResult, expected }) {
			const blink = (() => hookResult) as ResolveExpressionOptions['blink']
			expect(run('blink(1000)', { blink })).toBe(expected)
		})

		it.each([
			// a string interval is the same blink as the equivalent number, which matters where the host
			// derives a key or a dependency from what it is given
			{ args: '1000', expected: [1000, BLINK_DEFAULT_DUTY_CYCLE] },
			{ args: "'1000'", expected: [1000, BLINK_DEFAULT_DUTY_CYCLE] },
			{ args: "'1000', '0.25'", expected: [1000, 0.25] },
			{ args: '1000, 0.25', expected: [1000, 0.25] },
			// too-short intervals clamp, as they do for oscillate
			{ args: '10', expected: [MIN_CLOCK_PERIOD_MS, BLINK_DEFAULT_DUTY_CYCLE] },
			// out-of-range and non-numeric duty cycles are brought back into 0-1
			{ args: '1000, 4', expected: [1000, 1] },
			{ args: '1000, -1', expected: [1000, 0] },
			{ args: "1000, 'half'", expected: [1000, BLINK_DEFAULT_DUTY_CYCLE] },
		])('normalises blink($args) to $expected', function ({ args, expected }) {
			const calls: Array<[number, number]> = []
			const blink = (intervalMs: number, dutyCycle: number): boolean => {
				calls.push([intervalMs, dutyCycle])
				return true
			}
			run(`blink(${args})`, { blink })
			expect(calls).toEqual([expected])
		})

		it.each(["'abc'", 'undefinedVariable', "'12px'"])(
			'reads as off without consulting the hook for a non-numeric interval %s',
			function (interval) {
				let calls = 0
				const result = run(`blink(${interval})`, {
					blink: () => {
						calls++
						return true
					},
				})
				expect(result).toBe(0)
				expect(calls).toBe(0)
			}
		)
	})

	describe('composition', function () {
		it('oscillate composes into a larger expression', function () {
			expect(run('oscillate(1000) * 100', { oscillate: { getCycleFraction: () => 0.5 } })).toBe(100)
		})

		it('blink composes into a larger expression', function () {
			expect(run("blink(1000) ? 'on' : 'off'", { blink: () => true })).toBe('on')
			expect(run("blink(1000) ? 'on' : 'off'", { blink: () => false })).toBe('off')
		})
	})
})
