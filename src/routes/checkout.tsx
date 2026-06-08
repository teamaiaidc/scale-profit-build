import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Check, Lock, ShieldCheck, Sparkles, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitCheckoutToGhl } from "@/lib/ghl.functions";

type Search = { city?: string; tier?: string };

export const Route = createFileRoute("/checkout")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    city: typeof s.city === "string" ? s.city : "boston",
    tier: typeof s.tier === "string" ? s.tier : "ga",
  }),
  head: () => ({
    meta: [
      { title: "Checkout — Scale & Profit Seminar" },
      { name: "description", content: "Reserve your seat at the Scale & Profit Seminar." },
    ],
  }),
  component: CheckoutPage,
});

const CITIES: Record<string, { name: string; date: string; venue: string; address: string }> = {
  boston: {
    name: "Boston",
    date: "June 2nd & 3rd, 2026",
    venue: "Aloft Boston Seaport District",
    address: "401-403 D Street, Boston, MA 02210",
  },
  nashville: {
    name: "Nashville",
    date: "August 5th–6th, 2026",
    venue: "W Nashville Hotel",
    address: "300 12th Ave S, Nashville, TN 37203",
  },
  california: {
    name: "California",
    date: "December 8th–9th, 2026",
    venue: "Venue TBA",
    address: "California",
  },
};

const GA_QTY = [
  { qty: 1, label: "Scale & Profit - Single Ticket Only", price: 997 },
  { qty: 2, label: "Scale & Profit - 2 Tickets", price: 1794 },
  { qty: 3, label: "Scale & Profit - 3 Tickets", price: 2541 },
  { qty: 4, label: "Scale & Profit - 4 Tickets", price: 3088 },
  { qty: 5, label: "Scale & Profit - 5 Tickets", price: 3535 },
];

const GA_PERKS = [
  "Full access to both days of the Scale & Profit Seminar",
  "Proven frameworks, strategies, tips & tricks from David & Al",
  "Q&A sessions with top-performing agency owners",
  "Workbook and implementation planner",
  "Networking with high-performing agents via cocktail hour",
];

const VIP_PERKS = [
  "Everything in General Admission, plus:",
  "Exclusive VIP Dinner — Intimate dinner with David, Al & their key team",
  "Direct access to ask your specific questions and network with the speakers",
  "Preferred seating in the seminar room",
  "Exclusive curated swag bag of resources and tools",
  "VIP name badge to signal your status and facilitate connections",
  "90-minute exclusive implementation call",
];

type Attendee = { firstName: string; lastName: string; email: string };

function CheckoutPage() {
  const { city, tier } = Route.useSearch();
  const navigate = useNavigate();
  const cityInfo = CITIES[city ?? "boston"] ?? CITIES.boston;
  const isVip = tier === "vip";

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedQty, setSelectedQty] = useState<number>(isVip ? 1 : 1);
  const [coupon, setCoupon] = useState("");

  const [yourInfo, setYourInfo] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    countryCode: "+1",
  });

  const initialAttendees = (n: number): Attendee[] =>
    Array.from({ length: n }, () => ({ firstName: "", lastName: "", email: "" }));
  const [attendees, setAttendees] = useState<Attendee[]>(initialAttendees(1));

  const [billing, setBilling] = useState({
    cardName: "",
    cardNumber: "",
    expiry: "",
    cvc: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "United States",
  });

  const selected = useMemo(() => {
    if (isVip) return { qty: 1, label: "Scale & Profit - VIP", price: 1600 };
    return GA_QTY.find((g) => g.qty === selectedQty) ?? GA_QTY[0];
  }, [isVip, selectedQty]);

  const total = selected.price;

  const updateAttendeeCount = (qty: number) => {
    setSelectedQty(qty);
    setAttendees((prev) => {
      const next = [...prev];
      while (next.length < qty) next.push({ firstName: "", lastName: "", email: "" });
      next.length = qty;
      return next;
    });
  };

  const submitToGhl = useServerFn(submitCheckoutToGhl);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitToGhl({
        data: {
          firstName: yourInfo.firstName,
          lastName: yourInfo.lastName,
          email: yourInfo.email,
          phone: `${yourInfo.countryCode.replace(/[^+\d]/g, "")}${yourInfo.phone}`,
          city: city ?? "boston",
          tier: (tier === "vip" ? "vip" : "ga") as "ga" | "vip",
          quantity: isVip ? 1 : selectedQty,
          amount: total,
          attendees,
        },
      });
      navigate({ to: "/checkout/success", search: { city, tier } as Search });
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong. Please try again.",
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-wide">
            <Sparkles className="h-5 w-5 text-primary" />
            <span>SCALE & PROFIT</span>
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to event
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.3em] text-primary">{cityInfo.name} — {cityInfo.date}</p>
          <h1 className="mt-2 text-3xl font-black md:text-4xl">
            {isVip ? "VIP Experience Checkout" : "General Admission Checkout"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {cityInfo.venue} — {cityInfo.address}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_420px]">
          {/* LEFT: forms */}
          <div className="space-y-6">
            {/* Ticket selector for GA */}
            {!isVip && (
              <Card className="p-6">
                <h2 className="text-lg font-bold">Payment</h2>
                <p className="text-sm text-muted-foreground">Choose your ticket bundle</p>
                <div className="mt-4 divide-y divide-border rounded-lg border border-border">
                  <div className="grid grid-cols-[1fr_80px_100px] gap-3 px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
                    <span>Item</span>
                    <span className="text-center">Quantity</span>
                    <span className="text-right">Price</span>
                  </div>
                  {GA_QTY.map((opt) => (
                    <label
                      key={opt.qty}
                      className={`grid cursor-pointer grid-cols-[1fr_80px_100px] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 ${
                        selectedQty === opt.qty ? "bg-muted/40" : ""
                      }`}
                    >
                      <span className="flex items-center gap-3 text-sm font-medium">
                        <input
                          type="radio"
                          name="qty"
                          checked={selectedQty === opt.qty}
                          onChange={() => updateAttendeeCount(opt.qty)}
                          className="accent-primary"
                        />
                        {opt.label}
                      </span>
                      <span className="text-center text-sm">{opt.qty}</span>
                      <span className="text-right text-sm font-semibold text-primary">
                        ${opt.price.toLocaleString()}.00
                      </span>
                    </label>
                  ))}
                </div>
              </Card>
            )}

            {/* Stepper */}
            <Card className="p-6">
              <div className="mb-6 flex items-center gap-2 text-sm">
                {[
                  [1, "Your Info"],
                  [2, "Who's Attending?"],
                  [3, isVip ? "Billing Info" : "Finalize Sign Up!"],
                ].map(([n, label]) => (
                  <div key={n} className="flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        step >= (n as number)
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {n}
                    </span>
                    <span
                      className={
                        step === n ? "font-semibold text-foreground" : "text-muted-foreground"
                      }
                    >
                      {label}
                    </span>
                    {n !== 3 && <span className="mx-2 h-px w-8 bg-border" />}
                  </div>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                {step === 1 && (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="First name">
                        <Input
                          required
                          value={yourInfo.firstName}
                          onChange={(e) =>
                            setYourInfo({ ...yourInfo, firstName: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Last name">
                        <Input
                          required
                          value={yourInfo.lastName}
                          onChange={(e) =>
                            setYourInfo({ ...yourInfo, lastName: e.target.value })
                          }
                        />
                      </Field>
                    </div>
                    <Field label="Email">
                      <Input
                        type="email"
                        required
                        value={yourInfo.email}
                        onChange={(e) => setYourInfo({ ...yourInfo, email: e.target.value })}
                      />
                    </Field>
                    <Field label="Phone">
                      <div className="flex gap-2">
                        <select
                          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                          value={yourInfo.countryCode}
                          onChange={(e) =>
                            setYourInfo({ ...yourInfo, countryCode: e.target.value })
                          }
                        >
                          <option value="+1">🇺🇸 +1</option>
                          <option value="+44">🇬🇧 +44</option>
                          <option value="+1ca">🇨🇦 +1</option>
                          <option value="+61">🇦🇺 +61</option>
                        </select>
                        <Input
                          type="tel"
                          required
                          value={yourInfo.phone}
                          onChange={(e) => setYourInfo({ ...yourInfo, phone: e.target.value })}
                        />
                      </div>
                    </Field>
                    <Button type="button" className="w-full" onClick={() => setStep(2)}>
                      Go To Step #2
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      We Respect Your Privacy & Information.
                    </p>
                  </>
                )}

                {step === 2 && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Please provide details for {attendees.length} attendee
                      {attendees.length > 1 ? "s" : ""}.
                    </p>
                    {attendees.map((a, i) => (
                      <div key={i} className="space-y-3 rounded-lg border border-border p-4">
                        <p className="text-sm font-semibold text-primary">Attendee {i + 1}</p>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Field label="First name">
                            <Input
                              required
                              value={a.firstName}
                              onChange={(e) => {
                                const next = [...attendees];
                                next[i] = { ...a, firstName: e.target.value };
                                setAttendees(next);
                              }}
                            />
                          </Field>
                          <Field label="Last name">
                            <Input
                              required
                              value={a.lastName}
                              onChange={(e) => {
                                const next = [...attendees];
                                next[i] = { ...a, lastName: e.target.value };
                                setAttendees(next);
                              }}
                            />
                          </Field>
                        </div>
                        <Field label="Email">
                          <Input
                            type="email"
                            required
                            value={a.email}
                            onChange={(e) => {
                              const next = [...attendees];
                              next[i] = { ...a, email: e.target.value };
                              setAttendees(next);
                            }}
                          />
                        </Field>
                      </div>
                    ))}
                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={() => setStep(1)}>
                        Back
                      </Button>
                      <Button type="button" className="flex-1" onClick={() => setStep(3)}>
                        Continue to Payment
                      </Button>
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <div className="grid gap-4">
                      <Field label="Name on card">
                        <Input
                          required
                          value={billing.cardName}
                          onChange={(e) => setBilling({ ...billing, cardName: e.target.value })}
                        />
                      </Field>
                      <Field label="Card number">
                        <Input
                          required
                          inputMode="numeric"
                          placeholder="1234 1234 1234 1234"
                          value={billing.cardNumber}
                          onChange={(e) =>
                            setBilling({ ...billing, cardNumber: e.target.value })
                          }
                        />
                      </Field>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Expiration">
                          <Input
                            required
                            placeholder="MM / YY"
                            value={billing.expiry}
                            onChange={(e) => setBilling({ ...billing, expiry: e.target.value })}
                          />
                        </Field>
                        <Field label="CVC">
                          <Input
                            required
                            inputMode="numeric"
                            placeholder="CVC"
                            value={billing.cvc}
                            onChange={(e) => setBilling({ ...billing, cvc: e.target.value })}
                          />
                        </Field>
                      </div>
                      <Field label="Billing address">
                        <Input
                          required
                          value={billing.address}
                          onChange={(e) => setBilling({ ...billing, address: e.target.value })}
                        />
                      </Field>
                      <div className="grid gap-4 md:grid-cols-3">
                        <Field label="City">
                          <Input
                            required
                            value={billing.city}
                            onChange={(e) => setBilling({ ...billing, city: e.target.value })}
                          />
                        </Field>
                        <Field label="State">
                          <Input
                            required
                            value={billing.state}
                            onChange={(e) => setBilling({ ...billing, state: e.target.value })}
                          />
                        </Field>
                        <Field label="ZIP">
                          <Input
                            required
                            value={billing.zip}
                            onChange={(e) => setBilling({ ...billing, zip: e.target.value })}
                          />
                        </Field>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <Button type="button" variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                        Back
                      </Button>
                      <Button type="submit" className="flex-1" disabled={submitting}>
                        <Lock className="mr-2 h-4 w-4" />
                        {submitting ? "Processing…" : `Pay $${total.toLocaleString()}.00`}
                      </Button>
                    </div>
                    {submitError && (
                      <p className="text-center text-xs text-destructive">{submitError}</p>
                    )}
                    <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                      <ShieldCheck className="h-4 w-4 text-primary" /> 100% Secure & Safe Payments
                    </p>
                  </>
                )}
              </form>
            </Card>
          </div>

          {/* RIGHT: summary */}
          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <Card className="overflow-hidden">
              <div className="border-b border-border bg-card/60 p-6">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  {isVip ? "VIP Experience" : "General Admission"}
                </p>
                <p className="mt-1 text-3xl font-black text-primary">
                  ${isVip ? "1,600" : "997"}
                </p>
                {isVip && (
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Limited Seats Available
                  </p>
                )}
              </div>
              <ul className="space-y-2 p-6 text-sm">
                {(isVip ? VIP_PERKS : GA_PERKS).map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-6">
              <h3 className="font-bold">Order Summary</h3>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>{selected.label}</span>
                  <span>${selected.price.toLocaleString()}.00</span>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Input
                  placeholder="Coupon code"
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value)}
                />
                <Button type="button" variant="outline">
                  Apply
                </Button>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <span className="font-bold">Order Total</span>
                <span className="text-xl font-black text-primary">
                  ${total.toLocaleString()}.00
                </span>
              </div>
              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" /> * 100% Secure & Safe Payments *
              </p>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
