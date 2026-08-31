import assert from "node:assert/strict";
import test from "node:test";

import {
  LiveKitAdapter,
  type LiveKitDataPayload,
  type LiveKitRoomPort,
} from "./liveKitAdapter.ts";

class FakeRoom implements LiveKitRoomPort {
  public connected = false;
  public readonly sent: Uint8Array[] = [];
  private readonly listeners = {
    connectionStateChanged: new Set<(state: "connecting" | "connected" | "reconnecting" | "disconnected") => void>(),
    dataReceived: new Set<(payload: LiveKitDataPayload) => void>(),
  };

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
  }

  public async publishTrack(): Promise<void> {
    return undefined;
  }

  public async sendData(payload: Uint8Array): Promise<void> {
    this.sent.push(payload);
  }

  public on(event: "connectionStateChanged" | "dataReceived", listener: (value: never) => void): () => void {
    const set = this.listeners[event] as Set<(value: never) => void>;
    set.add(listener);
    return () => set.delete(listener);
  }

  public emitState(state: "connecting" | "connected" | "reconnecting" | "disconnected"): void {
    for (const listener of this.listeners.connectionStateChanged) listener(state);
  }

  public emitData(payload: LiveKitDataPayload): void {
    for (const listener of this.listeners.dataReceived) listener(payload);
  }
}

const event = (sequence: number, overrides: Record<string, unknown> = {}) => JSON.stringify({
  sessionId: "live-session",
  sequence,
  shot: "front",
  code: "READY",
  message: "ready",
  confidence: 1,
  observedAt: 1_000,
  expiresAt: 2_000,
  ...overrides,
});

test("LiveKit adapter connects through an injected room port and filters stale guidance", async () => {
  const room = new FakeRoom();
  const guidance: number[] = [];
  let now = 1_100;
  const adapter = new LiveKitAdapter(room, {
    getToken: async () => ({
      token: "opaque-token",
      participantIdentity: "participant",
      roomName: "room",
      expiresAt: "2030-01-01T00:00:00.000Z",
      livekitUrl: "wss://livekit.example.test",
    }),
  }, { now: () => now, onGuidance: (value) => guidance.push(value.sequence) });

  await adapter.connect("live-session");
  assert.equal(adapter.connectionState, "connected");
  room.emitData(event(1));
  room.emitData(event(1));
  room.emitData(event(0));
  room.emitData(event(2, { sessionId: "other-session" }));
  now = 2_000;
  room.emitData(event(3));
  assert.deepEqual(guidance, [1]);
  assert.equal(adapter.lastSequence, 1);

  room.emitState("reconnecting");
  assert.equal(adapter.connectionState, "reconnecting");
  room.emitState("connected");
  await adapter.sendGuidanceRpc({ type: "ping" }, { reliable: false, topic: "capture" });
  assert.equal(room.sent.length, 1);
  await adapter.disconnect();
  assert.equal(adapter.connectionState, "disconnected");
});

test("malformed data and expired events are ignored without throwing", async () => {
  const room = new FakeRoom();
  const errors: unknown[] = [];
  const adapter = new LiveKitAdapter(room, {
    getToken: async () => ({
      token: "token",
      participantIdentity: "participant",
      roomName: "room",
      expiresAt: "2030-01-01T00:00:00.000Z",
      livekitUrl: "wss://livekit.example.test",
    }),
  }, { onError: (error) => errors.push(error) });
  await adapter.connect("live-session");
  room.emitData("not-json");
  room.emitData(event(1, { expiresAt: 1 }));
  assert.deepEqual(errors, []);
});
