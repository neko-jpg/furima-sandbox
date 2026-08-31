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
  public readonly cameraOperations: string[] = [];
  public maxConcurrentCameraPublishes = 0;
  private activeCameraPublishes = 0;
  private readonly listeners = {
    connectionStateChanged: new Set<(state: "connecting" | "connected" | "reconnecting" | "disconnected") => void>(),
    dataReceived: new Set<(payload: LiveKitDataPayload) => void>(),
  };

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public async publishTrack(): Promise<void> {
    return undefined;
  }

  public async publishCameraStream(stream: MediaStream): Promise<void> {
    this.activeCameraPublishes += 1;
    this.maxConcurrentCameraPublishes = Math.max(this.maxConcurrentCameraPublishes, this.activeCameraPublishes);
    this.cameraOperations.push(`publish:${streamLabel(stream)}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    this.activeCameraPublishes -= 1;
  }

  public async unpublishCameraStream(): Promise<void> {
    this.cameraOperations.push("unpublish");
  }

  public async sendData(payload: Uint8Array): Promise<void> {
    this.sent.push(payload);
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
    this.cameraOperations.push("disconnect");
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

function streamLabel(stream: MediaStream): string {
  return (stream as unknown as { readonly label: string }).label;
}

const event = (sequence: number, overrides: Record<string, unknown> = {}) => JSON.stringify({
  sessionId: "live-session",
  sequence,
  shot: "front",
  code: "READY",
  message: "撮影できます。",
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
      expiresAt: 1_900_000_000,
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
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(room.sent[0])), {
    type: "resync",
    sessionId: "live-session",
  });
  await adapter.sendGuidanceRpc({ type: "ping" }, { reliable: false, topic: "capture" });
  assert.equal(room.sent.length, 2);
  await adapter.disconnect();
  assert.equal(adapter.connectionState, "disconnected");
});

test("LiveKit adapter fences reliable state packets and resyncs after reconnect", async () => {
  const room = new FakeRoom();
  const states: number[] = [];
  const adapter = new LiveKitAdapter(room, {
    getToken: async () => ({
      token: "token",
      participantIdentity: "participant",
      roomName: "room",
      expiresAt: 1_900_000_000,
      livekitUrl: "wss://livekit.example.test",
    }),
  }, { onState: (value) => states.push(value.sequence) });

  await adapter.connect("live-session");
  room.emitData(JSON.stringify({
    type: "shot_changed",
    sessionId: "live-session",
    sequence: 2,
    shot: "back",
    code: null,
    observedAt: 1_000,
  }));
  room.emitData(event(1));
  assert.deepEqual(states, [2]);
  assert.equal(adapter.lastSequence, 2);

  room.emitState("reconnecting");
  room.emitState("connected");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(room.sent.length, 1);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(room.sent[0])), {
    type: "resync",
    sessionId: "live-session",
  });
});

test("LiveKit adapter rejects provider-controlled guidance copy", async () => {
  const room = new FakeRoom();
  const guidance: number[] = [];
  const adapter = new LiveKitAdapter(room, {
    getToken: async () => ({
      token: "token",
      participantIdentity: "participant",
      roomName: "room",
      expiresAt: 1_900_000_000,
      livekitUrl: "wss://livekit.example.test",
    }),
  }, { onGuidance: (value) => guidance.push(value.sequence) });
  await adapter.connect("live-session");
  room.emitData(event(1, { message: "untrusted" }));
  assert.deepEqual(guidance, []);
});

test("malformed data and expired events are ignored without throwing", async () => {
  const room = new FakeRoom();
  const errors: unknown[] = [];
  const adapter = new LiveKitAdapter(room, {
    getToken: async () => ({
      token: "token",
      participantIdentity: "participant",
      roomName: "room",
      expiresAt: 1_900_000_000,
      livekitUrl: "wss://livekit.example.test",
    }),
  }, { onError: (error) => errors.push(error) });
  await adapter.connect("live-session");
  room.emitData("not-json");
  room.emitData(event(1, { expiresAt: 1 }));
  assert.deepEqual(errors, []);
});

test("camera stream replacement unpublishes the previous stream and serializes concurrent publishes", async () => {
  const room = new FakeRoom();
  const adapter = new LiveKitAdapter(room, {
    getToken: async () => ({
      token: "token",
      participantIdentity: "participant",
      roomName: "room",
      expiresAt: 1_900_000_000,
      livekitUrl: "wss://livekit.example.test",
    }),
  });
  const first = { label: "first" } as unknown as MediaStream;
  const second = { label: "second" } as unknown as MediaStream;

  await adapter.connect("live-session");
  await Promise.all([
    adapter.publishCameraStream(first),
    adapter.publishCameraStream(second),
  ]);
  assert.deepEqual(room.cameraOperations, ["publish:first", "unpublish", "publish:second"]);
  assert.equal(room.maxConcurrentCameraPublishes, 1);

  await adapter.disconnect();
  assert.deepEqual(room.cameraOperations, [
    "publish:first",
    "unpublish",
    "publish:second",
    "unpublish",
    "disconnect",
  ]);
});

test("publishing the same camera stream twice does not create a duplicate track", async () => {
  const room = new FakeRoom();
  const adapter = new LiveKitAdapter(room, {
    getToken: async () => ({
      token: "token",
      participantIdentity: "participant",
      roomName: "room",
      expiresAt: 1_900_000_000,
      livekitUrl: "wss://livekit.example.test",
    }),
  });
  const stream = { label: "same" } as unknown as MediaStream;

  await adapter.connect("live-session");
  await adapter.publishCameraStream(stream);
  await adapter.publishCameraStream(stream);
  assert.deepEqual(room.cameraOperations, ["publish:same"]);
});
