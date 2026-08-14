import { colord, extend, type AnyColor, type Colord, type Plugin } from 'colord'
import cmykPlugin from 'colord/plugins/cmyk'
import hwbPlugin from 'colord/plugins/hwb'
import labPlugin from 'colord/plugins/lab'
import mixPlugin from 'colord/plugins/mix'
import namesPlugin from 'colord/plugins/names'

// `names` adds the CSS colour keywords ('red', 'rebeccapurple'), `hwb` and `cmyk` add those models,
// and `mix` backs colorMix() - which interpolates in CIE Lab, so `lab` has to be loaded too even
// though no Lab function is exposed here.
//
// The casts work around colord's typings: its plugins are declared in CommonJS-format `.d.ts` files, so
// under node16 resolution TypeScript types each default import as the whole module namespace, even
// though the ESM build that actually gets loaded default-exports the plugin itself.
extend([namesPlugin, hwbPlugin, cmykPlugin, mixPlugin, labPlugin] as unknown as Plugin[])

/**
 * Parse one channel of a colour model. Values may be plain numbers on the model's own scale
 * (`hsl(120, 50, 50)`), or the percentage strings CSS writes them as (`hsl(120, '50%', '50%')`);
 * `percentScale` is what 100% means for that channel. Anything unparseable gives null so each caller
 * can pick its own fallback. Out-of-range values are left to colord, which clamps them (and wraps hues).
 */
function parseChannel(value: unknown, percentScale: number): number | null {
	if (typeof value === 'string' && value.trim().endsWith('%')) {
		const percent = Number(value.trim().slice(0, -1))
		return Number.isFinite(percent) ? (percent / 100) * percentScale : null
	}

	const num = Number(value)
	return Number.isFinite(num) ? num : null
}

/** A garbled channel falls back to 0, so it drops out rather than invalidating the whole colour. */
function channel(value: unknown, percentScale: number): number {
	return parseChannel(value, percentScale) ?? 0
}

/** Alpha follows CSS in being a 0-1 fraction, and is fully opaque when omitted or unparseable. */
function alphaChannel(value: unknown): number {
	if (value === undefined || value === null) return 1
	return parseChannel(value, 1) ?? 1
}

/**
 * Companion stores colours as 24-bit `0xRRGGBB` numbers in a lot of places (that is what `combineRgb()`
 * produces), so those are accepted anywhere a colour is. Anything outside that range is not one of them,
 * and is rejected rather than guessed at - the 32-bit forms disagree about whether alpha leads or trails.
 */
function colorFromNumber(value: number): Colord | null {
	if (!Number.isInteger(value) || value < 0 || value > 0xffffff) return null

	return colord({ r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff })
}

/**
 * Coerce a value into a colour, from any of the forms these functions accept: a CSS colour string
 * (`'#f00'`, `'rgb(255 0 0)'`, `'hsl(0, 100%, 50%)'`, `'red'`), a 24-bit number, or a component object
 * as returned by the `colorTo*` functions. Returns null when the value is not a colour.
 */
function toColor(value: unknown): Colord | null {
	if (typeof value === 'number') return colorFromNumber(value)
	if (typeof value !== 'string' && (typeof value !== 'object' || value === null || Array.isArray(value))) return null

	const color = colord(value as AnyColor)
	return color.isValid() ? color : null
}

/** Formats a colour the way `colorTo*` and the manipulation functions hand it back. */
function toRgbString(color: Colord): string {
	// colord drops to the plain `rgb()` form when the colour is opaque
	return color.toRgbString()
}

/**
 * Build one of the colour-producing builtins. Called with a single argument it re-formats that colour,
 * whatever form it arrived in; called with the model's channels it builds the colour from them, taking
 * an optional trailing alpha. Two arguments is neither, and fails the same way an unparseable colour does.
 *
 * Every one of these returns a CSS colour string, so the result can be dropped into anything that takes
 * a colour - and reads the same as the equivalent literal typed inside a string.
 */
function buildColorFunction(
	channelCount: number,
	fromChannels: (args: any[]) => AnyColor,
	format: (color: Colord) => string
): (...args: any[]) => string | null {
	return (...args) => {
		if (args.length === 1) {
			const color = toColor(args[0])
			return color ? format(color) : null
		}

		// Otherwise every channel of the model has to be there; a short call is a mistake, not a colour
		if (args.length < channelCount) return null

		const color = colord(fromChannels(args))
		return color.isValid() ? format(color) : null
	}
}

/** Build one of the `colorTo*` functions, which decompose a colour into its channels. */
function buildColorConverter<T>(convert: (color: Colord) => T): (value: any) => T | null {
	return (value) => {
		const color = toColor(value)
		return color ? convert(color) : null
	}
}

/**
 * Build one of the colour manipulation functions. These all take a colour and hand back an `rgb()` /
 * `rgba()` string rather than preserving the format they were given, so the result is something every
 * consumer can read.
 */
function buildColorManipulator(
	manipulate: (color: Colord, ...args: any[]) => Colord
): (...args: any[]) => string | null {
	return (value, ...args) => {
		const color = toColor(value)
		return color ? toRgbString(manipulate(color, ...args)) : null
	}
}

/** How far `colorLighten`/`colorDarken`/`colorSaturate` move a colour when the amount is left out. */
const DEFAULT_ADJUST_AMOUNT = 0.1

/** How much of the second colour `colorMix` takes when the ratio is left out. */
const DEFAULT_MIX_RATIO = 0.5

/**
 * The colour expression functions.
 *
 * The producing half (`rgb`, `hsl`, `hsv`, `hwb`, `cmyk`) mirrors the CSS colour functions, so
 * `rgb(255, 0, 0)` written as an expression and `"rgb(255, 0, 0)"` written inside a string mean the same
 * thing. Models CSS has no function for (`hsv`, and `cmyk` outside of `device-cmyk()`) take their own
 * channels but hand back the equivalent `rgb()` string, so every result is a colour any consumer parses.
 *
 * Called with a single argument instead of channels, each of them converts: `hsl('#336699')` is that
 * colour written as `hsl()`. The parsing half (`colorTo*`) goes the other way, splitting a colour into an
 * object of its channels.
 *
 * Anywhere a colour is taken, it may be a CSS colour string in any of the formats above (plus hex and the
 * CSS colour keywords), a 24-bit `0xRRGGBB` number, or a channel object from one of the `colorTo*`
 * functions. Values that are not colours give null.
 */
export const COLOR_FUNCTIONS: Record<string, (...args: any[]) => any> = {
	// Producing colour strings
	rgb: buildColorFunction(
		3,
		([r, g, b, a]) => ({ r: channel(r, 255), g: channel(g, 255), b: channel(b, 255), a: alphaChannel(a) }),
		toRgbString
	),
	hsl: buildColorFunction(
		3,
		([h, s, l, a]) => ({ h: channel(h, 360), s: channel(s, 100), l: channel(l, 100), a: alphaChannel(a) }),
		(color) => color.toHslString()
	),
	hsv: buildColorFunction(
		3,
		([h, s, v, a]) => ({ h: channel(h, 360), s: channel(s, 100), v: channel(v, 100), a: alphaChannel(a) }),
		toRgbString
	),
	hwb: buildColorFunction(
		3,
		([h, w, b, a]) => ({ h: channel(h, 360), w: channel(w, 100), b: channel(b, 100), a: alphaChannel(a) }),
		toRgbString
	),
	cmyk: buildColorFunction(
		4,
		([c, m, y, k, a]) => ({
			c: channel(c, 100),
			m: channel(m, 100),
			y: channel(y, 100),
			k: channel(k, 100),
			a: alphaChannel(a),
		}),
		toRgbString
	),

	// Parsing colour strings into their channels
	colorToRgb: buildColorConverter((color) => color.toRgb()),
	colorToHsl: buildColorConverter((color) => color.toHsl()),
	colorToHsv: buildColorConverter((color) => color.toHsv()),
	colorToHwb: buildColorConverter((color) => color.toHwb()),
	colorToCmyk: buildColorConverter((color) => color.toCmyk()),
	colorToHex: buildColorConverter((color) => color.toHex()),
	isColor: (value) => toColor(value) !== null,

	// Manipulating colours
	colorAlpha: buildColorManipulator((color, a) => color.alpha(alphaChannel(a))),
	colorLighten: buildColorManipulator((color, amount) =>
		color.lighten(parseChannel(amount, 1) ?? DEFAULT_ADJUST_AMOUNT)
	),
	colorDarken: buildColorManipulator((color, amount) => color.darken(parseChannel(amount, 1) ?? DEFAULT_ADJUST_AMOUNT)),
	// A negative amount desaturates
	colorSaturate: buildColorManipulator((color, amount) =>
		color.saturate(parseChannel(amount, 1) ?? DEFAULT_ADJUST_AMOUNT)
	),
	colorInvert: buildColorManipulator((color) => color.invert()),
	colorMix: (a, b, ratio) => {
		const from = toColor(a)
		const to = toColor(b)
		if (!from || !to) return null

		return toRgbString(from.mix(to, parseChannel(ratio, 1) ?? DEFAULT_MIX_RATIO))
	},
	/** Whether a colour is dark enough to want light text on top of it */
	colorIsDark: buildColorConverter((color) => color.isDark()),
}

// `rgba()`/`hsla()` are the same functions as `rgb()`/`hsl()` in CSS, and are accepted here too so that
// an expression can be written either way round
COLOR_FUNCTIONS.rgba = COLOR_FUNCTIONS.rgb
COLOR_FUNCTIONS.hsla = COLOR_FUNCTIONS.hsl
