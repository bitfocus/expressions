# @companion-app/expressions

Parser and evaluator for [Bitfocus Companion](https://bitfocus.io/companion)'s expression dialect.

This package parses Companion expressions (a sandboxed JavaScript-like language with `$(label:name)`
variable references) into an AST and evaluates them against a set of variables and builtin functions.

> **Writing expressions?** If you're looking for documentation on the expression _language_ itself —
> syntax, operators, available functions — see the user guide:
> <https://companion.free/user-guide/beta/expressions/>
>
> The rest of this README covers using the library programmatically.

## Installation

```sh
yarn add @companion-app/expressions
```

## Usage

```ts
import { ExpressionFunctions, ParseExpression, ResolveExpression } from '@companion-app/expressions'

// 1. Parse an expression into an AST. This validates the syntax and rejects
//    anything the evaluator does not support, throwing on invalid input.
const node = ParseExpression('$(internal:time_hms) + " — " + round($(my:temperature))')

// 2. Provide variable values. The callback is invoked for each `$(label:name)` reference.
const variables: Record<string, string | number> = {
	'internal:time_hms': '12:34:56',
	'my:temperature': 21.4,
}

// 3. Evaluate, passing in the builtin functions.
const result = ResolveExpression(node, ({ variableId }) => variables[variableId], ExpressionFunctions)

console.log(result) // "12:34:56 — 21"
```

### Execution limits

Evaluation is sandboxed and bounded. `ResolveExpression` accepts an options object to tune the budget
(useful for cheap, hot paths):

```ts
ResolveExpression(node, getVariable, ExpressionFunctions, {
	maxOperations: 10_000, // loop iterations + function calls before aborting
	maxCallDepth: 50, // closure call-stack depth before aborting
})
```

## API

- `ParseExpression(expression)` — parse + validate a string into an AST node (`SomeExpressionNode`). Throws on invalid syntax.
- `ValidateExpression(node)` — validate an already-parsed acorn AST against the allowed dialect (used internally by `ParseExpression`).
- `ResolveExpression(node, getVariableValue, functions?, options?)` — evaluate a parsed AST and return its value.
- `ExpressionFunctions` — the builtin function library passed to `ResolveExpression`.

## Development

```sh
corepack enable
yarn install
yarn build   # type-check + emit dist/
yarn unit    # run the vitest suite
yarn lint    # eslint
```

## License

MIT
