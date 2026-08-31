import {
  ConnectionState as LiveKitConnectionState,
  Room,
  RoomEvent,
  type LocalVideoTrack,
  type TrackPublication,
} from 'livekit-client';
import type {
  LiveKitCameraTrack,
  LiveKitDataPayload,
  LiveKitRoomConnectionState,
  LiveKitRoomPort,
} from './liveKitAdapter';

const mapConnectionState = (value: LiveKitConnectionState | string): LiveKitRoomConnectionState => {
  switch (String(value).toLowerCase()) {
    case 'connected': return 'connected';
    case 'reconnecting': return 'reconnecting';
    case 'disconnected': return 'disconnected';
    default: return 'connecting';
  }
};

/** LiveKit SDK implementation of the small room port used by LiveKitAdapter. */
export class LiveKitClientRoomPort implements LiveKitRoomPort {
  public readonly room: Room;
  private publishedCameraTrack: LocalVideoTrack | null = null;
  private cameraOperation: Promise<void> = Promise.resolve();

  public constructor(room = new Room()) {
    this.room = room;
  }

  public async connect(url: string, token: string): Promise<void> {
    await this.room.connect(url, token, { autoSubscribe: false });
  }

  public async disconnect(): Promise<void> {
    await this.enqueueCameraOperation(async () => {
      let firstError: unknown = null;
      try {
        await this.unpublishPublishedCameraTrack();
      } catch (error) {
        firstError = error;
      }
      try {
        await this.room.disconnect();
      } catch (error) {
        if (firstError === null) firstError = error;
      }
      if (firstError !== null) throw firstError;
    });
  }

  public async publishTrack(track: LiveKitCameraTrack): Promise<void> {
    await this.room.localParticipant.publishTrack(track as LocalVideoTrack);
  }

  public async sendData(payload: Uint8Array, options: { readonly reliable: boolean; readonly topic?: string }): Promise<void> {
    const ownedPayload = new Uint8Array(payload.byteLength);
    ownedPayload.set(payload);
    await this.room.localParticipant.publishData(ownedPayload as Uint8Array<ArrayBuffer>, {
      reliable: options.reliable,
      topic: options.topic,
    });
  }

  public on(event: 'connectionStateChanged', listener: (state: LiveKitRoomConnectionState) => void): () => void;
  public on(event: 'dataReceived', listener: (payload: LiveKitDataPayload) => void): () => void;
  public on(event: 'connectionStateChanged' | 'dataReceived', listener: ((state: LiveKitRoomConnectionState) => void) | ((payload: LiveKitDataPayload) => void)): () => void {
    if (event === 'connectionStateChanged') {
      const callback = (state: LiveKitConnectionState) => (listener as (value: LiveKitRoomConnectionState) => void)(mapConnectionState(state));
      this.room.on(RoomEvent.ConnectionStateChanged, callback);
      return () => this.room.off(RoomEvent.ConnectionStateChanged, callback);
    }
    const callback = (payload: Uint8Array) => (listener as (value: LiveKitDataPayload) => void)(payload);
    this.room.on(RoomEvent.DataReceived, callback);
    return () => this.room.off(RoomEvent.DataReceived, callback);
  }

  /** Create a camera track from a browser MediaStream without exposing credentials. */
  public async publishCameraStream(stream: MediaStream): Promise<void> {
    await this.enqueueCameraOperation(async () => {
      const mediaStreamTrack = stream.getVideoTracks()[0];
      if (!mediaStreamTrack) throw new TypeError('A camera video track is required.');
      if (this.publishedCameraTrack?.mediaStreamTrack === mediaStreamTrack) return;

      await this.unpublishPublishedCameraTrack();
      const { LocalVideoTrack: LocalVideoTrackConstructor } = await import('livekit-client');
      const nextTrack = new LocalVideoTrackConstructor(mediaStreamTrack);
      try {
        await this.room.localParticipant.publishTrack(nextTrack);
        this.publishedCameraTrack = nextTrack;
      } catch (error) {
        nextTrack.stop();
        throw error;
      }
    });
  }

  public async unpublishCameraStream(): Promise<void> {
    await this.enqueueCameraOperation(() => this.unpublishPublishedCameraTrack());
  }

  public closePublishedCamera(publication?: TrackPublication): void {
    publication?.track?.stop();
  }

  private async unpublishPublishedCameraTrack(): Promise<void> {
    const track = this.publishedCameraTrack;
    if (track === null) return;
    this.publishedCameraTrack = null;
    try {
      await this.room.localParticipant.unpublishTrack(track, true);
    } finally {
      track.stop();
    }
  }

  private enqueueCameraOperation(operation: () => Promise<void> | void): Promise<void> {
    const next = this.cameraOperation.catch(() => undefined).then(operation);
    this.cameraOperation = next.catch(() => undefined);
    return next;
  }
}

export const createLiveKitClientRoomPort = (): LiveKitClientRoomPort => new LiveKitClientRoomPort();
