import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type Search = { city?: string; tier?: string };

export const Route = createFileRoute("/checkout/success")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    city: typeof s.city === "string" ? s.city : undefined,
    tier: typeof s.tier === "string" ? s.tier : undefined,
  }),
  head: () => ({
    meta: [{ title: "You're In! — Scale & Profit Seminar" }],
  }),
  component: SuccessPage,
});

function SuccessPage() {
  const { tier } = Route.useSearch();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-wide">
            <Sparkles className="h-5 w-5 text-primary" />
            <span>SCALE & PROFIT</span>
          </Link>
        </div>
      </header>
      <div className="mx-auto flex max-w-2xl flex-col items-center px-6 py-24 text-center">
        <CheckCircle2 className="h-16 w-16 text-primary" />
        <h1 className="mt-6 text-4xl font-black md:text-5xl">You're In!</h1>
        <p className="mt-4 text-muted-foreground">
          Your {tier === "vip" ? "VIP" : "General Admission"} seat is reserved. A confirmation
          email with event details, your workbook, and travel info is on its way.
        </p>
        <Button asChild size="lg" className="mt-8">
          <Link to="/">Back to event details</Link>
        </Button>
      </div>
    </div>
  );
}
