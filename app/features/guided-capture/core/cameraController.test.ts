import assert from "node:assert/strict";
import test from "node:test";

import {
  CameraController,
  CameraStartError,
  captureVideoFrame,
} from "./cameraController.ts";

class FakeTrack {
  public readonly kind = "video";
  public stopped = 0;

  public stop(): void {
    this.stopped += 1;
  }
}

class FakeStream {
  public readonly track: FakeTrack;

  public constructor(track: FakeTrack) {
    this.track = track;
  }

  public getTracks(): readonly FakeTrack[] {
    return [this.track];
  }

  public getVideoTracks(): readonly FakeTrack[] {
    return [this.track];
  }
}

class FakeVideo {
  public muted = false;
  public playsInline = false;
  public autoplay = false;
  public srcObject: unknown = null;
  public readonly videoWidth = 640;
  public readonly videoHeight = 480;
  public playCount = 0;
  public pauseCount = 0;

  public async play(): Promise<void> {
    this.playCount += 1;
  }

  public pause(): void {
    this.pauseCount += 1;
  }
}

test("camera controller acquires, exposes, and releases its stream", async () => {
  const video = new FakeVideo();
  const track = new FakeTrack();
  const stream = new FakeStream(track);
  let requestedConstraints: unknown;
  const controller = new CameraController(video, {
    runtime: {
      hostname: "localhost",
      isSecureContext: false,
      getUserMedia: async (constraints) => {
        requestedConstraints = constraints;
        return stream;
      },
    },
  });

  await controller.start();
  assert.equal(controller.isRunning, true);
  assert.equal(controller.currentVideoTrack, track);
  assert.equal(video.muted, true);
  assert.deepEqual(requestedConstraints, {
    video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  controller.stop();
  assert.equal(controller.isRunning, false);
  assert.equal(track.stopped, 1);
  assert.equal(video.srcObject, null);
});

test("camera permission errors are mapped and stale late streams are stopped", async () => {
  const video = new FakeVideo();
  const track = new FakeTrack();
  let resolveStream: ((stream: FakeStream) => void) | undefined;
  const pending = new Promise<FakeStream>((resolve) => {
    resolveStream = resolve;
  });
  const controller = new CameraController(video, {
    runtime: {
      hostname: "example.test",
      isSecureContext: false,
      getUserMedia: async () => pending,
    },
  });
  await assert.rejects(controller.start(), (error: unknown) => {
    return error instanceof CameraStartError && error.code === "insecure-context";
  });

  const localController = new CameraController(video, {
    runtime: {
      hostname: "localhost",
      isSecureContext: false,
      getUserMedia: async () => pending,
    },
  });
  const start = localController.start();
  localController.stop();
  resolveStream?.(new FakeStream(track));
  await start;
  assert.equal(track.stopped, 1);
});

test("frame capture uses an injected canvas and never requires a DOM global", async () => {
  const video = new FakeVideo();
  let drawn = false;
  const blob = await captureVideoFrame(video, (width, height) => ({
    width,
    height,
    getContext2D: () => ({
      drawImage: () => {
        drawn = true;
      },
    }),
    toBlob: (callback) => callback(new Blob(["frame"], { type: "image/jpeg" })),
  }));
  assert.equal(drawn, true);
  assert.equal(blob.type, "image/jpeg");
});
