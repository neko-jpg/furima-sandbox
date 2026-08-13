import { eq } from 'drizzle-orm';
import { getDb } from '../../../db';
import { worldSnapshots } from '../../../db/schema';

const WORLD_ID = 'world-default';
const MAX_SNAPSHOT_BYTES = 2_000_000;

const routeError = (error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unexpected database error';
  const status = /no such table|binding `DB` is unavailable/iu.test(message) ? 503 : 500;
  return Response.json({ error: message }, { status });
};

export async function GET() {
  try {
    const db = getDb();
    const [snapshot] = await db
      .select()
      .from(worldSnapshots)
      .where(eq(worldSnapshots.worldId, WORLD_ID))
      .limit(1);

    if (!snapshot) return Response.json({ snapshot: null });
    return Response.json({ snapshot });
  } catch (error) {
    return routeError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_SNAPSHOT_BYTES) {
      return Response.json({ error: 'Snapshot is too large' }, { status: 413 });
    }

    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) {
      return Response.json({ error: 'Snapshot is too large' }, { status: 413 });
    }
    let payload: {
      stateVersion?: number;
      marketplaceState?: unknown;
      sandboxState?: unknown;
    };
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!Number.isInteger(payload.stateVersion) || !payload.marketplaceState || !payload.sandboxState) {
      return Response.json({ error: 'Invalid world snapshot' }, { status: 400 });
    }

    const db = getDb();
    const updatedAt = new Date().toISOString();
    await db.insert(worldSnapshots).values({
      worldId: WORLD_ID,
      stateVersion: payload.stateVersion!,
      marketplaceState: payload.marketplaceState,
      sandboxState: payload.sandboxState,
      updatedAt,
    }).onConflictDoUpdate({
      target: worldSnapshots.worldId,
      set: {
        stateVersion: payload.stateVersion!,
        marketplaceState: payload.marketplaceState,
        sandboxState: payload.sandboxState,
        updatedAt,
      },
    });

    return Response.json({ ok: true, updatedAt });
  } catch (error) {
    return routeError(error);
  }
}
