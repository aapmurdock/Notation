import type { Plugin } from 'vite'

/** React Fast Refresh needs Vite's inline preamble during development only. */
export function developmentCsp(): Plugin {
  return {
    name: 'notation-development-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
        .replace("connect-src 'self';", "connect-src 'self' ws://127.0.0.1:5173;")
    },
  }
}
