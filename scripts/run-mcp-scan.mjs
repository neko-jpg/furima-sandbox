import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const outputDirectory = resolve('output/security');
const configPath = resolve('security/mcp-scan.json');
const hostedAnalysisRequired = process.env.MCP_SCAN_REQUIRE_HOSTED === 'true'
  || (process.env.CI === 'true' && process.env.GITHUB_EVENT_NAME !== 'pull_request');
const requestedScanMode = process.env.MCP_SCAN_MODE;
if (hostedAnalysisRequired && requestedScanMode === 'inspect') {
  throw new Error('MCP-Scan inspect mode cannot bypass hosted analysis on protected CI events.');
}
const scanMode = requestedScanMode ?? (hostedAnalysisRequired || process.env.SNYK_TOKEN ? 'hosted' : 'inspect');

const run = (command, args) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); process.stderr.write(chunk); });
  child.once('error', reject);
  child.once('close', (code, signal) => resolvePromise({ code: code ?? 1, signal, stdout, stderr }));
});

const candidates = process.env.MCP_SCAN_BIN
    ? [{ command: process.env.MCP_SCAN_BIN, prefix: [] }]
    : process.platform === 'win32'
    ? [{ command: 'snyk-agent-scan.exe', prefix: [] }, { command: 'snyk-agent-scan', prefix: [] }, { command: 'uvx.exe', prefix: ['snyk-agent-scan==0.6.0'] }, { command: 'uvx', prefix: ['snyk-agent-scan==0.6.0'] }]
    : [{ command: 'snyk-agent-scan', prefix: [] }, { command: 'uvx', prefix: ['snyk-agent-scan==0.6.0'] }];

await mkdir(outputDirectory, { recursive: true });
let result;
let selected;
for (const candidate of candidates) {
  try {
    selected = candidate;
    result = await run(candidate.command, [...candidate.prefix, 'inspect', configPath, '--json', '--dangerously-run-mcp-servers']);
    break;
  } catch {
    selected = undefined;
  }
}
if (!result || !selected) throw new Error('MCP-Scan is not installed. Install `snyk-agent-scan==0.6.0` or provide MCP_SCAN_BIN.');
if (result.code !== 0) throw new Error(`MCP-Scan inspect failed with exit code ${result.code}${result.signal ? ` (${result.signal})` : ''}`);

const inspection = result.stdout ? JSON.parse(result.stdout) : null;
if (!inspection || typeof inspection !== 'object' || Object.keys(inspection).length === 0) {
  throw new Error('MCP-Scan inspect returned empty or invalid analysis output.');
}
if (scanMode === 'hosted') {
  if (!process.env.SNYK_TOKEN) {
    throw new Error('MCP-Scan hosted analysis requires SNYK_TOKEN. Protected CI events fail closed when it is missing.');
  }
  const analysis = await run(selected.command, [...selected.prefix, configPath, '--json', '--ci', '--dangerously-run-mcp-servers']);
  await writeFile(resolve(outputDirectory, 'mcp-scan.json'), analysis.stdout || JSON.stringify({ ok: false, stderr: analysis.stderr }, null, 2));
  if (analysis.code !== 0) throw new Error(`MCP-Scan analysis failed with exit code ${analysis.code}${analysis.signal ? ` (${analysis.signal})` : ''}`);
} else if (scanMode === 'inspect') {
  await writeFile(resolve(outputDirectory, 'mcp-scan.json'), JSON.stringify({
    ok: true,
    mode: 'inspect',
    analysis: 'not-run',
    reason: 'MCP_SCAN_MODE=inspect; local MCP tool/resource signatures were inspected and hosted analysis was not requested.',
    inspection,
  }, null, 2));
  console.warn('MCP-Scan inspect passed. Hosted analysis was not requested.');
} else {
  throw new Error(`Unsupported MCP_SCAN_MODE: ${scanMode}. Use hosted or inspect.`);
}
