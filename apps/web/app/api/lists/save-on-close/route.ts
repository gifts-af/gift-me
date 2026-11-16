import { z } from "zod";
import { logEvent } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { removeGifts } from "@/modules/lists";

// My list posts here with fetch keepalive when the tab goes away with a remove
// still held for Undo (ALL-127). A server action started on pagehide is
// cancelled by the browser; a keepalive fetch isn't. Keepalive bodies are
// capped at 64 KiB and a list can hold 500 gifts, so the tab sends the ids to
// drop, never the list; the server reads the list and saves the rest through
// the same checked path as saveList.

const MAX_BODY_CHARS = 64 * 1024;

// Exactly these three, nothing else (E4).
const CloseBody = z.strictObject({
  listId: z.guid(),
  version: z.string().min(1).max(64),
  removeIds: z.array(z.guid()).min(1).max(500),
});

// Only our own pages send this; the browser sets Origin on every POST.
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isJson(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  return type.split(";")[0].trim().toLowerCase() === "application/json";
}

const STATUS = { not_found: 404, stale: 409, error: 500 } as const;

// The proxy lets this path through signed out (lib/supabase/proxy.ts), so a
// keepalive request gets a plain 401 here rather than a redirect to follow.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!isJson(request)) return new Response(null, { status: 415 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_CHARS) {
    return new Response(null, { status: 413 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return new Response(null, { status: 401 });

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return new Response(null, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = CloseBody.safeParse(raw);
  if (!parsed.success) return new Response(null, { status: 400 });

  const result = await removeGifts(supabase, userId, parsed.data);
  logEvent("list_close_sent", {
    user_id: userId,
    list_id: parsed.data.listId,
    removed: parsed.data.removeIds.length,
    behind: result.behind,
    outcome: result.outcome,
  });
  // A tab that was only hidden carries on from this version, unless it was
  // already behind (then its next save is refused and merged as usual).
  if (result.outcome === "saved") return Response.json({ version: result.version, behind: result.behind });
  return new Response(null, { status: STATUS[result.outcome] });
}
