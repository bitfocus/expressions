import { JSONPath } from 'jsonpath-plus'
import { countGraphemes } from 'unicode-segmenter/grapheme'
import { getZonedDateParts, zonedTimeToUtc, type ZonedDateParts } from './Timezone.js'
import { msToStamp, pad } from './Util.js'

function toString(v: any): string {
	if (v === undefined) return ''
	return v + ''
}

function assertFunction(fn: any, name: string): void {
	if (typeof fn !== 'function') throw new Error(`${name}() requires a function as its callback argument`)
}

function toDate(v: any): Date | null {
	let d: Date | undefined
	if (v instanceof Date) d = v
	else if (typeof v === 'number') d = new Date(v)
	else if (typeof v === 'string' && v.trim().length > 0) {
		const num = Number(v)
		d = new Date(isNaN(num) ? v : num)
	}
	return d && !isNaN(d.getTime()) ? d : null
}

function getDatePart(v: any, tz: string | undefined, key: keyof ZonedDateParts): number | null {
	const d = toDate(v)
	if (!d) return null
	const parts = getZonedDateParts(d, tz)
	return parts ? parts[key] : null
}

const monthNames = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
]
const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const dayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * The timezone-independent expression functions. These never change, so they are defined once as a
 * module-level constant rather than rebuilt per call. `executeExpression` is a hot path (runs for every
 * expression option and feedback evaluation), so this avoids rebuilding ~60 closures on every call; only
 * the small set of timezone-dependent date functions (see buildDateFunctions) is rebuilt per evaluation,
 * since it closes over the per-call timezone getter.
 */
const STATIC_FUNCTIONS: Record<string, (...args: any[]) => any> = {
	// General operations
	length: (v) => {
		let len = 0
		if (v === undefined || v === null) {
			len = 0
		} else if (Array.isArray(v)) {
			len = v.length
		} else if (typeof v === 'number') {
			len = (v + '').length
		} else if (typeof v === 'bigint') {
			len = v.toString().length
		} else if (typeof v === 'string') {
			// So we handle UTF graphemes correctly
			len = countGraphemes(v)
		} else if (v instanceof RegExp) {
			len = v.toString().length
		} else if (typeof v === 'object') {
			len = Object.keys(v).length
		} else {
			// If it's got to here, we don't know how to handle it
			len = NaN
		}
		return len
	},

	// Number operations
	// TODO: round to fractionals, without fp issues
	round: (v) => Math.round(v),
	floor: (v) => Math.floor(v),
	ceil: (v) => Math.ceil(v),
	abs: (v) => Math.abs(v),
	fromRadix: (v, radix) => parseInt(v, radix || 10),
	toRadix: (v, radix) => {
		// Clamp the radix to the integer range supported by toString, to avoid a RangeError
		radix = Math.min(36, Math.max(2, Math.floor(Number(radix)) || 10))
		return Number(v).toString(radix)
	},
	// Clamp dp to the range supported by Number#toFixed, to avoid a RangeError
	toFixed: (v, dp) => Number(v).toFixed(Math.min(100, Math.max(0, dp || 0))),
	isNumber: (v) => {
		if (typeof v === 'number' || typeof v === 'bigint') return !Number.isNaN(v)
		// Reject blank strings, which Number() would coerce to 0
		if (typeof v === 'string') return v.trim() !== '' && !isNaN(Number(v))
		return false
	},
	max: (...args) => Math.max(...args),
	min: (...args) => Math.min(...args),
	randomInt: (min = 0, max = 10) => {
		min = Number(min)
		max = Number(max)
		if (max < min) [min, max] = [max, min]
		// Use floor over a [0, n+1) range so that min and max are as likely as interior values
		return min + Math.floor(Math.random() * (max - min + 1))
	},
	log: (v, base) => (base === undefined ? Math.log(v) : Math.log(v) / Math.log(base)),
	log10: (v) => Math.log10(v),
	exp: (v) => Math.exp(v),
	sqrt: (v) => Math.sqrt(v),
	pow: (base, exponent) => Math.pow(base, exponent),

	// String operations
	trim: (v) => toString(v).trim(),
	strlen: (v) => toString(v).length,
	substr: (str, start, end) => {
		return toString(str).slice(start, end)
	},
	split: (str, separator) => {
		if (separator === undefined) {
			return [toString(str)]
		}
		return toString(str).split(toString(separator))
	},
	join: (arr = [], separator = ',') => {
		return (Array.isArray(arr) ? arr.map(toString) : [toString(arr)]).join(toString(separator))
	},
	concat: (...strs) => ''.concat(...strs.map(toString)),
	includes: (str, arg) => {
		return toString(str).includes(toString(arg))
	},
	indexOf: (str, arg, offset) => {
		return toString(str).indexOf(toString(arg), offset)
	},
	lastIndexOf: (str, arg, offset) => {
		return toString(str).lastIndexOf(toString(arg), offset)
	},
	toUpperCase: (str) => {
		return toString(str).toUpperCase()
	},
	toLowerCase: (str) => {
		return toString(str).toLowerCase()
	},
	replaceAll: (str, find, replace) => {
		return toString(str).replaceAll(toString(find), toString(replace))
	},
	stringCompare: (a, b) => {
		return toString(a).localeCompare(toString(b))
	},
	decode: (str, enc) => {
		if (enc === undefined) {
			enc = 'latin1'
		} else {
			enc = '' + enc
		}
		return Buffer.from(toString(str), enc).toString('latin1')
	},
	encode: (str, enc) => {
		if (enc === undefined) {
			enc = 'latin1'
		} else {
			enc = '' + enc
		}
		return Buffer.from(toString(str)).toString(enc)
	},

	encodeURI: (str) => {
		return encodeURI(toString(str))
	},
	decodeURI: (str) => {
		return decodeURI(toString(str))
	},

	encodeURIComponent: (str) => {
		return encodeURIComponent(toString(str))
	},
	decodeURIComponent: (str) => {
		return decodeURIComponent(toString(str))
	},

	// Bool operations
	bool: (v) => {
		if (typeof v === 'string') v = v.toLowerCase()
		return !!v && v !== 'false' && v !== '0'
	},

	// Object/array operations
	jsonpath: (obj, path) => {
		const shouldParseInput = typeof obj === 'string'
		if (shouldParseInput) {
			try {
				obj = JSON.parse(obj)
			} catch (_e) {
				// Ignore
			}
		}

		const value = JSONPath({
			wrap: false,
			path: toString(path),
			json: obj,
		})

		if (shouldParseInput && typeof value !== 'number' && typeof value !== 'string' && value) {
			try {
				return JSON.stringify(value)
			} catch (_e) {
				// Ignore
			}
		}

		return value
	},
	jsonparse: (str) => {
		try {
			return JSON.parse(toString(str))
		} catch (_e) {
			return null
		}
	},
	jsonstringify: (obj) => {
		try {
			return JSON.stringify(obj)
		} catch (_e) {
			return null
		}
	},
	arrayIncludes: (arr, val) => {
		if (!Array.isArray(arr)) return false
		return arr.includes(val)
	},
	arrayIndexOf: (arr, val, offset) => {
		if (!Array.isArray(arr)) return -1
		return arr.indexOf(val, offset)
	},
	arrayLastIndexOf: (arr, val, offset) => {
		if (!Array.isArray(arr)) return -1
		return arr.lastIndexOf(val, offset ?? arr.length)
	},

	// Array iteration. Callbacks receive (value, index). When the callback is an expression-defined
	// arrow function, each invocation is counted against the execution budget (closures self-meter),
	// so a callback over a large array is bounded just like a loop.
	// Named with `array`/`object` prefixes for consistency with arrayIncludes/arrayIndexOf/etc.
	arrayMap: (arr, fn) => {
		if (!Array.isArray(arr)) return undefined
		assertFunction(fn, 'arrayMap')
		return arr.map((value, index) => fn(value, index))
	},
	arrayFilter: (arr, fn) => {
		if (!Array.isArray(arr)) return undefined
		assertFunction(fn, 'arrayFilter')
		return arr.filter((value, index) => fn(value, index))
	},
	arrayReduce: (arr, fn, initial) => {
		if (!Array.isArray(arr)) return undefined
		assertFunction(fn, 'arrayReduce')
		return arr.reduce((accumulator, value, index) => fn(accumulator, value, index), initial)
	},
	arrayForEach: (arr, fn) => {
		if (Array.isArray(arr)) {
			assertFunction(fn, 'arrayForEach')
			arr.forEach((value, index) => fn(value, index))
		}
		return undefined
	},
	arrayFind: (arr, fn) => {
		if (!Array.isArray(arr)) return undefined
		assertFunction(fn, 'arrayFind')
		return arr.find((value, index) => fn(value, index))
	},
	arrayFindIndex: (arr, fn) => {
		if (!Array.isArray(arr)) return -1
		assertFunction(fn, 'arrayFindIndex')
		return arr.findIndex((value, index) => fn(value, index))
	},
	arraySome: (arr, fn) => {
		if (!Array.isArray(arr)) return false
		assertFunction(fn, 'arraySome')
		return arr.some((value, index) => fn(value, index))
	},
	arrayEvery: (arr, fn) => {
		if (!Array.isArray(arr)) return false
		assertFunction(fn, 'arrayEvery')
		return arr.every((value, index) => fn(value, index))
	},
	arraySort: (arr, fn) => {
		if (!Array.isArray(arr)) return undefined
		const copy = [...arr]
		if (fn === undefined) return copy.sort()
		assertFunction(fn, 'arraySort')
		return copy.sort((a, b) => Number(fn(a, b)))
	},
	arrayReverse: (arr) => (Array.isArray(arr) ? [...arr].reverse() : undefined),
	arraySlice: (arr, start, end) => (Array.isArray(arr) ? arr.slice(start, end) : undefined),
	arrayConcat: (...arrs) => ([] as any[]).concat(...arrs.map((arr) => (Array.isArray(arr) ? arr : [arr]))),
	arrayFlat: (arr) => (Array.isArray(arr) ? arr.flat() : undefined),
	objectKeys: (obj) => (obj && typeof obj === 'object' ? Object.keys(obj) : []),
	objectValues: (obj) => (obj && typeof obj === 'object' ? Object.values(obj) : []),

	// Time operations
	unixNow: () => Date.now(),
	timestampToSeconds: (str) => {
		const match = (str + '').match(/^(\d+):(\d+):(\d+)$/i)
		if (match) {
			return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
		} else {
			return 0
		}
	},
	secondsToTimestamp: (v, type) => {
		type = type ? type : 'nHH:mm:ss'
		v = v * 1000
		return msToStamp(v, type)
	},
	msToTimestamp: (v, type) => {
		type = type ? type : 'nmm:ss.S'
		return msToStamp(v, type)
	},
	timeOffset: (time, offset, hr12 = false) => {
		const date = new Date()

		date.setHours(time.split(':')[0])
		date.setMinutes(time.split(':')[1])
		date.setSeconds(time.split(':')[2] || 0)

		let diff = offset

		if (typeof offset === 'string') {
			let hours = 0
			let minutes = 0
			let seconds = 0
			const negative = diff.startsWith('-')

			if (diff.startsWith('+') || diff.startsWith('-')) {
				diff = diff.substr(1)
			}

			if (offset.includes(':')) {
				const split = diff.split(':')
				hours = parseInt(split[0]) || 0
				minutes = parseInt(split[1]) || 0
				seconds = parseInt(split[2]) || 0
			} else {
				hours = parseInt(diff) || 0
			}

			date.setHours(date.getHours() + (negative ? -hours : hours))
			date.setMinutes(date.getMinutes() + (negative ? -minutes : minutes))
			date.setSeconds(date.getSeconds() + (negative ? -seconds : seconds))
		} else {
			date.setHours(date.getHours() + diff)
		}

		const hours24 = date.getHours()
		// In 12 hour mode, map 0 -> 12 (midnight) and 13-23 -> 1-11, and append an AM/PM marker
		const displayHours = pad(hr12 ? (hours24 % 12 === 0 ? 12 : hours24 % 12) : hours24, '0', 2)
		const displayMinutes = pad(date.getMinutes(), '0', 2)
		const displaySeconds = pad(date.getSeconds(), '0', 2)

		if (time.split(':').length === 2) {
			return `${displayHours}:${displayMinutes}`
		} else if (time.split(':').length === 3) {
			return `${displayHours}:${displayMinutes}:${displaySeconds}`
		} else {
			return ''
		}
	},
	timeDiff: (from, to) => {
		let diff = 0
		let fromDate = new Date()
		let toDate = new Date()

		if (from.includes('T')) {
			fromDate = new Date(from)
		} else {
			fromDate.setHours(from.split(':')[0])
			fromDate.setMinutes(from.split(':')[1])
			fromDate.setSeconds(from.split(':')[2] || 0)
		}

		if (to.includes('T')) {
			toDate = new Date(to)
		} else {
			toDate.setHours(to.split(':')[0])
			toDate.setMinutes(to.split(':')[1])
			toDate.setSeconds(to.split(':')[2] || 0)
		}

		diff = toDate.getTime() - fromDate.getTime()

		if (isNaN(diff)) return 'ERR'

		return Math.round(diff / 1000)
	},

	// Date operations (timezone-independent: operates on the absolute instant)
	parseDate: (v) => {
		const d = toDate(v)
		return d ? d.getTime() : null
	},
}

/**
 * Build the timezone-dependent date functions. `getDefaultTimezone` is called whenever a function falls
 * back to the default timezone (i.e. no explicit `tz` argument is passed); in callers that track it, this
 * registers a dependency on the active timezone so the expression re-evaluates when the timezone changes.
 *
 * Rebuilt per evaluation so the getter stays current. Kept separate from the (memoized) static functions
 * so the hot path only rebuilds this small set rather than the full ~60 closures.
 */
function buildDateFunctions(getDefaultTimezone: () => string | undefined): Record<string, (...args: any[]) => any> {
	const resolveTz = (tz: any): string | undefined => (typeof tz === 'string' && tz ? tz : getDefaultTimezone())

	// Add whole calendar units (day/month/year) to `d` as observed in the factory timezone, holding
	// the wall-clock time-of-day constant across DST transitions. Computing this with process-local
	// `Date` setters drifts by an hour when the host and the timezone disagree about DST (e.g. a
	// UTC server running with `America/New_York`), so we decompose in-zone and recompose. Returns null
	// if the zone is invalid.
	const calendarAdd = (d: Date, field: 'day' | 'month' | 'year', amount: number): number | null => {
		const tz = getDefaultTimezone()
		const parts = getZonedDateParts(d, tz)
		if (!parts) return null
		const fields = {
			year: parts.year,
			month: parts.month,
			day: parts.day,
			hour: parts.hour,
			minute: parts.minute,
			second: parts.second,
		}
		fields[field] += amount
		// `zonedTimeToUtc` resolves whole-second wall-clock fields; carry the sub-second part across.
		return zonedTimeToUtc(fields, tz) + d.getMilliseconds()
	}

	return {
		dateYear: (v, tz) => getDatePart(v, resolveTz(tz), 'year'),
		dateMonth: (v, tz) => getDatePart(v, resolveTz(tz), 'month'),
		dateDay: (v, tz) => getDatePart(v, resolveTz(tz), 'day'),
		dateHour: (v, tz) => getDatePart(v, resolveTz(tz), 'hour'),
		dateMinute: (v, tz) => getDatePart(v, resolveTz(tz), 'minute'),
		dateSecond: (v, tz) => getDatePart(v, resolveTz(tz), 'second'),
		dateWeekday: (v, tz) => getDatePart(v, resolveTz(tz), 'weekday'),
		dateFormat: (v, fmt, tz) => {
			const d = toDate(v)
			if (!d) {
				return ''
			}

			const format = fmt ? toString(fmt) : 'YYYY-MM-DDTHH:mm:ss'
			const formatLower = format.toLowerCase()
			if (formatLower === 'iso' || formatLower === 'iso8601') {
				return d.toISOString()
			}

			const parts = getZonedDateParts(d, resolveTz(tz))
			if (!parts) {
				return ''
			}

			const hours12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12

			// dayjs-compatible format tokens, sorted longest-first for greedy matching
			const tokens: Record<string, string> = {
				YYYY: String(parts.year),
				YY: String(parts.year).slice(-2),
				MMMM: monthNames[parts.month - 1],
				MMM: monthShort[parts.month - 1],
				MM: pad(parts.month, '0', 2),
				M: String(parts.month),
				dddd: dayNames[parts.weekday],
				ddd: dayShort[parts.weekday],
				DD: pad(parts.day, '0', 2),
				D: String(parts.day),
				HH: pad(parts.hour, '0', 2),
				H: String(parts.hour),
				hh: pad(hours12, '0', 2),
				h: String(hours12),
				mm: pad(parts.minute, '0', 2),
				m: String(parts.minute),
				ss: pad(parts.second, '0', 2),
				s: String(parts.second),
				SSS: pad(d.getMilliseconds(), '0', 3),
				A: parts.hour >= 12 ? 'PM' : 'AM',
				a: parts.hour >= 12 ? 'pm' : 'am',
			}

			const sortedKeys = Object.keys(tokens).sort((a, b) => b.length - a.length)

			let result = ''
			let i = 0
			while (i < format.length) {
				let matched = false
				for (const key of sortedKeys) {
					if (format.startsWith(key, i)) {
						result += tokens[key]
						i += key.length
						matched = true
						break
					}
				}
				if (!matched) {
					result += format[i]
					i++
				}
			}

			return result
		},
		dateAdd: (v, amount, unit) => {
			const d = toDate(v)
			if (!d) {
				return null
			}

			amount = Number(amount)
			if (!Number.isFinite(amount)) {
				return null
			}

			unit = toString(unit).toLowerCase()

			// Time units are fixed durations, so adding them is plain instant arithmetic (and inherently
			// timezone-independent). Calendar units (day and larger) instead hold the wall-clock
			// time-of-day in the factory timezone, so they go through `calendarAdd` to stay correct
			// across DST boundaries.
			let ts: number | null
			switch (unit) {
				case 'second':
				case 'seconds':
					ts = d.getTime() + amount * 1000
					break
				case 'minute':
				case 'minutes':
					ts = d.getTime() + amount * 60_000
					break
				case 'hour':
				case 'hours':
					ts = d.getTime() + amount * 3_600_000
					break
				case 'day':
				case 'days':
					ts = calendarAdd(d, 'day', amount)
					break
				case 'week':
				case 'weeks':
					ts = calendarAdd(d, 'day', amount * 7)
					break
				case 'month':
				case 'months':
					ts = calendarAdd(d, 'month', amount)
					break
				case 'year':
				case 'years':
					ts = calendarAdd(d, 'year', amount)
					break
				default:
					return null
			}

			return ts !== null && Number.isFinite(ts) ? ts : null
		},
	}
}

/**
 * Get the set of expression functions, with date/time functions defaulting to the given timezone when
 * no explicit `tz` argument is passed.
 *
 * The timezone may be supplied either as a plain IANA name (or undefined/empty for the process-local
 * timezone), or as a getter function. A getter lets callers resolve the timezone lazily and, in Companion,
 * register a dependency on the active timezone so expressions re-evaluate when it changes.
 *
 * Note: when adding new functions, make sure to update the docs!
 *
 * @param defaultTimezone IANA timezone name (or undefined/empty for process-local), or a getter for it
 */
export function createExpressionFunctions(
	defaultTimezone: string | (() => string | undefined) | undefined
): Record<string, (...args: any[]) => any> {
	const getDefaultTimezone =
		typeof defaultTimezone === 'function' ? defaultTimezone : () => defaultTimezone || undefined
	return Object.assign(Object.create(null), STATIC_FUNCTIONS, buildDateFunctions(getDefaultTimezone))
}

/**
 * Name of the builtin expression functions
 */
export const BuiltinFunctionNames = Object.keys(createExpressionFunctions(undefined))
