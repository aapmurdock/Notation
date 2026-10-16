import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter'
import { relative } from 'node:path'

const escape = (text: string): string => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')

/** Preserve actionable timeout context in checks even when log/artifact downloads are unavailable. */
export default class CiDiagnosticsReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === test.expectedStatus || result.status === 'skipped') return
    const flatten = (steps: TestStep[]): TestStep[] => steps.flatMap(step => [step, ...flatten(step.steps)])
    const actions = flatten(result.steps).filter(step => step.category === 'pw:api')
    const last = actions.slice(-10).map(step => {
      const location = step.location ? ` (${relative(process.cwd(), step.location.file)}:${step.location.line})` : ''
      return `${step.title} [${step.duration}ms]${location}${step.error ? `\n${step.error.message ?? ''}` : ''}`
    }).join('\n')
    const failed = [...actions].reverse().find(step => step.error)
    const location = failed?.location ?? test.location
    const file = relative(process.cwd(), location.file).replaceAll('\\', '/')
    const message = `${test.titlePath().join(' > ')}\nLast actions before ${result.status}:\n${last}`
    process.stdout.write(`::error file=${file},line=${Math.max(1, location.line)},title=Playwright failure context::${escape(message.slice(-12000))}\n`)
  }
}
