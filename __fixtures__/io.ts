import type * as io from '@actions/io'
import { jest } from '@jest/globals'

export const which = jest.fn<typeof io.which>()
