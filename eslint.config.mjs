import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
	commonRules: {
		'preserve-caught-error': 'off', // Future: Maybe this should be enabled?
		'no-useless-assignment': 'off',
	},
	typescriptRules: {
		'@typescript-eslint/no-this-alias': 'off',
	},
})

const customConfig = [
	...baseConfig,

	{
		// The root tsconfig.json is a solution-style file (files: [] + references), so point the
		// type-aware linter at the actual projects that include the source and test files.
		files: ['**/*.ts', '**/*.mts', '**/*.cts'],
		languageOptions: {
			parserOptions: {
				project: ['./tsconfig.build.json', './tsconfig.tests.json'],
			},
		},
	},

	{
		files: ['**/__tests__/**/*'],
		rules: {
			'n/no-extraneous-require': 'off',
			'n/no-extraneous-import': 'off',
			'n/no-unpublished-require': 'off',
			'n/no-unpublished-import': 'off',
			'n/no-process-exit': 'off',
		},
	},
]

export default customConfig
