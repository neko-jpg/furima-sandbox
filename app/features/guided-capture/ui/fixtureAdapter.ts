import type { AdapterConnection, CaptureRequest, GuidedCaptureAdapter, MeasurementDraft, MeasurementRequest, ShotAssessment } from './contracts';

/**
 * Deterministic UI adapter used while the FastAPI/LiveKit services are not
 * connected. It is intentionally boring: it never invents media and it never
 * changes the ListingView's existing camera or album pipeline.
 */
export const createFixtureGuidedCaptureAdapter = (): GuidedCaptureAdapter => ({
  connect: async (): Promise<AdapterConnection> => ({ connectionState: 'connected', transport: 'fixture' }),
  disconnect: () => undefined,
  assessShot: async (request: CaptureRequest): Promise<ShotAssessment> => ({
    shotType: request.slot === 'measurement' ? 'unknown' : request.slot,
    quality: 'ok',
    issues: [],
    missingShots: [],
    nextAction: request.slot === 'tag' ? 'REQUEST_NEXT' : 'REQUEST_NEXT',
  }),
  suggestMeasurement: async (request: MeasurementRequest): Promise<MeasurementDraft> => {
    void request;
    return {
      endpoints: {
        lengthStart: { x: 0.5, y: 0.2 },
        lengthEnd: { x: 0.5, y: 0.82 },
        widthStart: { x: 0.22, y: 0.48 },
        widthEnd: { x: 0.78, y: 0.48 },
      },
      lengthCm: 68,
      widthCm: 52,
      source: 'ai',
    };
  },
});
