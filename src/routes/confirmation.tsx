import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { normalizeCity } from "@/lib/city";
import logo from "@/assets/hero-banner.webp";

type Search = {
  city?: string;
  tier?: string;
};

const isMergeTag = (value?: string) => !value || /{{|}}/.test(value);
const clean = (value: unknown) =>
  typeof value === "string" && value.trim() && !isMergeTag(value) ? value.trim() : undefined;

export const Route = createFileRoute("/confirmation")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    city:
      normalizeCity(s.event_city) ??
      normalizeCity(s.eventCity) ??
      normalizeCity(s.city) ??
      "boston",
    tier: s.tier === "vip" ? "vip" : "ga",
  }),
  head: () => ({
    meta: [{ title: "Purchase Confirmed — Scale & Profit Seminar" }],
  }),
  component: ConfirmationPage,
});

function ConfirmationPage() {
  const { tier } = Route.useSearch();
  const isVip = tier === "vip";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Scale & Profit" className="h-10 w-auto" />
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 className="h-16 w-16 text-primary" />
          <h1 className="mt-6 text-4xl font-black md:text-5xl">
            Congratulations — Your Purchase Is Confirmed!
          </h1>
          {isVip ? (
            <p className="mt-6 text-muted-foreground">
              You're in for the VIP Experience — full access to both days, the exclusive VIP dinner
              with David &amp; Al, preferred seating, a curated swag bag, your VIP name badge, and a
              90-minute implementation call. A confirmation email with all the details is on its
              way.
            </p>
          ) : (
            <p className="mt-6 text-muted-foreground">
              You've got full access to both days of the Scale &amp; Profit Seminar. A confirmation
              email with event details, your workbook, and travel info is on its way.
            </p>
          )}
        </div>

        <Card className="mt-10 p-6 text-center">
          <h2 className="text-xl font-bold text-primary">What to do next:</h2>
          <p className="mt-3 text-muted-foreground">
            If you purchase multiple general admission tickets, please reach out to{" "}
            <a
              href="mailto:Mallory@coachpconsulting.com"
              className="font-semibold text-foreground underline underline-offset-4"
            >
              Mallory@coachpconsulting.com
            </a>{" "}
            to provide your additional attendee's information. Thanks!
          </p>
        </Card>

        <div className="mt-10 text-center">
          <Button asChild size="lg">
            <Link to="/">Back to event details</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
