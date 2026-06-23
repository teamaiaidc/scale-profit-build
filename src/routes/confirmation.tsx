import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { normalizeCity } from "@/lib/city";
import { lookupGhlContactByEmail, tagBuyerForEvent } from "@/lib/ghl.functions";
import logo from "@/assets/hero-banner.webp";

type Search = {
  city?: string;
  tier?: string;
  firstName?: string;
  email?: string;
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
    firstName: clean(s.firstName) ?? clean(s.first_name) ?? clean(s.fname),
    email: clean(s.email) ?? clean(s.contact_email),
  }),
  head: () => ({
    meta: [{ title: "Purchase Confirmed — Scale & Profit Seminar" }],
  }),
  component: ConfirmationPage,
});

function ConfirmationPage() {
  const { city, tier, firstName, email } = Route.useSearch();
  const isVip = tier === "vip";

  // Tag the buyer 🤝 s&p-{tier}-{city}-{yymmdd} now that the purchase is done.
  // GHL redirects here with the contact's email + event_city, so this is the
  // reliable place to apply the tag (the in-page payment message lacks them).
  const tagBuyer = useServerFn(tagBuyerForEvent);
  useEffect(() => {
    if (!email || !city) return;
    // Pull the survey the buyer answered at checkout (saved in this browser).
    let survey: Record<string, string> | undefined;
    try {
      const raw = window.localStorage.getItem("sp-pending-survey");
      if (raw) survey = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    tagBuyer({ data: { email, city, tier: isVip ? "vip" : "ga", survey } })
      .then(() => {
        try {
          window.localStorage.removeItem("sp-pending-survey");
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* non-blocking — admin can still bulk-assign from the dashboard */
      });
  }, [email, city, isVip, tagBuyer]);

  // Greet the buyer by name. The name may arrive in the URL; if not but we have
  // their email, look it up from GHL so the greeting still personalizes.
  const lookupGhl = useServerFn(lookupGhlContactByEmail);
  const [name, setName] = useState(firstName ?? "");
  useEffect(() => {
    if (firstName || !email) return;
    lookupGhl({ data: { email } })
      .then((res) => {
        if (res.contact?.firstName) setName(res.contact.firstName);
      })
      .catch(() => {
        /* leave the generic greeting */
      });
  }, [firstName, email, lookupGhl]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" hash="hero" className="flex items-center gap-2">
            <img src={logo} alt="Scale & Profit" className="h-10 w-auto" />
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 className="h-16 w-16 text-primary" />
          <h1 className="mt-6 text-4xl font-black md:text-5xl">
            {firstName?.trim()
              ? `Congratulations, ${firstName.trim()}! Your Purchase Is Confirmed!`
              : "Congratulations — Your Purchase Is Confirmed!"}
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
            <Link to="/" hash="hero">
              Back to event details
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
