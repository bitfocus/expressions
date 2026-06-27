# Changelog

## [0.3.0](https://github.com/bitfocus/expressions/compare/v0.2.4...v0.3.0) (2026-06-27)


### Features

* allow defaultTimezone to be a function, to allow the caller to determine if it was used ([d0e6ad0](https://github.com/bitfocus/expressions/commit/d0e6ad0e321f7bc867e0773c76777c5d5e744e25))

## [0.2.4](https://github.com/bitfocus/expressions/compare/v0.2.3...v0.2.4) (2026-06-27)


### Bug Fixes

* review comments for dst handling ([a761d70](https://github.com/bitfocus/expressions/commit/a761d707556c97992ff3c0c5399e1c8196c31c5d))

## [0.2.3](https://github.com/bitfocus/expressions/compare/v0.2.2...v0.2.3) (2026-06-26)


### Bug Fixes

* export BuiltinFunctionNames constant ([b2b258c](https://github.com/bitfocus/expressions/commit/b2b258c39ae7ffca1e2af01860c715e85f49a6ae))

## [0.2.2](https://github.com/bitfocus/expressions/compare/v0.2.1...v0.2.2) (2026-06-26)


### Bug Fixes

* reduce default max operations ([b9deacc](https://github.com/bitfocus/expressions/commit/b9deacc76d9f006857870aac22cbfa71ca93b4dd))

## [0.2.1](https://github.com/bitfocus/expressions/compare/v0.2.0...v0.2.1) (2026-06-26)


### Bug Fixes

* backport template literal interpolation fixes ([6ec8125](https://github.com/bitfocus/expressions/commit/6ec8125e9d3fdffeb6b128560392b328ca55277a))

## [0.2.0](https://github.com/bitfocus/expressions/compare/v0.1.0...v0.2.0) (2026-06-26)


### Features

* add buttons string concat ([ff70323](https://github.com/bitfocus/expressions/commit/ff703239c619fbe1f387a9baac7da621acbdace4))
* add default timezone support for date functions ([661b123](https://github.com/bitfocus/expressions/commit/661b123f0e385b1e336ca7af9899a4f694e03ae6))
* simplify api to keep the list of functions internal, and lean more into the options object ([ca31626](https://github.com/bitfocus/expressions/commit/ca316262adcc0007440255f17f454382adb17db4))
* working port ([75d3191](https://github.com/bitfocus/expressions/commit/75d319112d0ab19015d8cbc2a4de25a4aca9bd63))


### Bug Fixes

* add tests for $(abc.def) syntax ([356104f](https://github.com/bitfocus/expressions/commit/356104fde70dc0771674511a88c471f32b5895f1))
* strip out FindAllReferencedVariables ([94add91](https://github.com/bitfocus/expressions/commit/94add9110044481a86e5fe17b0c8b3fca287a7b9))
