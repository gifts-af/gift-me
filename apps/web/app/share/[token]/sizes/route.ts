import { getOwnerSizes } from "@/modules/lists";

// Served apart from the page so the page, its preview and get_shared_list never carry sizes. Never
// cached: a reset link must cut off any stale copy.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return Response.json(await getOwnerSizes(token), { headers: { "Cache-Control": "no-store" } });
}
