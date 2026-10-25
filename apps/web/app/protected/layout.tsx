import { SiteShell } from "@/components/site-shell";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SiteShell>
      <div className="w-full max-w-5xl mx-auto p-5">{children}</div>
    </SiteShell>
  );
}
