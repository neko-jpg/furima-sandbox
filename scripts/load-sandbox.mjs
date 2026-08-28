import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "output/load/latest.json");

const numberArg = (name, fallback, minimum = 0) => {
  const prefix = `--${name}=`;
  const raw = process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
  const parsed = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
};

const stringArg = (name, fallback) => {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
};

const booleanArg = (name) => process.argv.includes(`--${name}`);
const durationSeconds = numberArg("duration", 30, 1);
const actorCount = Math.max(1, Math.floor(numberArg("actors", 20, 1)));
const targetRps = Math.max(1, Math.floor(numberArg("rps", 100, 1)));
const requestTimeoutMs = Math.max(
  1000,
  Math.floor(numberArg("timeout-ms", 10_000, 1000)),
);
const baseUrl = stringArg(
  "base-url",
  process.env.SANDBOX_BASE_URL ??
    process.env.BASE_URL ??
    "http://127.0.0.1:3001",
).replace(/\/$/u, "");
const noStart = booleanArg("no-start") || process.env.LOAD_NO_START === "1";
const localFixtureHostnames = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
]);
const baseHostname = new URL(baseUrl).hostname;
const useLocalFixtureLoadSources = localFixtureHostnames.has(baseHostname);
const apiToken = process.env.FURIMA_D1_API_TOKEN ?? "load-api-token";
const controlToken =
  process.env.FURIMA_D1_CONTROL_TOKEN ?? "load-control-token";
const runId = `load-${Date.now()}-${randomUUID()}`;

const sleep = (milliseconds) =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const nowMs = () => Number(process.hrtime.bigint()) / 1_000_000;
const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * fraction) - 1,
  );
  return sorted[Math.max(0, index)];
};
const maximum = (values) =>
  values.reduce((current, value) => Math.max(current, value), 0);

const stats = {
  startedAt: new Date().toISOString(),
  target: { durationSeconds, actorCount, targetRps, baseUrl },
  total: 0,
  successful: 0,
  failed: 0,
  statuses: {},
  byKind: {},
  latenciesMs: [],
  invariantViolations: [],
  duplicateMutationViolations: [],
  lostUpdateViolations: [],
  errors: [],
  idempotencyReplays: 0,
};

const recordError = (message, details = {}) => {
  if (stats.errors.length < 30) stats.errors.push({ message, ...details });
};

const recordInvariant = (message, details = {}) => {
  if (stats.invariantViolations.length < 30)
    stats.invariantViolations.push({ message, ...details });
};

const hasResultTooLargeMarker = (value) =>
  Boolean(
    value &&
      typeof value === "object" &&
      value.truncated === true &&
      value.reason === "RESULT_TOO_LARGE",
  );

const sameReplayMetadata = (expected, received) => {
  const expectedMeta = expected?.meta;
  const receivedMeta = received?.meta;
  if (!expectedMeta && !receivedMeta) return true;
  if (
    !expectedMeta ||
    typeof expectedMeta !== "object" ||
    !receivedMeta ||
    typeof receivedMeta !== "object"
  )
    return false;
  const keys = [
    "sandboxId",
    "actorId",
    "operationId",
    "requestId",
    "idempotencyKey",
    "mode",
    "stateVersion",
  ];
  return keys.every((key) => expectedMeta[key] === receivedMeta[key]);
};

const replayResultMatchesExpected = (expectedSerialized, received) => {
  if (JSON.stringify(received) === expectedSerialized) return true;
  let expected;
  try {
    expected = JSON.parse(expectedSerialized);
  } catch {
    return false;
  }
  if (!expected || typeof expected !== "object") return false;
  if (!received || typeof received !== "object") return false;
  if (expected.ok !== received.ok) return false;
  if (expected.error !== received.error) return false;
  if (expected.stateVersion !== received.stateVersion) return false;
  if (!sameReplayMetadata(expected, received)) return false;
  return (
    hasResultTooLargeMarker(received.data) &&
    !hasResultTooLargeMarker(expected.data)
  );
};

const checkState = (state, actor) => {
  if (!state || typeof state !== "object") {
    recordInvariant("state response is not an object", {
      sandboxId: actor.sandboxId,
    });
    return;
  }
  if (
    !Number.isInteger(state.stateVersion) ||
    state.stateVersion < actor.lastStateVersion
  ) {
    recordInvariant("stateVersion is not monotonic", {
      sandboxId: actor.sandboxId,
      previous: actor.lastStateVersion,
      received: state.stateVersion,
    });
  } else if (Number.isInteger(state.stateVersion)) {
    actor.lastStateVersion = state.stateVersion;
  }
  for (const item of Array.isArray(state.items) ? state.items : []) {
    const inventory = Number(item.inventoryQuantity ?? 0);
    const reserved = Number(item.reservedQuantity ?? 0);
    if (
      !Number.isFinite(inventory) ||
      inventory < 0 ||
      !Number.isFinite(reserved) ||
      reserved < 0 ||
      reserved > inventory
    ) {
      recordInvariant("inventory invariant violated", {
        sandboxId: actor.sandboxId,
        itemId: item.id,
        inventory,
        reserved,
      });
    }
  }
  for (const wallet of Array.isArray(state.wallets) ? state.wallets : []) {
    const available = Number(wallet.availableBalance ?? 0);
    const held = Number(wallet.heldBalance ?? 0);
    if (
      !Number.isFinite(available) ||
      available < 0 ||
      !Number.isFinite(held) ||
      held < 0
    ) {
      recordInvariant("wallet balance invariant violated", {
        sandboxId: actor.sandboxId,
        actorId: wallet.actorId,
        available,
        held,
      });
    }
  }
};

const requestJson = async (
  method,
  path,
  body,
  kind,
  actor,
  includeInLoad = true,
  extraHeaders = {},
) => {
  const started = nowMs();
  let response;
  let parsed;
  let raw = "";
  try {
    // The local fixture's limiter is source-scoped, so model each actor as a
    // separate client without sending a synthetic identity to remote origins.
    const headers = {
      accept: "application/json",
      authorization: `Bearer ${apiToken}`,
      ...(useLocalFixtureLoadSources && Number.isInteger(actor?.index)
        ? { "x-forwarded-for": `198.51.100.${(actor.index % 254) + 1}` }
        : {}),
      ...extraHeaders,
    };
    const init = {
      method,
      headers,
      signal: AbortSignal.timeout(requestTimeoutMs),
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    response = await fetch(`${baseUrl}${path}`, init);
    raw = await response.text();
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
    }
  } catch (error) {
    const latency = nowMs() - started;
    if (includeInLoad) {
      stats.total += 1;
      stats.failed += 1;
      stats.latenciesMs.push(latency);
      stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
      recordError(error instanceof Error ? error.message : "request failed", {
        kind,
        path,
      });
    }
    return {
      ok: false,
      status: 0,
      body: undefined,
      raw,
      latency,
      headers: new Headers(),
    };
  }
  const latency = nowMs() - started;
  const accepted =
    (response.status >= 200 && response.status < 300) ||
    response.status === 304;
  if (includeInLoad) {
    stats.total += 1;
    stats.latenciesMs.push(latency);
    stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
    stats.statuses[response.status] =
      (stats.statuses[response.status] ?? 0) + 1;
    if (accepted) stats.successful += 1;
    else {
      stats.failed += 1;
      recordError(`HTTP ${response.status}`, {
        kind,
        path,
        body: raw.slice(0, 500),
      });
    }
  }
  return {
    ok: accepted,
    status: response.status,
    body: parsed,
    raw,
    latency,
    headers: response.headers,
  };
};

const waitForOrigin = async (timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await requestJson(
      "GET",
      "/api/sandbox/health?sandboxId=load-probe",
      undefined,
      "probe",
      { sandboxId: "load-probe", lastStateVersion: 0 },
      false,
    );
    if (result.status === 200 || result.status === 401 || result.status === 403)
      return true;
    await sleep(250);
  }
  return false;
};

let child;
const startLocalServer = async () => {
  if (await waitForOrigin(1500)) return;
  if (noStart) throw new Error(`load target is unavailable: ${baseUrl}`);
  const parsed = new URL(baseUrl);
  const serverArgs = [
    "run",
    "start",
    "--",
    "--hostname",
    parsed.hostname,
    "--port",
    parsed.port || "3001",
  ];
  const command =
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `npm ${serverArgs.join(" ")}`]
      : serverArgs;
  child = spawn(command, commandArgs, {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      FURIMA_LOCAL_FIXTURE_MODE: "true",
      FURIMA_LOCAL_FIXTURE_REQUIRE_AUTH: "true",
      FURIMA_STORAGE_MODE: "memory",
      FURIMA_DEPLOYMENT_ENV: "development",
      FURIMA_D1_API_TOKEN: apiToken,
      FURIMA_D1_CONTROL_TOKEN: controlToken,
      FURIMA_D1_API_ACTOR_ID: "buyer_01",
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  if (!(await waitForOrigin(120_000)))
    throw new Error(`local server did not become ready: ${baseUrl}`);
};

const waitForChildExit = (processHandle, timeoutMs) =>
  new Promise((resolveExit) => {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      resolveExit(true);
      return;
    }
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      processHandle.off("close", onClose);
      resolveExit(exited);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    processHandle.once("close", onClose);
  });

const stopLocalServer = async () => {
  if (!child) return;
  const processHandle = child;
  child = undefined;
  if (!processHandle.pid) return;

  const exited = waitForChildExit(processHandle, 5_000);
  if (process.platform === "win32") {
    await new Promise((resolveStop) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(processHandle.pid), "/t", "/f"],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.once("close", resolveStop);
      killer.once("error", resolveStop);
    });
    await exited;
    return;
  }

  try {
    process.kill(-processHandle.pid, "SIGTERM");
  } catch {
    try {
      processHandle.kill("SIGTERM");
    } catch {
      /* already exited */
    }
  }
  if (!(await exited)) {
    try {
      process.kill(-processHandle.pid, "SIGKILL");
    } catch {
      try {
        processHandle.kill("SIGKILL");
      } catch {
        /* already exited */
      }
    }
    await waitForChildExit(processHandle, 2_000);
  }
};

const makeActor = (index) => ({
  index,
  sandboxId: `${runId}-${index}`,
  lastStateVersion: 0,
  dispatchCount: 0,
  sequence: 0,
  busy: false,
  etag: undefined,
  pendingPreview: null,
  repeatCommit: null,
});

const setupActor = async (actor) => {
  const reset = await requestJson(
    "POST",
    "/api/sandbox/reset",
    {
      sandboxId: actor.sandboxId,
      scenarioId: "catalog_default",
      seed: `${runId}-seed-${actor.index}`,
      idempotencyKey: `${runId}-reset-${actor.index}`,
    },
    "setup",
    actor,
    false,
    { authorization: `Bearer ${controlToken}` },
  );
  if (!reset.ok)
    throw new Error(
      `reset failed for ${actor.sandboxId}: HTTP ${reset.status}`,
    );
  const health = await requestJson(
    "GET",
    `/api/sandbox/health?sandboxId=${encodeURIComponent(actor.sandboxId)}`,
    undefined,
    "setup",
    actor,
    false,
  );
  if (
    !health.ok ||
    !health.body ||
    typeof health.body.stateVersion !== "number"
  )
    throw new Error(`health failed for ${actor.sandboxId}`);
  actor.lastStateVersion = health.body.stateVersion;
};

const runCatalog = async (actor) => {
  const headers = actor.etag ? { "if-none-match": actor.etag } : {};
  const result = await requestJson(
    "GET",
    "/api/catalog?offset=0&limit=24&q=PC",
    undefined,
    "catalog",
    actor,
    true,
    headers,
  );
  if (result.status === 200) actor.etag = result.headers?.etag ?? actor.etag;
  return result;
};

const runHealth = async (actor) => {
  const result = await requestJson(
    "GET",
    `/api/sandbox/health?sandboxId=${encodeURIComponent(actor.sandboxId)}`,
    undefined,
    "health",
    actor,
  );
  if (
    result.ok &&
    result.body &&
    typeof result.body.stateVersion === "number" &&
    result.body.stateVersion < actor.lastStateVersion
  ) {
    recordInvariant("health stateVersion regressed", {
      sandboxId: actor.sandboxId,
      previous: actor.lastStateVersion,
      received: result.body.stateVersion,
    });
  }
  return result;
};

const runState = async (actor) => {
  const result = await requestJson(
    "GET",
    `/api/sandbox/state?sandboxId=${encodeURIComponent(actor.sandboxId)}`,
    undefined,
    "state",
    actor,
    true,
    { authorization: `Bearer ${controlToken}` },
  );
  if (result.ok) checkState(result.body, actor);
  return result;
};

const runPreview = async (actor) => {
  const sequence = actor.sequence++;
  const idempotencyKey = `${runId}-preview-${actor.index}-${sequence}`;
  const result = await requestJson(
    "POST",
    "/api/sandbox/preview",
    {
      sandboxId: actor.sandboxId,
      stateVersion: actor.lastStateVersion,
      command: "wallet.deposit",
      payload: { amount: 1000 },
      idempotencyKey,
      requestId: `${runId}-request-${actor.index}-${sequence}`,
    },
    "preview",
    actor,
  );
  if (result.ok && result.body?.ok && result.body.data?.previewId) {
    actor.pendingPreview = {
      previewId: result.body.data.previewId,
      idempotencyKey: `${runId}-commit-${actor.index}-${sequence}`,
    };
  }
  return result;
};

const runCommit = async (actor) => {
  const pending = actor.pendingPreview;
  if (!pending) return runHealth(actor);
  const result = await requestJson(
    "POST",
    "/api/sandbox/commit",
    {
      sandboxId: actor.sandboxId,
      stateVersion: actor.lastStateVersion,
      previewId: pending.previewId,
      idempotencyKey: pending.idempotencyKey,
      requestId: `${pending.idempotencyKey}-request`,
    },
    "commit",
    actor,
  );
  if (!result.ok || !result.body?.ok) {
    actor.pendingPreview = null;
    return result;
  }
  const saved = JSON.stringify(result.body);
  if (typeof result.body.stateVersion === "number")
    actor.lastStateVersion = result.body.stateVersion;
  actor.pendingPreview = null;
  // A small portion of mutations is deliberately replayed with the same key.
  // It must return the saved result and must not advance the state again.
  if (actor.sequence % 5 === 0)
    actor.repeatCommit = {
      ...pending,
      expected: saved,
      stateVersion: actor.lastStateVersion,
    };
  return result;
};

const runRepeatedCommit = async (actor) => {
  const repeat = actor.repeatCommit;
  if (!repeat) return runHealth(actor);
  const result = await requestJson(
    "POST",
    "/api/sandbox/commit",
    {
      sandboxId: actor.sandboxId,
      stateVersion: repeat.stateVersion,
      previewId: repeat.previewId,
      idempotencyKey: repeat.idempotencyKey,
      requestId: `${repeat.idempotencyKey}-request`,
    },
    "commit-replay",
    actor,
  );
  actor.repeatCommit = null;
  stats.idempotencyReplays += 1;
  if (result.ok && !replayResultMatchesExpected(repeat.expected, result.body)) {
    stats.duplicateMutationViolations.push({
      sandboxId: actor.sandboxId,
      previewId: repeat.previewId,
      message: "idempotent commit response changed",
    });
  }
  if (
    result.ok &&
    typeof result.body?.stateVersion === "number" &&
    result.body.stateVersion !== repeat.stateVersion
  ) {
    stats.duplicateMutationViolations.push({
      sandboxId: actor.sandboxId,
      previewId: repeat.previewId,
      message: "idempotent commit advanced stateVersion",
    });
  }
  return result;
};

const runJob = async (actor) => {
  if (actor.repeatCommit) return runRepeatedCommit(actor);
  if (actor.pendingPreview) return runCommit(actor);
  const selector = (actor.dispatchCount++ + actor.index) % 10;
  if (selector < 5) return runCatalog(actor);
  if (selector < 7) return runHealth(actor);
  if (selector < 8) return runState(actor);
  return runPreview(actor);
};

const writeArtifact = async (summary) => {
  await mkdir(resolve(root, "output/load"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
};

const main = async () => {
  const actors = Array.from({ length: actorCount }, (_, index) =>
    makeActor(index),
  );
  const active = new Set();
  let actorCursor = 0;
  const overallStarted = nowMs();
  let loadStarted = overallStarted;
  try {
    await startLocalServer();
    await Promise.all(actors.map(setupActor));
    loadStarted = nowMs();
    const deadline = loadStarted + durationSeconds * 1000;
    const intervalMs = 1000 / targetRps;
    let nextDispatch = nowMs();
    while (nowMs() < deadline) {
      const wait = nextDispatch - nowMs();
      if (wait > 0) await sleep(Math.min(wait, 1000));
      if (nowMs() >= deadline) break;
      let actor;
      for (let attempt = 0; attempt < actors.length; attempt += 1) {
        const candidate = actors[actorCursor % actors.length];
        actorCursor += 1;
        if (!candidate.busy) {
          actor = candidate;
          break;
        }
      }
      if (!actor) {
        if (active.size) await Promise.race(active);
        continue;
      }
      actor.busy = true;
      const promise = Promise.resolve(runJob(actor))
        .catch((error) => {
          stats.failed += 1;
          recordError(error instanceof Error ? error.message : "job failed", {
            sandboxId: actor.sandboxId,
          });
        })
        .finally(() => {
          actor.busy = false;
          active.delete(promise);
        });
      active.add(promise);
      nextDispatch += intervalMs;
      if (active.size > 500) await Promise.race(active);
    }
    await Promise.all(active);
    await Promise.all(actors.map(runState));
  } finally {
    await stopLocalServer();
  }
  const elapsedSeconds = Math.max(0.001, (nowMs() - loadStarted) / 1000);
  const errorRate = stats.total ? stats.failed / stats.total : 1;
  const requiresIdempotencyReplay =
    durationSeconds >= 5 && actorCount >= 2 && targetRps >= 10;
  const summary = {
    ...stats,
    finishedAt: new Date().toISOString(),
    setupElapsedSeconds: Number(
      Math.max(0, (loadStarted - overallStarted) / 1000).toFixed(3),
    ),
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    actualRps: Number((stats.total / elapsedSeconds).toFixed(2)),
    errorRate: Number(errorRate.toFixed(5)),
    latencyMs: {
      p50: Number(percentile(stats.latenciesMs, 0.5).toFixed(2)),
      p95: Number(percentile(stats.latenciesMs, 0.95).toFixed(2)),
      p99: Number(percentile(stats.latenciesMs, 0.99).toFixed(2)),
      max: Number(maximum(stats.latenciesMs).toFixed(2)),
    },
    limits: {
      maxErrorRate: 0.005,
      maxP95Ms: 750,
      maxP99Ms: 1500,
      minIdempotencyReplays: requiresIdempotencyReplay ? 1 : 0,
    },
    pass:
      errorRate < 0.005 &&
      percentile(stats.latenciesMs, 0.95) < 750 &&
      percentile(stats.latenciesMs, 0.99) < 1500 &&
      (!requiresIdempotencyReplay || stats.idempotencyReplays > 0) &&
      stats.invariantViolations.length === 0 &&
      stats.duplicateMutationViolations.length === 0 &&
      stats.lostUpdateViolations.length === 0,
  };
  await writeArtifact(summary);
  console.log(
    JSON.stringify({
      pass: summary.pass,
      total: summary.total,
      actualRps: summary.actualRps,
      errorRate: summary.errorRate,
      latencyMs: summary.latencyMs,
      idempotencyReplays: summary.idempotencyReplays,
      invariantViolations: summary.invariantViolations.length,
      artifact: outputPath,
    }),
  );
  if (!summary.pass) process.exitCode = 1;
};

try {
  await main();
} catch (error) {
  const summary = {
    ...stats,
    finishedAt: new Date().toISOString(),
    pass: false,
    fatal: error instanceof Error ? error.message : String(error),
  };
  await writeArtifact(summary);
  console.error(
    JSON.stringify({ pass: false, fatal: summary.fatal, artifact: outputPath }),
  );
  process.exitCode = 1;
}
