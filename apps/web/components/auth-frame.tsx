import Link from "next/link";

// The sign-in look (mock-up "signin"): one centred column, the name and a
// tagline on top, then the form.
export function AuthFrame({
  title = "GiftMe",
  subtitle = "The right gift, on time, without the scramble.",
  children,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh w-full justify-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col justify-center gap-7">
        <div className="flex flex-col gap-1.5 text-center">
          <h1 className="text-[22px] font-bold leading-tight">
            {title === "GiftMe" ? <Link href="/">{title}</Link> : title}
          </h1>
          {subtitle && <p className="text-[15px] text-muted-foreground">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-destructive" role="alert">
      {children}
    </p>
  );
}

export function Divider({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-[13px] text-muted-foreground before:flex-1 before:border-t before:content-[''] after:flex-1 after:border-t after:content-['']">
      {children}
    </p>
  );
}
