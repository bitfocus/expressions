import { JSONPath } from 'jsonpath-plus'
import { countGraphemes } from 'unicode-segmenter/grapheme'
import { COLOR_FUNCTIONS } from './ColorFunctions.js'
import { getZonedDateParts, zonedTimeToUtc, type ZonedDateParts } from './Timezone.js'
import { msToStamp, pad } from './Util.js'

/*
 * Arguments are whatever the expression evaluated to, so a function must never throw on their type - a
 * throw fails the whole expression, and a variable that is not populated yet (common during startup)
 * would take it down. The coercions below degrade instead, to '' / NaN / null / undefined.
 */

/** Never throws: values with no usable `toString` (`{ toString: 5 }`, a null-prototype object) give ''. */
function toString(v: any): string {
	if (v === undefined) return ''
	if (typeof v === 'string') return v
	try {
		return String(v)
	} catch (_e) {
		return ''
	}
}

/** Never throws: anything without a numeric form gives NaN, which the `Math` builtins propagate. */
function toNumber(v: any): number {
	try {
		return Number(v)
	} catch (_e) {
		return NaN
	}
}

/** As `toNumber`, but keeps `undefined` - an omitted slice end or search offset means "not given". */
function toOptionalNumber(v: any): number | undefined {
	return v === undefined ? undefined : toNumber(v)
}

/** `Math.max`/`Math.min` over the arguments, coercing safely. Matches them for NaN and for an empty list. */
function pickNumeric(args: any[], pick: (a: number, b: number) => number, identity: number): number {
	let result = identity
	for (const arg of args) {
		const num = toNumber(arg)
		if (Number.isNaN(num)) return NaN
		result = pick(result, num)
	}
	return result
}

/** An encoding name, or the default - Buffer throws on one it doesn't know. */
function toBufferEncoding(enc: any): BufferEncoding {
	const name = toString(enc)
	return Buffer.isEncoding(name) ? name : 'latin1'
}

/** Apply a URI builtin, passing the input through when it raises a URIError (a lone surrogate, a stray %). */
function applyUri(str: any, fn: (s: string) => string): string {
	const input = toString(str)
	try {
		return fn(input)
	} catch (_e) {
		return input
	}
}

interface TimeOfDay {
	hours: number
	minutes: number
	seconds: number
	/** So a result can be rendered in the same shape as its input */
	hasSeconds: boolean
}

/**
 * Parse a `HH:mm` or `HH:mm:ss` time-of-day, or null for anything else. Out-of-range components
 * (`25:00`, `12:99`) are kept as-is, for `Date` to roll over as it always has.
 */
function parseTimeOfDay(v: any): TimeOfDay | null {
	const parts = toString(v).trim().split(':')
	if (parts.length !== 2 && parts.length !== 3) return null

	const hours = toNumber(parts[0])
	const minutes = toNumber(parts[1])
	const seconds = parts.length === 3 ? toNumber(parts[2]) : 0
	if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null

	return { hours, minutes, seconds, hasSeconds: parts.length === 3 }
}

/**
 * One end of a `timeDiff`: a full date-time (anything containing a `T`), or a time-of-day against today.
 * Null if it is neither.
 */
function toInstant(v: any): number | null {
	const text = toString(v).trim()

	if (text.includes('T')) {
		const parsed = new Date(text)
		const ts = parsed.getTime()
		return isNaN(ts) ? null : ts
	}

	const time = parseTimeOfDay(text)
	if (!time) return null

	const date = new Date()
	date.setHours(time.hours, time.minutes, time.seconds, 0)
	const ts = date.getTime()
	return isNaN(ts) ? null : ts
}

/**
 * Only a non-empty string can be a format; anything else uses the default rather than being stringified
 * into one `msToStamp` would reject. A malformed string format is still its error to report.
 */
function toStampFormat(type: any, fallback: string): string {
	return typeof type === 'string' && type ? type : fallback
}

/** The shape of a callback argument, once `assertFunction` has vouched for it. */
type ExpressionCallback = (...args: any[]) => any

function assertFunction(fn: unknown, name: string): asserts fn is ExpressionCallback {
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

interface LocaleDateNames {
	monthNames: string[]
	monthShort: string[]
	dayNames: string[]
	dayShort: string[]
}

const englishDateNames: LocaleDateNames = { monthNames, monthShort, dayNames, dayShort }

const localeDateNamesCache = new Map<string, LocaleDateNames>()

/**
 * Normalise a user-supplied locale argument. Returns `undefined` when no usable locale was given, which
 * makes the caller fall back to the runtime's default locale -- the same behaviour as omitting the
 * argument entirely.
 *
 * Well-formed but unsupported tags (`'xx'`, `'zz-ZZ'`) do not throw; `Intl` silently resolves them to the
 * default locale. They are rejected here so that an unusable locale behaves as if it had not been passed,
 * rather than appearing to work. Malformed tags (`'not a locale'`, `'en-XYZ'`) throw and are rejected too.
 *
 * Rejecting unsupported tags here also bounds `localeDateNamesCache`: the locale can come from a variable,
 * so without this an expression could insert an entry per distinct junk string.
 */
function resolveLocale(locale: any): string | undefined {
	if (locale === undefined || locale === null) return undefined
	const str = toString(locale).trim()
	if (!str) return undefined

	try {
		return Intl.DateTimeFormat.supportedLocalesOf(str).length > 0 ? str : undefined
	} catch {
		return undefined
	}
}

/**
 * Localized month/weekday names for the given locale, cached per locale. A `locale` of `undefined` follows
 * the runtime's default locale, matching the `internal:date_weekday` variable (which uses
 * `Date.toLocaleString`). Only the numeric month/weekday index matters here, so the names are
 * timezone-independent; the caller supplies an already timezone-adjusted index. Falls back to English only
 * if `Intl` is unavailable -- callers pass locales through `resolveLocale` first.
 *
 * Keyed on the locale string rather than the locale `Intl` resolves it to, so that a cache hit costs a map
 * lookup and no `Intl.DateTimeFormat` construction. Equivalent spellings ('fr' and 'fr-FR') therefore get
 * their own entries; `resolveLocale` bounds the set of keys that can get this far.
 */
function getLocaleDateNames(locale: string | undefined): LocaleDateNames {
	const cacheKey = locale ?? ''
	const existing = localeDateNamesCache.get(cacheKey)
	if (existing) return existing

	let names: LocaleDateNames
	try {
		const monthLong = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' })
		const monthShortFmt = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
		const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
		const weekdayShortFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })

		const months: string[] = []
		const monthsShort: string[] = []
		for (let m = 0; m < 12; m++) {
			const date = new Date(Date.UTC(2021, m, 15))
			months.push(monthLong.format(date))
			monthsShort.push(monthShortFmt.format(date))
		}

		const days: string[] = []
		const daysShort: string[] = []
		for (let d = 0; d < 7; d++) {
			// 2021-08-01 (UTC) is a Sunday, so index 0 lines up with the weekday index convention
			const date = new Date(Date.UTC(2021, 7, 1 + d))
			days.push(weekdayLong.format(date))
			daysShort.push(weekdayShortFmt.format(date))
		}

		names = { monthNames: months, monthShort: monthsShort, dayNames: days, dayShort: daysShort }
	} catch {
		names = englishDateNames
	}

	localeDateNamesCache.set(cacheKey, names)
	return names
}

/**
 * `resolveLocale` for the injected default locale. `buildDateFunctions` is rebuilt per evaluation, so this
 * memo lives at module level; the default rarely changes, and this keeps the common path (no explicit
 * locale argument) off `supportedLocalesOf`.
 */
let lastDefaultLocaleRaw: any = Symbol('unset')
let lastDefaultLocaleResolved: string | undefined
function resolveDefaultLocale(raw: any): string | undefined {
	if (raw !== lastDefaultLocaleRaw) {
		lastDefaultLocaleRaw = raw
		lastDefaultLocaleResolved = resolveLocale(raw)
	}
	return lastDefaultLocaleResolved
}

/**
 * The timezone-independent expression functions. These never change, so they are defined once as a
 * module-level constant rather than rebuilt per call. `executeExpression` is a hot path (runs for every
 * expression option and feedback evaluation), so this avoids rebuilding ~60 closures on every call; only
 * the small set of timezone-dependent date functions (see buildDateFunctions) is rebuilt per evaluation,
 * since it closes over the per-call timezone getter.
 */
const STATIC_FUNCTIONS: Record<string, (...args: unknown[]) => any> = {
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
	round: (v) => Math.round(toNumber(v)),
	floor: (v) => Math.floor(toNumber(v)),
	ceil: (v) => Math.ceil(toNumber(v)),
	abs: (v) => Math.abs(toNumber(v)),
	fromRadix: (v, radix) => parseInt(toString(v), toNumber(radix) || 10),
	toRadix: (v, radix) => {
		// Clamp the radix to the integer range supported by toString, to avoid a RangeError
		const clamped = Math.min(36, Math.max(2, Math.floor(toNumber(radix)) || 10))
		return toNumber(v).toString(clamped)
	},
	// Clamp dp to the range supported by Number#toFixed, to avoid a RangeError
	toFixed: (v, dp) => toNumber(v).toFixed(Math.min(100, Math.max(0, toNumber(dp) || 0))),
	isNumber: (v) => {
		if (typeof v === 'number' || typeof v === 'bigint') return !Number.isNaN(v)
		// Reject blank strings, which Number() would coerce to 0
		if (typeof v === 'string') return v.trim() !== '' && !isNaN(Number(v))
		return false
	},
	max: (...args) => pickNumeric(args, Math.max, -Infinity),
	min: (...args) => pickNumeric(args, Math.min, Infinity),
	randomInt: (min = 0, max = 10) => {
		let low = toNumber(min)
		let high = toNumber(max)
		if (high < low) [low, high] = [high, low]
		// Use floor over a [0, n+1) range so that min and max are as likely as interior values
		return low + Math.floor(Math.random() * (high - low + 1))
	},
	log: (v, base) => (base === undefined ? Math.log(toNumber(v)) : Math.log(toNumber(v)) / Math.log(toNumber(base))),
	log10: (v) => Math.log10(toNumber(v)),
	exp: (v) => Math.exp(toNumber(v)),
	sqrt: (v) => Math.sqrt(toNumber(v)),
	cbrt: (v) => Math.cbrt(toNumber(v)),
	pow: (base, exponent) => Math.pow(toNumber(base), toNumber(exponent)),
	sin: (v) => Math.sin(toNumber(v)),
	cos: (v) => Math.cos(toNumber(v)),
	tan: (v) => Math.tan(toNumber(v)),
	asin: (v) => Math.asin(toNumber(v)),
	acos: (v) => Math.acos(toNumber(v)),
	atan: (v) => Math.atan(toNumber(v)),
	asinh: (v) => Math.asinh(toNumber(v)),
	acosh: (v) => Math.acosh(toNumber(v)),
	atanh: (v) => Math.atanh(toNumber(v)),

	// String operations
	trim: (v) => toString(v).trim(),
	strlen: (v) => toString(v).length,
	substr: (str, start, end) => {
		return toString(str).slice(toOptionalNumber(start), toOptionalNumber(end))
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
		return toString(str).indexOf(toString(arg), toOptionalNumber(offset))
	},
	lastIndexOf: (str, arg, offset) => {
		return toString(str).lastIndexOf(toString(arg), toOptionalNumber(offset))
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
		return Buffer.from(toString(str), toBufferEncoding(enc)).toString('latin1')
	},
	encode: (str, enc) => {
		return Buffer.from(toString(str)).toString(toBufferEncoding(enc))
	},

	encodeURI: (str) => {
		return applyUri(str, encodeURI)
	},
	decodeURI: (str) => {
		return applyUri(str, decodeURI)
	},

	encodeURIComponent: (str) => {
		return applyUri(str, encodeURIComponent)
	},
	decodeURIComponent: (str) => {
		return applyUri(str, decodeURIComponent)
	},

	// Bool operations
	bool: (v) => {
		if (typeof v === 'string') v = v.toLowerCase()
		return !!v && v !== 'false' && v !== '0'
	},

	// Object/array operations
	jsonpath: (obj, path) => {
		const shouldParseInput = typeof obj === 'string'
		let json: any = obj
		if (shouldParseInput) {
			try {
				json = JSON.parse(json)
			} catch (_e) {
				// Ignore
			}
		}

		let value: any
		try {
			value = JSONPath({
				wrap: false,
				path: toString(path),
				json,
			})
		} catch (_e) {
			// A malformed path matches nothing
			return undefined
		}

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
		return arr.indexOf(val, toOptionalNumber(offset))
	},
	arrayLastIndexOf: (arr, val, offset) => {
		if (!Array.isArray(arr)) return -1
		return arr.lastIndexOf(val, toOptionalNumber(offset) ?? arr.length)
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
		if (fn === undefined) {
			// The default sort orders by string form; go through the safe coercion so one bad element
			// cannot fail the whole sort
			return copy.sort((a, b) => {
				const aStr = toString(a)
				const bStr = toString(b)
				return aStr < bStr ? -1 : aStr > bStr ? 1 : 0
			})
		}
		assertFunction(fn, 'arraySort')
		return copy.sort((a, b) => toNumber(fn(a, b)))
	},
	arrayReverse: (arr) => (Array.isArray(arr) ? [...arr].reverse() : undefined),
	arraySlice: (arr, start, end) =>
		Array.isArray(arr) ? arr.slice(toOptionalNumber(start), toOptionalNumber(end)) : undefined,
	arrayConcat: (...arrs) => ([] as any[]).concat(...arrs.map((arr) => (Array.isArray(arr) ? arr : [arr]))),
	arrayFlat: (arr) => (Array.isArray(arr) ? arr.flat() : undefined),
	objectKeys: (obj) => (obj && typeof obj === 'object' ? Object.keys(obj) : []),
	objectValues: (obj) => (obj && typeof obj === 'object' ? Object.values(obj) : []),

	// Time operations
	unixNow: () => Date.now(),
	timestampToSeconds: (str) => {
		const match = toString(str).match(/^(\d+):(\d+):(\d+)$/i)
		if (match) {
			return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
		} else {
			return 0
		}
	},
	secondsToTimestamp: (v, type) => {
		return msToStamp(toNumber(v) * 1000, toStampFormat(type, 'nHH:mm:ss'))
	},
	msToTimestamp: (v, type) => {
		return msToStamp(toNumber(v), toStampFormat(type, 'nmm:ss.S'))
	},
	timeOffset: (time, offset, hr12 = false) => {
		// Anything that isn't a time-of-day has nothing to shift
		const base = parseTimeOfDay(time)
		if (!base) return ''

		const date = new Date()
		date.setHours(base.hours, base.minutes, base.seconds, 0)

		let offsetHours = 0
		let offsetMinutes = 0
		let offsetSeconds = 0

		if (typeof offset === 'string') {
			let diff = offset
			const negative = diff.startsWith('-')

			if (diff.startsWith('+') || diff.startsWith('-')) {
				diff = diff.substr(1)
			}

			if (diff.includes(':')) {
				const split = diff.split(':')
				offsetHours = parseInt(split[0]) || 0
				offsetMinutes = parseInt(split[1]) || 0
				offsetSeconds = parseInt(split[2]) || 0
			} else {
				offsetHours = parseInt(diff) || 0
			}

			if (negative) {
				offsetHours = -offsetHours
				offsetMinutes = -offsetMinutes
				offsetSeconds = -offsetSeconds
			}
		} else {
			// A missing or non-numeric offset is no offset, rather than an invalid date
			const hours = toNumber(offset)
			offsetHours = Number.isFinite(hours) ? hours : 0
		}

		date.setHours(date.getHours() + offsetHours)
		date.setMinutes(date.getMinutes() + offsetMinutes)
		date.setSeconds(date.getSeconds() + offsetSeconds)

		const hours24 = date.getHours()
		// In 12 hour mode, map 0 -> 12 (midnight) and 13-23 -> 1-11, and append an AM/PM marker
		const displayHours = pad(hr12 ? (hours24 % 12 === 0 ? 12 : hours24 % 12) : hours24, '0', 2)
		const displayMinutes = pad(date.getMinutes(), '0', 2)
		const displaySeconds = pad(date.getSeconds(), '0', 2)

		// `HH:mm` in, `HH:mm` out
		return base.hasSeconds ? `${displayHours}:${displayMinutes}:${displaySeconds}` : `${displayHours}:${displayMinutes}`
	},
	timeDiff: (from, to) => {
		const fromTime = toInstant(from)
		const toTime = toInstant(to)
		if (fromTime === null || toTime === null) return 'ERR'

		const diff = toTime - fromTime
		if (isNaN(diff)) return 'ERR'

		return Math.round(diff / 1000)
	},

	// Date operations (timezone-independent: operates on the absolute instant)
	parseDate: (v) => {
		const d = toDate(v)
		return d ? d.getTime() : null
	},

	// Colour operations
	...COLOR_FUNCTIONS,
}

/**
 * Build the timezone-dependent date functions. `getDefaultTimezone` is called whenever a function falls
 * back to the default timezone (i.e. no explicit `tz` argument is passed); in callers that track it, this
 * registers a dependency on the active timezone so the expression re-evaluates when the timezone changes.
 * `getDefaultLocale` works the same way for `dateFormat`'s month/weekday names, and returning `undefined`
 * from it (the default) means the runtime's own locale is used.
 *
 * Rebuilt per evaluation so the getter stays current. Kept separate from the (memoized) static functions
 * so the hot path only rebuilds this small set rather than the full ~60 closures.
 */
function buildDateFunctions(
	getDefaultTimezone: () => string | undefined,
	getDefaultLocale: () => string | undefined
): Record<string, (...args: unknown[]) => any> {
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
		dateFormat: (v, fmt, tz, locale) => {
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

			// Localized month/weekday names. `locale` is optional; when omitted the runtime's default
			// locale is used, matching the `internal:date_weekday` variable's `toLocaleString` behaviour.
			const names = getLocaleDateNames(resolveLocale(locale) ?? resolveDefaultLocale(getDefaultLocale()))

			// dayjs-compatible format tokens, sorted longest-first for greedy matching
			const tokens: Record<string, string> = {
				YYYY: String(parts.year),
				YY: String(parts.year).slice(-2),
				MMMM: names.monthNames[parts.month - 1],
				MMM: names.monthShort[parts.month - 1],
				MM: pad(parts.month, '0', 2),
				M: String(parts.month),
				dddd: names.dayNames[parts.weekday],
				ddd: names.dayShort[parts.weekday],
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

			const by = toNumber(amount)
			if (!Number.isFinite(by)) {
				return null
			}

			const field = toString(unit).toLowerCase()

			// Time units are fixed durations, so adding them is plain instant arithmetic (and inherently
			// timezone-independent). Calendar units (day and larger) instead hold the wall-clock
			// time-of-day in the factory timezone, so they go through `calendarAdd` to stay correct
			// across DST boundaries.
			let ts: number | null
			switch (field) {
				case 'second':
				case 'seconds':
					ts = d.getTime() + by * 1000
					break
				case 'minute':
				case 'minutes':
					ts = d.getTime() + by * 60_000
					break
				case 'hour':
				case 'hours':
					ts = d.getTime() + by * 3_600_000
					break
				case 'day':
				case 'days':
					ts = calendarAdd(d, 'day', by)
					break
				case 'week':
				case 'weeks':
					ts = calendarAdd(d, 'day', by * 7)
					break
				case 'month':
				case 'months':
					ts = calendarAdd(d, 'month', by)
					break
				case 'year':
				case 'years':
					ts = calendarAdd(d, 'year', by)
					break
				default:
					return null
			}

			return ts !== null && Number.isFinite(ts) ? ts : null
		},
	}
}

/**
 * The shortest cycle the clock-driven builtins will honour, regardless of how fine the host's clock is.
 * A shorter one would let an expression ask for a strobe (a `square` wave at 100ms already toggles at
 * 10Hz), and a cycle of 0 would hand the host a division by zero. A coarse clock raises this floor
 * further, but nothing lowers it.
 */
export const MIN_CLOCK_PERIOD_MS = 100

/** The portion of each interval `blink()` spends in its "on" state when the expression does not say. */
export const BLINK_DEFAULT_DUTY_CYCLE = 0.5

/**
 * Build the `blink` builtin around a host-supplied on/off state. The arguments are validated here so
 * every host sees the same canonical numbers - `blink('1000')` and `blink(1000)` are the same blink,
 * which also matters where the host derives a key or a dependency from them.
 */
export function buildBlinkFunction(
	isOn: (intervalMs: number, dutyCycle: number) => boolean
): (interval: any, dutyCycle?: any) => 0 | 1 {
	return (interval, dutyCycle) => {
		// Clamp before checking, as in `oscillate`: `Math.max(100, NaN)` is NaN, so a non-numeric interval
		// reads as off rather than silently becoming the minimum interval.
		const intervalMs = Math.max(MIN_CLOCK_PERIOD_MS, toNumber(interval))
		if (isNaN(intervalMs)) return 0

		const rawDutyCycle = toNumber(dutyCycle)
		const clampedDutyCycle = isNaN(rawDutyCycle) ? BLINK_DEFAULT_DUTY_CYCLE : Math.min(Math.max(rawDutyCycle, 0), 1)

		return isOn(intervalMs, clampedDutyCycle) ? 1 : 0
	}
}

/** The host clock backing `oscillate()`. */
export interface OscillateClock {
	/**
	 * Given the period of the oscillation in milliseconds (already validated and clamped), return the
	 * current position within that cycle as a fraction: 0 at the start of a cycle, approaching 1 at the
	 * end. Values outside 0-1 are wrapped.
	 *
	 * Aligning the fraction to the unix epoch keeps separate evaluations of the same period in sync.
	 */
	getCycleFraction: (periodMs: number) => number

	/**
	 * How far apart consecutive samples of that clock can be - typically `1000 / redraw rate`, and the
	 * same figure the host quantises its own clock to (Companion redraws at 10Hz, so it passes 100).
	 *
	 * It raises the effective minimum period, and is how far before the end of the cycle the `sawtooth`
	 * ramp reaches 1 - without that the ramp would jump from its last sampled value straight back to 0 and
	 * never actually reach full scale. Omit for a continuous clock.
	 */
	granularityMs?: number
}

/**
 * Build the `oscillate` builtin around a host-supplied clock. The phase offset and waveform shaping are
 * applied on top of the clock here, so a host only has to say where it is in the cycle and how finely it
 * can tell.
 *
 * Rebuilt per evaluation so the clock stays current, in the same way as the date functions.
 */
export function buildOscillateFunction(clock: OscillateClock): (period: any, waveform?: any, phase?: any) => number {
	const granularityMs = Math.max(0, toNumber(clock.granularityMs) || 0)
	const minPeriodMs = Math.max(MIN_CLOCK_PERIOD_MS, granularityMs)

	return (period, waveform, phase) => {
		// Note: clamp first, then check. `Math.max(100, NaN)` is NaN, so a non-numeric period yields 0
		// rather than silently becoming the minimum period.
		const periodMs = Math.max(minPeriodMs, toNumber(period))
		if (isNaN(periodMs)) return 0

		const phaseOffset = toNumber(phase)
		const raw = clock.getCycleFraction(periodMs) + (isNaN(phaseOffset) ? 0 : phaseOffset)

		// Wrap into 0-1, tolerating both out-of-range clocks and negative phase offsets
		const t = ((raw % 1) + 1) % 1

		switch (typeof waveform === 'string' ? waveform.toLowerCase() : 'sine') {
			case 'sine':
				// Shifted a quarter turn so the cycle starts at 0, peaks at 1 halfway, and returns to 0
				return (Math.sin(2 * Math.PI * t - Math.PI / 2) + 1) / 2
			case 'triangle':
				return t < 0.5 ? 2 * t : 2 * (1 - t)
			case 'sawtooth':
				// A cycle no longer than one sample can't be ramped through at all
				return periodMs <= granularityMs ? 0 : Math.min((t * periodMs) / (periodMs - granularityMs), 1)
			case 'square':
			default:
				// Also the fallback for an unrecognised waveform name
				return t < 0.5 ? 1 : 0
		}
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
 * `defaultLocale` works the same way, and controls the month/weekday names `dateFormat` produces when no
 * explicit locale argument is given. Leaving it unset (or supplying an empty/unsupported value) uses the
 * runtime's own locale, which matches what `Date.toLocaleString` gives the `internal:date_weekday`
 * variable -- so a caller that has no locale setting of its own can simply omit it.
 *
 * Note: when adding new functions, make sure to update the docs!
 *
 * @param defaultTimezone IANA timezone name (or undefined/empty for process-local), or a getter for it
 * @param defaultLocale BCP 47 locale tag (or undefined/empty for the runtime locale), or a getter for it
 */
export function createExpressionFunctions(
	defaultTimezone: string | (() => string | undefined) | undefined,
	defaultLocale?: string | (() => string | undefined)
): Record<string, (...args: any[]) => any> {
	const getDefaultTimezone =
		typeof defaultTimezone === 'function' ? defaultTimezone : () => defaultTimezone || undefined
	const getDefaultLocale = typeof defaultLocale === 'function' ? defaultLocale : () => defaultLocale || undefined
	return Object.assign(Object.create(null), STATIC_FUNCTIONS, buildDateFunctions(getDefaultTimezone, getDefaultLocale))
}

/**
 * Name of the builtin expression functions
 */
export const BuiltinFunctionNames = Object.keys(createExpressionFunctions(undefined))
