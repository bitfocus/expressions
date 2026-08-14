import { describe, expect, it } from 'vitest'
import { createExpressionFunctions } from '../ExpressionFunctions.js'
import { ParseExpression } from '../ExpressionParse.js'
import { ResolveExpression } from '../ExpressionResolve.js'

const ExpressionFunctions = createExpressionFunctions(undefined)

const VARS: Record<string, any> = {
	'custom:brand': '#336699',
	'custom:legacy_color': 0xff0000,
	'custom:hue': 210,
}

function run(expr: string): any {
	return ResolveExpression(ParseExpression(expr), {
		unknownVariableValue: '$NA',
		getVariableValue: (variableId: string) => VARS[variableId],
		parseVariables: null,
	})
}

describe('colour functions', () => {
	describe('producing colour strings', () => {
		it('rgb', () => {
			expect(ExpressionFunctions.rgb(255, 0, 0)).toBe('rgb(255, 0, 0)')
			expect(ExpressionFunctions.rgb(51, 102, 153)).toBe('rgb(51, 102, 153)')
			// An alpha of 1 is the plain rgb() form, as in CSS
			expect(ExpressionFunctions.rgb(255, 0, 0, 1)).toBe('rgb(255, 0, 0)')
			expect(ExpressionFunctions.rgb(255, 0, 0, 0.5)).toBe('rgba(255, 0, 0, 0.5)')
			// Out of range channels clamp, fractional ones round
			expect(ExpressionFunctions.rgb(300, -5, 3.6)).toBe('rgb(255, 0, 4)')
			// Channels may be written as percentages, the way CSS allows
			expect(ExpressionFunctions.rgb('100%', '0%', '0%')).toBe('rgb(255, 0, 0)')
			expect(ExpressionFunctions.rgb(255, 0, 0, '50%')).toBe('rgba(255, 0, 0, 0.5)')
			// Strings are accepted for channels, as every variable arrives as one
			expect(ExpressionFunctions.rgb('255', '0', '0')).toBe('rgb(255, 0, 0)')
		})

		it('rgba is the same function as rgb', () => {
			expect(ExpressionFunctions.rgba).toBe(ExpressionFunctions.rgb)
			expect(ExpressionFunctions.rgba(255, 0, 0, 0.5)).toBe('rgba(255, 0, 0, 0.5)')
		})

		it('hsl', () => {
			expect(ExpressionFunctions.hsl(120, 50, 50)).toBe('hsl(120, 50%, 50%)')
			expect(ExpressionFunctions.hsl(120, '50%', '50%')).toBe('hsl(120, 50%, 50%)')
			expect(ExpressionFunctions.hsl(120, 50, 50, 0.5)).toBe('hsla(120, 50%, 50%, 0.5)')
			// Hues wrap, so an expression can rotate one without normalising it first
			expect(ExpressionFunctions.hsl(400, 50, 50)).toBe('hsl(40, 50%, 50%)')
			expect(ExpressionFunctions.hsla).toBe(ExpressionFunctions.hsl)
		})

		it('hsv', () => {
			// No CSS hsv() exists, so the equivalent rgb() string comes back
			expect(ExpressionFunctions.hsv(120, 100, 100)).toBe('rgb(0, 255, 0)')
			expect(ExpressionFunctions.hsv(0, 0, 100)).toBe('rgb(255, 255, 255)')
			expect(ExpressionFunctions.hsv(120, 100, 100, 0.5)).toBe('rgba(0, 255, 0, 0.5)')
		})

		it('hwb', () => {
			expect(ExpressionFunctions.hwb(120, 20, 30)).toBe('rgb(51, 179, 51)')
			expect(ExpressionFunctions.hwb(120, 20, 30, 0.5)).toBe('rgba(51, 179, 51, 0.5)')
		})

		it('cmyk', () => {
			expect(ExpressionFunctions.cmyk(0, 54, 100, 25)).toBe('rgb(191, 88, 0)')
			expect(ExpressionFunctions.cmyk(0, 0, 0, 0)).toBe('rgb(255, 255, 255)')
			expect(ExpressionFunctions.cmyk(0, 54, 100, 25, 0.5)).toBe('rgba(191, 88, 0, 0.5)')
			// cmyk has four channels, so three is a short call rather than a colour
			expect(ExpressionFunctions.cmyk(0, 54, 100)).toBe(null)
		})

		it('rejects calls that are missing channels', () => {
			expect(ExpressionFunctions.rgb()).toBe(null)
			expect(ExpressionFunctions.rgb(1, 2)).toBe(null)
			expect(ExpressionFunctions.hsl(120, 50)).toBe(null)
		})

		it('unparseable channels fall back rather than failing', () => {
			// A garbled channel drops to 0, but a garbled alpha stays opaque - a colour that silently
			// turned invisible would be much harder to spot than one that came out the wrong shade
			expect(ExpressionFunctions.rgb('nope', 0, 0)).toBe('rgb(0, 0, 0)')
			expect(ExpressionFunctions.rgb(255, 0, 0, 'nope')).toBe('rgb(255, 0, 0)')
		})
	})

	describe('converting between formats', () => {
		it('re-formats a colour given as a single argument', () => {
			expect(ExpressionFunctions.rgb('red')).toBe('rgb(255, 0, 0)')
			expect(ExpressionFunctions.rgb('#336699')).toBe('rgb(51, 102, 153)')
			expect(ExpressionFunctions.hsl('#336699')).toBe('hsl(210, 50%, 40%)')
			expect(ExpressionFunctions.rgb('hsl(120, 50%, 50%)')).toBe('rgb(64, 191, 64)')
			expect(ExpressionFunctions.hsl('rgb(64, 191, 64)')).toBe('hsl(120, 50%, 50%)')
		})

		it('accepts every colour format it produces', () => {
			expect(ExpressionFunctions.rgb('#369')).toBe('rgb(51, 102, 153)')
			expect(ExpressionFunctions.rgb('#336699cc')).toBe('rgba(51, 102, 153, 0.8)')
			expect(ExpressionFunctions.rgb('rebeccapurple')).toBe('rgb(102, 51, 153)')
			expect(ExpressionFunctions.rgb('hwb(120 20% 30%)')).toBe('rgb(51, 179, 51)')
			expect(ExpressionFunctions.rgb('device-cmyk(0% 54% 100% 25%)')).toBe('rgb(191, 88, 0)')
			// The modern space-separated CSS syntax, alongside the legacy comma-separated one
			expect(ExpressionFunctions.rgb('rgb(1 2 3 / 50%)')).toBe('rgba(1, 2, 3, 0.5)')
		})

		it('accepts the 24-bit numbers companion stores colours as', () => {
			expect(ExpressionFunctions.rgb(0xff0000)).toBe('rgb(255, 0, 0)')
			expect(ExpressionFunctions.rgb(16711680)).toBe('rgb(255, 0, 0)')
			expect(ExpressionFunctions.rgb(255)).toBe('rgb(0, 0, 255)')
			expect(ExpressionFunctions.hsl(0xff0000)).toBe('hsl(0, 100%, 50%)')
			// Anything outside the 24-bit range is not one of them, and is not guessed at
			expect(ExpressionFunctions.rgb(0x1000000)).toBe(null)
			expect(ExpressionFunctions.rgb(-1)).toBe(null)
			expect(ExpressionFunctions.rgb(1.5)).toBe(null)
		})

		it('round-trips through the channel objects', () => {
			expect(ExpressionFunctions.rgb(ExpressionFunctions.colorToHsl('#336699'))).toBe('rgb(51, 102, 153)')
			expect(ExpressionFunctions.hsl(ExpressionFunctions.colorToRgb('#336699'))).toBe('hsl(210, 50%, 40%)')
			expect(ExpressionFunctions.rgb(ExpressionFunctions.colorToHwb('#336699'))).toBe('rgb(51, 102, 153)')
			expect(ExpressionFunctions.rgb(ExpressionFunctions.colorToCmyk('#bf5700'))).toBe('rgb(191, 88, 0)')
		})

		it('gives null for things that are not colours', () => {
			expect(ExpressionFunctions.rgb('nope')).toBe(null)
			expect(ExpressionFunctions.rgb('')).toBe(null)
			expect(ExpressionFunctions.rgb(undefined)).toBe(null)
			expect(ExpressionFunctions.rgb(null)).toBe(null)
			expect(ExpressionFunctions.rgb([1, 2, 3])).toBe(null)
			expect(ExpressionFunctions.hsl('nope')).toBe(null)
		})
	})

	describe('parsing colours into channels', () => {
		it('colorToRgb', () => {
			expect(ExpressionFunctions.colorToRgb('#336699')).toEqual({ r: 51, g: 102, b: 153, a: 1 })
			expect(ExpressionFunctions.colorToRgb('#336699cc')).toEqual({ r: 51, g: 102, b: 153, a: 0.8 })
			expect(ExpressionFunctions.colorToRgb('red')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
			expect(ExpressionFunctions.colorToRgb('hsl(210, 50%, 40%)')).toEqual({ r: 51, g: 102, b: 153, a: 1 })
			expect(ExpressionFunctions.colorToRgb(0x336699)).toEqual({ r: 51, g: 102, b: 153, a: 1 })
			expect(ExpressionFunctions.colorToRgb('nope')).toBe(null)
		})

		it('colorToHsl', () => {
			expect(ExpressionFunctions.colorToHsl('#336699')).toEqual({ h: 210, s: 50, l: 40, a: 1 })
			expect(ExpressionFunctions.colorToHsl('nope')).toBe(null)
		})

		it('colorToHsv', () => {
			expect(ExpressionFunctions.colorToHsv('#336699')).toEqual({ h: 210, s: 67, v: 60, a: 1 })
			expect(ExpressionFunctions.colorToHsv('nope')).toBe(null)
		})

		it('colorToHwb', () => {
			expect(ExpressionFunctions.colorToHwb('#336699')).toEqual({ h: 210, w: 20, b: 40, a: 1 })
			expect(ExpressionFunctions.colorToHwb('nope')).toBe(null)
		})

		it('colorToCmyk', () => {
			expect(ExpressionFunctions.colorToCmyk('#bf5700')).toEqual({ c: 0, m: 54, y: 100, k: 25, a: 1 })
			expect(ExpressionFunctions.colorToCmyk('nope')).toBe(null)
		})

		it('colorToHex', () => {
			expect(ExpressionFunctions.colorToHex('rgb(51, 102, 153)')).toBe('#336699')
			expect(ExpressionFunctions.colorToHex('rgba(51, 102, 153, 0.8)')).toBe('#336699cc')
			expect(ExpressionFunctions.colorToHex('red')).toBe('#ff0000')
			expect(ExpressionFunctions.colorToHex(0x336699)).toBe('#336699')
			expect(ExpressionFunctions.colorToHex('nope')).toBe(null)
		})

		it('isColor', () => {
			expect(ExpressionFunctions.isColor('red')).toBe(true)
			expect(ExpressionFunctions.isColor('#336699')).toBe(true)
			expect(ExpressionFunctions.isColor('hsl(210, 50%, 40%)')).toBe(true)
			expect(ExpressionFunctions.isColor(0xff0000)).toBe(true)
			expect(ExpressionFunctions.isColor({ r: 51, g: 102, b: 153 })).toBe(true)
			expect(ExpressionFunctions.isColor('nope')).toBe(false)
			expect(ExpressionFunctions.isColor('')).toBe(false)
			expect(ExpressionFunctions.isColor(undefined)).toBe(false)
			expect(ExpressionFunctions.isColor(true)).toBe(false)
		})
	})

	describe('manipulating colours', () => {
		it('colorAlpha', () => {
			expect(ExpressionFunctions.colorAlpha('red', 0.25)).toBe('rgba(255, 0, 0, 0.25)')
			expect(ExpressionFunctions.colorAlpha('red', '50%')).toBe('rgba(255, 0, 0, 0.5)')
			expect(ExpressionFunctions.colorAlpha('rgba(255, 0, 0, 0.5)', 1)).toBe('rgb(255, 0, 0)')
			expect(ExpressionFunctions.colorAlpha('nope', 0.5)).toBe(null)
		})

		it('colorLighten and colorDarken', () => {
			expect(ExpressionFunctions.colorLighten('#808080', 0.2)).toBe('rgb(179, 179, 179)')
			expect(ExpressionFunctions.colorDarken('#808080', 0.2)).toBe('rgb(77, 77, 77)')
			// Default step
			expect(ExpressionFunctions.colorLighten('#808080')).toBe('rgb(154, 154, 154)')
			expect(ExpressionFunctions.colorLighten('nope', 0.2)).toBe(null)
		})

		it('colorSaturate', () => {
			// A negative amount desaturates
			expect(ExpressionFunctions.colorSaturate('#bf5700', -0.2)).toBe('rgb(172, 89, 19)')
			expect(ExpressionFunctions.colorSaturate('nope')).toBe(null)
		})

		it('colorInvert', () => {
			expect(ExpressionFunctions.colorInvert('#000000')).toBe('rgb(255, 255, 255)')
			expect(ExpressionFunctions.colorInvert('#bf5700')).toBe('rgb(64, 168, 255)')
			expect(ExpressionFunctions.colorInvert('nope')).toBe(null)
		})

		it('colorMix', () => {
			expect(ExpressionFunctions.colorMix('red', 'blue')).toBe('rgb(193, 0, 136)')
			expect(ExpressionFunctions.colorMix('red', 'blue', 0)).toBe('rgb(255, 0, 0)')
			expect(ExpressionFunctions.colorMix('red', 'blue', 1)).toBe('rgb(0, 0, 255)')
			expect(ExpressionFunctions.colorMix('red', 'nope')).toBe(null)
			expect(ExpressionFunctions.colorMix('nope', 'blue')).toBe(null)
		})

		it('colorIsDark', () => {
			expect(ExpressionFunctions.colorIsDark('#000000')).toBe(true)
			expect(ExpressionFunctions.colorIsDark('#ffffff')).toBe(false)
			expect(ExpressionFunctions.colorIsDark('nope')).toBe(null)
		})

		it('preserves alpha through a manipulation', () => {
			expect(ExpressionFunctions.colorLighten('rgba(191, 87, 0, 0.5)', 0.2)).toBe('rgba(255, 137, 38, 0.5)')
		})
	})

	describe('in expressions', () => {
		it('produces a colour string usable as one', () => {
			expect(run('rgb(255, 0, 0)')).toBe('rgb(255, 0, 0)')
			expect(run('hsl(120, 50, 50)')).toBe('hsl(120, 50%, 50%)')
		})

		it('reads back a colour written inside a string', () => {
			expect(run(`colorToHex('rgb(255, 0, 0)')`)).toBe('#ff0000')
			// ...including one this dialect produced itself
			expect(run(`colorToHex(rgb(255, 0, 0))`)).toBe('#ff0000')
		})

		it('picks the channels out of a variable', () => {
			expect(run('colorToRgb($(custom:brand)).r')).toBe(51)
			expect(run('colorToRgb($(custom:brand)).a')).toBe(1)
			expect(run('colorToHsl($(custom:brand)).h')).toBe(210)
			expect(run('colorToHex($(custom:legacy_color))')).toBe('#ff0000')
		})

		it('builds a colour out of a variable', () => {
			expect(run('hsl($(custom:hue), 50, 40)')).toBe('hsl(210, 50%, 40%)')
			expect(run('rgb($(custom:legacy_color))')).toBe('rgb(255, 0, 0)')
		})

		it('interpolates into a template literal', () => {
			expect(run('`2px solid ${rgb(255, 0, 0)}`')).toBe('2px solid rgb(255, 0, 0)')
		})

		it('picks a readable text colour for a background', () => {
			expect(run(`colorIsDark($(custom:brand)) ? '#ffffff' : '#000000'`)).toBe('#ffffff')
		})

		it('rotates the hue of a colour', () => {
			const expr = `
				const base = colorToHsl($(custom:brand))
				hsl(base.h + 180, base.s, base.l)
			`
			expect(run(expr)).toBe('hsl(30, 50%, 40%)')
		})

		it('fades between two colours', () => {
			expect(run(`colorMix('#000000', '#ffffff', 0.5)`)).toBe('rgb(119, 119, 119)')
		})
	})
})
