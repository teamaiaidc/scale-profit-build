import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addAttendeesToGhl } from "@/lib/ghl.functions";
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

export const Route = createFileRoute("/confirmation")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const n = Number(s.qty);
    const str = (a: unknown, b: unknown) =>
      typeof a === "string" ? a : typeof b === "string" ? b : undefined;
    return {
      city: typeof s.city === "string" ? s.city : "boston",
      tier: s.tier === "vip" ? "vip" : "ga",
      qty: Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 20) : 1,
      email: typeof s.email === "string" ? s.email : undefined,
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

  // VIP is always 1 ticket. For GA, let the buyer confirm how many tickets
  // they purchased (GHL doesn't always send a parseable qty payload).
  const [ticketCount, setTicketCount] = useState(initialQty);
  const isMulti = ticketCount > 1;

  const addAttendees = useServerFn(addAttendeesToGhl);

  const [attendees, setAttendees] = useState<Attendee[]>(() =>
    Array.from({ length: ticketCount }, (_, i) => ({
      firstName: i === 0 ? firstName ?? "" : "",
      lastName: i === 0 ? lastName ?? "" : "",
      email: i === 0 ? email ?? "" : "",
    })),
  );

  // Re-size the attendee array whenever ticketCount changes, preserving filled rows.
  useEffect(() => {
    setAttendees((prev) => {
      if (prev.length === ticketCount) return prev;
      const next = Array.from({ length: ticketCount }, (_, i) =>
        prev[i] ?? {
          firstName: i === 0 ? firstName ?? "" : "",
          lastName: i === 0 ? lastName ?? "" : "",
          email: i === 0 ? email ?? "" : "",
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
                Beyond full access to both days, your VIP ticket includes the exclusive VIP
                dinner with David &amp; Al, preferred seating, a curated swag bag, your VIP name
                badge, and a 90-minute implementation call. A confirmation email with all the
                details is on its way.
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

        {/* Multi-ticket attendee form */}
        {isMulti && !saved && (
          <Card className="mt-10 p-6">
            <h2 className="text-xl font-bold">You purchased {ticketCount} tickets</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Please provide each attendee's details below so we can register every ticket.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
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

        {isMulti && saved && (
          <Card className="mt-10 flex items-center gap-3 p-6">
            <Check className="h-6 w-6 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">All {ticketCount} attendees saved!</p>
              <p className="text-sm text-muted-foreground">
                Each attendee will receive their own confirmation. See you at the seminar.
              </p>
            </div>
          </Card>
        )}

        <div className="mt-10 text-center">
          <Button asChild size="lg" variant={isMulti && !saved ? "outline" : "default"}>
            <Link to="/">Back to event details</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
