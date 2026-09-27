/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
    clearMocks: true,
    collectCoverage: true,
    collectCoverageFrom: ['./src/**'],
    coverageDirectory: './coverage',
    coverageReporters: ['json-summary', 'text', 'lcov'],
    extensionsToTreatAsEsm: ['.ts'],
    moduleFileExtensions: ['ts', 'js'],
    preset: 'ts-jest',
    resolver: 'ts-jest-resolver',
    testMatch: ['**/*.test.ts'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: '__tests__/tsconfig.json',
                useESM: true,
            },
        ],
    },
    verbose: true,
}
