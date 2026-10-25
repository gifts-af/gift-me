import { createClient } from "@supabase/supabase-js";
import { keepalive } from "@/lib/keepalive";
import { supabaseKey, supabaseUrl } from "@/lib/supabase/env";

// Called once a day by Vercel Cron (vercel.json) so the free Supabase project never idles into a pause.
export async function GET(request: Request) {
  return keepalive(request, {
    secret: process.env.CRON_SECRET,
    ping: async () => {
      const supabase = createClient(supabaseUrl!, supabaseKey!);
      // Row Level Security may return no rows; the query still reaches Postgres, which is what counts.
      const { error } = await supabase.from("lists").select("id").limit(1);
      if (error) throw error;
    },
  });
}
