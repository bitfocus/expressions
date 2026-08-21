import { describe, expect, it } from 'vitest'
import { buildBlinkFunction, buildOscillateFunction, createExpressionFunctions } from '../ExpressionFunctions.js'
import { ParseExpression } from '../ExpressionParse.js'
import { ResolveExpression } from '../ExpressionResolve.js'

const ExpressionFunctions = createExpressionFunctions('UTC')

function run(expr: string, variables: Record<string, any> = {}): any {
	return ResolveExpression(ParseExpression(expr), {
		unknownVariableValue: '$NA',
		getVariableValue: (id) => variables[id],
		parseVariables: null,
		defaultTimezone: 'UTC',
	})
}

/**
 * Values a function must survive in any argument position. `{ toString: 5 }` and a null-prototype object
 * are the awkward ones - both are constructible from an expression, and both make plain conversion throw.
 */
const HOSTILE_VALUES: any[] = [
	undefined,
	null,
	true,
	false,
	0,
	-1,
	NaN,
	Infinity,
	1.5,
	1e21,
	'',
	'abc',
	'  ',
	'nope',
	'%',
	'\uD800',
	[],
	[1, 2],
	[{}, { toString: 5 }],
	{},
	{ a: 1 },
	{ toString: 5 },
	Object.create(null),
	(x: any) => x,
	new Date(),
	BigInt(5),
]

/** Plausible values for the positions not currently under test. */
const FILLER_VALUES: any[] = [undefined, 'abc', 1]

/**
 * Builtins that take a callback, and where. A non-function has nothing to coerce it into, so those still
 * report it - every other position is exercised as normal.
 */
const CALLBACK_ARGUMENT: Record<string, number> = {
	arrayMap: 1,
	arrayFilter: 1,
	arrayReduce: 1,
	arrayForEach: 1,
	arrayFind: 1,
	arrayFindIndex: 1,
	arraySome: 1,
	arrayEvery: 1,
	arraySort: 1,
}

const callback = (a: any) => a

const ALL_FUNCTIONS: Record<string, (...args: any[]) => any> = {
	...ExpressionFunctions,
	blink: buildBlinkFunction(() => true),
	oscillate: buildOscillateFunction({ getCycleFraction: () => 0.25, granularityMs: 100 }),
}

describe('argument guards', () => {
	// A throw takes the whole expression down with it - see bitfocus/companion#4427
	describe.each(Object.keys(ALL_FUNCTIONS))('%s', (name) => {
		const fn = ALL_FUNCTIONS[name]
		const callbackIndex = CALLBACK_ARGUMENT[name]

		it('never throws, whatever it is given', () => {
			const call = (args: any[]) => {
				try {
					fn(...args)
				} catch (e) {
					throw new Error(`${name}(${args.map((a) => String(typeof a)).join(', ')}) threw: ${e}`, { cause: e })
				}
			}

			call([])

			// One position at a time, so each is guarded independently
			for (let position = 0; position < 3; position++) {
				if (position === callbackIndex) continue

				// Reach far enough to fill the callback position, for a builtin that needs one
				const arity = Math.max(position + 1, (callbackIndex ?? -1) + 1)

				for (const hostile of HOSTILE_VALUES) {
					for (const a of FILLER_VALUES) {
						for (const b of FILLER_VALUES) {
							const args = [a, b, a].slice(0, arity)
							args[position] = hostile
							if (callbackIndex !== undefined) args[callbackIndex] = callback
							call(args)
						}
					}
				}
			}
		})
	})
})

describe('coercion behaviour', () => {
	it('timeDiff reports an unusable time rather than throwing', () => {
		expect(ExpressionFunctions.timeDiff(undefined, '04:30:00')).toBe('ERR')
		expect(ExpressionFunctions.timeDiff('04:30:00', undefined)).toBe('ERR')
		expect(ExpressionFunctions.timeDiff(null, null)).toBe('ERR')
		expect(ExpressionFunctions.timeDiff(12, 18)).toBe('ERR')
		expect(ExpressionFunctions.timeDiff('not a time', '04:30:00')).toBe('ERR')
		expect(ExpressionFunctions.timeDiff('12:xx', '13:00')).toBe('ERR')

		expect(ExpressionFunctions.timeDiff('12:00', '18:00')).toBe(21600)
	})

	it('timeOffset reports an unusable time rather than throwing', () => {
		expect(ExpressionFunctions.timeOffset(undefined, 1)).toBe('')
		expect(ExpressionFunctions.timeOffset(null, 1)).toBe('')
		expect(ExpressionFunctions.timeOffset('not a time', 1)).toBe('')
		expect(ExpressionFunctions.timeOffset('2024-05-23T12:00:00', 1)).toBe('')

		// A missing or unusable offset is no offset
		expect(ExpressionFunctions.timeOffset('15:00:00')).toBe('15:00:00')
		expect(ExpressionFunctions.timeOffset('15:00', 'abc')).toBe('15:00')
		expect(ExpressionFunctions.timeOffset('15:00:00', {})).toBe('15:00:00')
	})

	it('the timestamp builtins fall back to zero and to the default format', () => {
		expect(ExpressionFunctions.secondsToTimestamp(undefined)).toBe('00:00:00')
		expect(ExpressionFunctions.secondsToTimestamp(NaN)).toBe('00:00:00')
		expect(ExpressionFunctions.secondsToTimestamp('abc')).toBe('00:00:00')
		expect(ExpressionFunctions.msToTimestamp(undefined)).toBe('00:00.0')

		// A format has to be a string; anything else uses the default
		expect(ExpressionFunctions.secondsToTimestamp(61, {})).toBe('00:01:01')
		expect(ExpressionFunctions.secondsToTimestamp(61, 42)).toBe('00:01:01')
		expect(ExpressionFunctions.msToTimestamp(1500, [])).toBe('00:01.5')
	})

	it('the string builtins stringify anything', () => {
		const unstringifiable = { toString: 5 }
		expect(ExpressionFunctions.trim(unstringifiable)).toBe('')
		expect(ExpressionFunctions.toUpperCase(unstringifiable)).toBe('')
		expect(ExpressionFunctions.strlen(unstringifiable)).toBe(0)
		expect(ExpressionFunctions.concat('a', unstringifiable, 'b')).toBe('ab')
		expect(ExpressionFunctions.join([unstringifiable, 'b'])).toBe(',b')

		expect(ExpressionFunctions.trim(undefined)).toBe('')
		expect(ExpressionFunctions.trim(null)).toBe('null')
		expect(ExpressionFunctions.toUpperCase(12)).toBe('12')
	})

	it('the number builtins yield NaN rather than throwing', () => {
		const unconvertible = { toString: 5 }
		expect(ExpressionFunctions.round(unconvertible)).toBeNaN()
		expect(ExpressionFunctions.abs(unconvertible)).toBeNaN()
		expect(ExpressionFunctions.sqrt(unconvertible)).toBeNaN()
		expect(ExpressionFunctions.pow(2, unconvertible)).toBeNaN()
		expect(ExpressionFunctions.max(1, unconvertible, 3)).toBeNaN()
		expect(ExpressionFunctions.min(1, unconvertible, 3)).toBeNaN()
		expect(ExpressionFunctions.toFixed(unconvertible, 2)).toBe('NaN')

		// Matches Math.max/Math.min, including for an empty list
		expect(ExpressionFunctions.max()).toBe(-Infinity)
		expect(ExpressionFunctions.min()).toBe(Infinity)
		expect(ExpressionFunctions.max(1, 'abc', 3)).toBeNaN()
		expect(ExpressionFunctions.max(1, '3', 2)).toBe(3)
		expect(ExpressionFunctions.min([], 4)).toBe(0)
	})

	it('encode/decode fall back to the default encoding when given an unknown one', () => {
		expect(ExpressionFunctions.encode('abc', 'nope')).toBe(ExpressionFunctions.encode('abc'))
		expect(ExpressionFunctions.decode('abc', 42)).toBe(ExpressionFunctions.decode('abc'))

		expect(ExpressionFunctions.encode('abc', 'base64')).toBe('YWJj')
	})

	it('the URI builtins pass through input they cannot convert', () => {
		expect(ExpressionFunctions.decodeURI('%')).toBe('%')
		expect(ExpressionFunctions.decodeURIComponent('%zz')).toBe('%zz')
		expect(ExpressionFunctions.encodeURI('\uD800')).toBe('\uD800')
		expect(ExpressionFunctions.encodeURIComponent('\uD800')).toBe('\uD800')

		expect(ExpressionFunctions.encodeURIComponent('a b')).toBe('a%20b')
		expect(ExpressionFunctions.decodeURIComponent('a%20b')).toBe('a b')
	})

	it('jsonpath treats a malformed path as no match', () => {
		expect(ExpressionFunctions.jsonpath({ a: 1 }, '$..[?(@.a=)]')).toBeUndefined()
		expect(ExpressionFunctions.jsonpath({ a: 1 }, '$[?(')).toBeUndefined()
		expect(ExpressionFunctions.jsonpath({ a: 1 }, '$.a')).toBe(1)
	})

	it('arraySort orders values it cannot stringify', () => {
		expect(ExpressionFunctions.arraySort(['b', { toString: 5 }, 'a'])).toEqual([{ toString: 5 }, 'a', 'b'])
		expect(ExpressionFunctions.arraySort([10, 9, 1])).toEqual([1, 10, 9])
	})
})

describe('companion#4427', () => {
	const expression = `secondsToTimestamp(max(0, timeDiff($(internal:time_hms), "04:30:00")), 'HH:mm:ss')`

	it('a countdown resolves while its time variable is still unpopulated', () => {
		// This used to throw, leaving the button at $NA until the expression was edited by hand
		expect(run(expression)).toBe('00:00:00')
	})

	it('the same countdown still counts down once the variable arrives', () => {
		const now = new Date()
		now.setHours(4, 0, 0, 0)
		const timeHms = `${String(now.getHours()).padStart(2, '0')}:00:00`

		expect(run(expression, { 'internal:time_hms': timeHms })).toBe('00:30:00')
	})
})
