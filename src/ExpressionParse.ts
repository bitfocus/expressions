import * as acorn from 'acorn'
import { ValidateExpression } from './ExpressionValidate.js'
import {
	repeatedUnaryAcornPlugin,
	templateLiteralAsiAcornPlugin,
	topLevelObjectLiteralAcornPlugin,
} from './Plugins/CompanionDialect.js'
import { companionVariablesAcornPlugin } from './Plugins/CompanionVariables.js'

// An acorn parser extended to understand Companion's expression dialect: `$(label:name)` variable
// references plus a handful of dialect quirks (top-level object literals, `--1` as repeated unary,
// and tagged-template ASI). Each concern is a focused plugin; they override disjoint methods so order
// does not matter.
const ExpressionAcornParser = acorn.Parser.extend(
	companionVariablesAcornPlugin,
	topLevelObjectLiteralAcornPlugin,
	repeatedUnaryAcornPlugin,
	templateLiteralAsiAcornPlugin
)

const PARSE_OPTIONS: acorn.Options = {
	ecmaVersion: 'latest',
	sourceType: 'script',
	// The expression dialect supports a top-level `return`, which is a syntax error in plain script mode
	allowReturnOutsideFunction: true,
}

/**
 * The parsed form of an expression. This is an acorn `Program` node (ESTree), evaluated by ResolveExpression.
 */
export type SomeExpressionNode = acorn.Node

/**
 * Parse an expression into executable nodes
 */
export function ParseExpression(expression: string): SomeExpressionNode {
	let parsed: SomeExpressionNode
	try {
		parsed = ExpressionAcornParser.parse(expression, PARSE_OPTIONS)
	} catch (e) {
		// Normalise acorn's SyntaxError into a plain Error (preserving its message + position)
		throw new Error(e instanceof Error ? e.message : String(e))
	}

	// Reject any syntax the evaluator does not support, with a clear error
	ValidateExpression(parsed)

	return parsed
}
