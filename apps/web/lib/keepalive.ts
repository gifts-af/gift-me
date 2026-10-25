// Free Supabase projects pause after ~7 days without database activity (ALL-43).
// A daily Vercel Cron job calls /api/keepalive, which runs one tiny query.
// Vercel sends `Authorization: Bearer $CRON_SECRET` with cron requests.

type Options = { secret: string | undefined; ping: () => Promise<void> };

export async function keepalive(request: Request, { secret, ping }: Options) {
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    await ping();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("keepalive: database ping failed", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
