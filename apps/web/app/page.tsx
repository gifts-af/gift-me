import GiftApp from "@/components/gifts/gift-app";
import { SiteShell } from "@/components/site-shell";

export default function Home() {
  return (
    <SiteShell>
      <GiftApp />
    </SiteShell>
  );
}
