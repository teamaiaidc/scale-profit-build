import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addAttendeesToGhl, lookupGhlContactByEmail } from "@/lib/ghl.functions";
import logo from "@/assets/hero-banner.webp";

type Search = {
  city?: string;
  tier?: string;
  qty?: number;
  email?: string;
  firstName?: string;
  lastName?: string;
  endDate?: string;
};

const isMergeTag = (value?: string) => !value || /{{|}}/.test(value);
const clean = (value: unknown) =>
  typeof value === "string" && value.trim() && !isMergeTag(value) ? value.trim() : undefined;
const parseTicketQty = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 1;
  if (isMergeTag(value)) return 1;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 1;
};
const clampTicketQty = (value: number) => Math.min(Math.max(Math.trunc(value), 1), 20);

export const Route = createFileRoute("/confirmation")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const str = (a: unknown, b: unknown) => clean(a) ?? clean(b);
    return {
      city: clean(s.city) ?? "boston",
      tier: s.tier === "vip" ? "vip" : "ga",
      qty: clampTicketQty(parseTicketQty(s.qty)),
      email: clean(s.email),
      // Accept camelCase or snake_case (GHL merge fields use snake_case).
      firstName: str(s.firstName, s.first_name),
      lastName: str(s.lastName, s.last_name),
      endDate: str(s.endDate, s.end_date),
    };
  },
  head: () => ({
    meta: [{ title: "Purchase Confirmed — Scale & Profit Seminar" }],
  }),
  component: ConfirmationPage,
});

type Attendee = { firstName: string; lastName: string; email: string };

function ConfirmationPage() {
  const { city, tier, qty, email, firstName, lastName, endDate } = Route.useSearch();
  const isVip = tier === "vip";
  const initialQty = qty ?? 1;

  // Wait 10s before reading qty / rendering forms — gives GHL time to populate
  // the custom value {{custom_values.sp2026ticket_quantity}} that drives qty.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 10000);
    return () => clearTimeout(t);
  }, []);

  // VIP is always 1 ticket. For GA, qty is read from URL (populated by GHL
  // merge tag {{custom_values.sp2026ticket_quantity}}).
  const [ticketCount, setTicketCount] = useState(initialQty);
  const lookupContact = useServerFn(lookupGhlContactByEmail);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    const resolveQty = async () => {
      let nextQty = initialQty;
      if (!isVip && email) {
        try {
          const { contact, fieldDefs } = await lookupContact({ data: { email } });
          const quantityFieldIds = new Set(
            fieldDefs
              .filter((f) => {
                const key = `${f.fieldKey ?? ""} ${f.name ?? ""}`.toLowerCase();
                return (
                  key.includes("sp2026_ticket_quantity") ||
                  key.includes("sp2026ticket_quantity") ||
                  key.includes("ticket_quantity")
                );
              })
              .map((f) => f.id),
          );
          const values = contact?.customFields ?? [];
          const hit = values.find((f) => quantityFieldIds.has(f.id) && /\d+/.test(f.value));
          if (hit) nextQty = parseTicketQty(hit.value);
        } catch {
          /* keep URL qty fallback */
        }
      }
      if (active) setTicketCount(clampTicketQty(nextQty));
    };
    void resolveQty();
    return () => {
      active = false;
    };
  }, [ready, initialQty, isVip, email, lookupContact]);

  const addAttendees = useServerFn(addAttendeesToGhl);

  const [attendees, setAttendees] = useState<Attendee[]>(() =>
    Array.from({ length: ticketCount }, (_, i) => ({
      firstName: i === 0 ? (firstName ?? "") : "",
      lastName: i === 0 ? (lastName ?? "") : "",
      email: i === 0 ? (email ?? "") : "",
    })),
  );

  // Re-size the attendee array whenever ticketCount changes, preserving filled rows.
  useEffect(() => {
    setAttendees((prev) => {
      if (prev.length === ticketCount) return prev;
      const next = Array.from(
        { length: ticketCount },
        (_, i) =>
          prev[i] ?? {
            firstName: i === 0 ? (firstName ?? "") : "",
            lastName: i === 0 ? (lastName ?? "") : "",
            email: i === 0 ? (email ?? "") : "",
          },
      );
      return next;
    });
  }, [ticketCount, firstName, lastName, email]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRow = (i: number, key: keyof Attendee, value: string) =>
    setAttendees((prev) => prev.map((a, idx) => (idx === i ? { ...a, [key]: value } : a)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (attendees.some((a) => !a.firstName.trim() || !a.lastName.trim() || !a.email.trim())) {
      setError("Please fill in every attendee's name and email.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await addAttendees({
        data: { city: city ?? "boston", tier: tier ?? "ga", endDate, attendees },
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

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
          {tier === "vip" ? (
            <>
              <p className="mt-4 text-lg font-semibold text-primary">
                You're in for the VIP Experience.
              </p>
              <p className="mt-2 text-muted-foreground">
                Beyond full access to both days, your VIP ticket includes the exclusive VIP dinner
                with David &amp; Al, preferred seating, a curated swag bag, your VIP name badge, and
                a 90-minute implementation call. A confirmation email with all the details is on its
                way.
              </p>
            </>
          ) : (
            <>
              <p className="mt-4 text-lg font-semibold text-primary">
                You're booked for General Admission.
              </p>
              <p className="mt-2 text-muted-foreground">
                You've got full access to both days of the Scale &amp; Profit Seminar. A
                confirmation email with event details, your workbook, and travel info is on its
                way.
              </p>
            </>
          )}
        </div>

        {/* GA: brief wait so GHL can populate {{custom_values.sp2026ticket_quantity}} */}
        {!isVip && !ready && (
          <Card className="mt-10 flex items-center gap-3 p-6">
            <Loader2 className="h-6 w-6 shrink-0 animate-spin text-primary" />
            <div>
              <p className="font-semibold">Finalizing your order…</p>
              <p className="text-sm text-muted-foreground">
                Hang tight while we confirm your ticket count. This takes about 10 seconds.
              </p>
            </div>
          </Card>
        )}

        {/* GA: one attendee form per purchased ticket */}
        {!isVip && ready && !saved && (
          <Card className="mt-10 p-6">
            <h2 className="text-xl font-bold">
              Register your {ticketCount === 1 ? "attendee" : `${ticketCount} attendees`}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {ticketCount === 1
                ? "Please confirm your attendee details below."
                : `You purchased ${ticketCount} tickets — please fill in details for each attendee.`}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5" suppressHydrationWarning>
              {attendees.map((a, i) => (
                <div key={i} className="space-y-3 rounded-lg border border-border p-4">
                  <p className="text-sm font-semibold text-primary">
                    Attendee {i + 1}
                    {i === 0 ? " (you)" : ""}
                  </p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        First name
                      </Label>
                      <Input
                        required
                        value={a.firstName}
                        onChange={(e) => setRow(i, "firstName", e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Last name
                      </Label>
                      <Input
                        required
                        value={a.lastName}
                        onChange={(e) => setRow(i, "lastName", e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                      Email
                    </Label>
                    <Input
                      type="email"
                      required
                      value={a.email}
                      onChange={(e) => setRow(i, "email", e.target.value)}
                    />
                  </div>
                </div>
              ))}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving attendees…
                  </>
                ) : (
                  "Submit Attendee Details"
                )}
              </Button>
            </form>
          </Card>
        )}

        {!isVip && saved && (
          <Card className="mt-10 flex items-center gap-3 p-6">
            <Check className="h-6 w-6 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">
                {ticketCount === 1
                  ? "Attendee details saved!"
                  : `All ${ticketCount} attendees saved!`}
              </p>
              <p className="text-sm text-muted-foreground">
                Each attendee will receive their own confirmation. See you at the seminar.
              </p>
            </div>
          </Card>
        )}

        <div className="mt-10 text-center">
          <Button asChild size="lg" variant={!isVip && !saved ? "outline" : "default"}>
            <Link to="/">Back to event details</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
