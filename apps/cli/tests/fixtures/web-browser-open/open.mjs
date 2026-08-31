import { spawn } from 'node:child_process'
import { join } from 'node:path'

const handoffProbe = `
const { writeFileSync } = require('node:fs')
const marker = process.argv[1]
const helperPid = Number(process.argv[2])
setTimeout(() => {
  let helperAlive = true
  if (process.platform === 'win32') {
    try {
      process.kill(helperPid, 0)
    } catch {
      helperAlive = false
    }
  }
  if (helperAlive) writeFileSync(marker, '')
}, 50)
`

export default async function open(url) {
  if (process.env.BROWSER_OPEN_TEST_FAILURE !== undefined) {
    throw new Error(process.env.BROWSER_OPEN_TEST_FAILURE)
  }
  const first = await fetch(url, { redirect: 'manual' })
  const setCookie = first.headers.get('set-cookie')
  const location = first.headers.get('location')
  const authenticationExchange = first.status === 303
  let response = first
  if (authenticationExchange) {
    if (setCookie === null || location === null) {
      throw new Error('browser authentication exchange omitted its cookie or redirect')
    }
    response = await fetch(new URL(location, url), {
      headers: { cookie: setCookie.split(';', 1)[0] },
    })
  } else if (first.status !== 200) {
    throw new Error(`browser handoff returned HTTP ${first.status}`)
  }
  const html = await response.text()
  console.log(`dsh browser-open: ${JSON.stringify({
    url,
    status: response.status,
    authenticationExchange,
    bootManifest: html.includes('__DSH_BOOT__'),
    apiKeyPresent: process.env.DEEPSEEK_API_KEY !== undefined,
    dshHomePresent: process.env.DSH_HOME !== undefined,
  })}`)
  // The Windows launcher writes the server-exit marker only while its helper
  // remains alive, so the assembled test detects an early helper exit.
  const launcher = spawn(process.execPath, [
    '--eval', handoffProbe,
    '--', join(process.cwd(), `.dsh-browser-open-${process.ppid}`), String(process.pid),
  ], { stdio: 'ignore' })
  launcher.unref()
  return launcher
}
