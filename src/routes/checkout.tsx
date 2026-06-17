import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Check, ShieldCheck, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listGhlProducts,
  submitCheckoutToGhl,
  type GhlProduct,
  type GhlPrice,
} from "@/lib/ghl.functions";
import { listEvents } from "@/lib/events.functions";
import { loadStoredEvents } from "@/lib/events.store";
import { getTodayISO, splitEvents, type EventRow } from "@/lib/events";
import { normalizeCity } from "@/lib/city";
import logo from "@/assets/hero-banner.webp";

type Search = { city?: string; tier?: string; email?: string };

export const Route = createFileRoute("/checkout")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    city: normalizeCity(s.city),
    tier: typeof s.tier === "string" ? s.tier : "ga",
    email: typeof s.email === "string" ? s.email : undefined,
  }),


  head: () => ({
    meta: [
      { title: "Checkout — Scale & Profit Seminar" },
      { name: "description", content: "Reserve your seat at the Scale & Profit Seminar." },
    ],
  }),
  loader: async () => {
    const [eventsResult, productsResult] = await Promise.allSettled([
      listEvents(),
      listGhlProducts(),
    ]);
    const events =
      eventsResult.status === "fulfilled" ? eventsResult.value : [];
    const ghlProducts =
      productsResult.status === "fulfilled" ? productsResult.value.products : [];
    if (productsResult.status === "rejected") {
      console.warn(
        "[checkout loader] listGhlProducts failed, falling back to built-in pricing:",
        (productsResult.reason as Error)?.message,
      );
    }
    if (eventsResult.status === "rejected") {
      console.warn(
        "[checkout loader] listEvents failed, falling back to defaults:",
        (eventsResult.reason as Error)?.message,
      );
    }
    return { events, ghlProducts };
  },
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

const SHIRT_SIZES = ["Small", "Medium", "Large", "XL", "XXL", "XXXL"];

// GHL-hosted payment forms, embedded as Step 2. Real payment + purchase
// automations fire inside GHL.
const GHL_PAYMENT_FORMS: Record<"ga" | "vip", string> = {
  ga: "https://go.aiaimastermind.com/widget/form/EB8ObhaPz6Fw2Fq6urY0",
  vip: "https://go.aiaimastermind.com/widget/form/VaXtddWW607K6i0P30d8",
};
const GHL_FORM_EMBED_JS = "https://go.aiaimastermind.com/js/form_embed.js";

function CheckoutPage() {
  const { city, tier, email: emailFromUrl } = Route.useSearch();
  const { events: loaderEvents, ghlProducts } = Route.useLoaderData();
  const [events, setEvents] = useState(loaderEvents);

  // Live pricing pulled from the two GHL products (fall back to built-in values).
  const live = useMemo(() => {
    const products = ghlProducts as GhlProduct[];
    const findProduct = (matcher: RegExp) => products.find((p: GhlProduct) => matcher.test(p.name));

    // VIP: single one-time price.
    const vipProduct = findProduct(/vip/i);
    const vipPrice =
      vipProduct?.prices.find((pr: GhlPrice) => pr.type === "one_time") ?? vipProduct?.prices[0];
    const vip = vipPrice && vipPrice.amount > 0 ? vipPrice.amount : null;

    // GA: build the full quantity table from the product's prices, deriving the
    // ticket count from each price name (e.g. "… 2 Tickets - SAVE $200" → qty 2).
    const gaProduct = findProduct(/general|admission|\bga\b/i);
    let gaTiers: { qty: number; label: string; price: number }[] | null = null;
    if (gaProduct && gaProduct.prices.length > 0) {
      const rows = gaProduct.prices
        .map((pr: GhlPrice) => {
          const qty = Number(pr.name.match(/(\d+)\s*ticket/i)?.[1] ?? 0);
          return qty > 0 && pr.amount > 0
            ? {
                qty,
                label:
                  qty === 1
                    ? "Scale & Profit - Single Ticket Only"
                    : `Scale & Profit - ${qty} Tickets`,
                price: pr.amount,
              }
            : null;
        })
        .filter(
          (
            r: { qty: number; label: string; price: number } | null,
          ): r is { qty: number; label: string; price: number } => r !== null,
        )
        .sort((a: { qty: number }, b: { qty: number }) => a.qty - b.qty);
      if (rows.length > 0) gaTiers = rows;
    }

    return { vip, gaTiers };
  }, [ghlProducts]);

  // GA options come from GHL when available, else the built-in table.
  const gaOptions = live.gaTiers ?? GA_QTY;
  // Pick up this browser's admin edits (localStorage) after hydration.
  useEffect(() => {
    setEvents(loadStoredEvents(loaderEvents));
  }, [loaderEvents]);
  // Build the city map from live event data, falling back to the hardcoded defaults.
  const cities = useMemo(() => {
    const map: Record<string, { name: string; date: string; venue: string; address: string }> = {
      ...CITIES,
    };
    for (const e of events) {
      map[e.slug] = { name: e.city, date: e.date, venue: e.venue, address: e.address };
    }
    return map;
  }, [events]);

  // The event/city is whatever the buyer clicked (URL ?city=). Only when it's
  // missing/unknown do we fall back to the first UPCOMING event — never a
  // hardcoded "boston".
  const resolvedCity = useMemo(() => {
    if (city && events.some((e) => e.slug === city)) return city;
    const upcoming = splitEvents(events, getTodayISO()).upcoming;
    return upcoming[0]?.slug ?? events[0]?.slug ?? city ?? "";
  }, [city, events]);

  // yymmdd from the event's end date, plus the full tag value, so a GHL workflow
  // can read them off the form and tag the buyer 🤝 s&p-{city}-{yymmdd}.
  const eventYymmdd = (events.find((e) => e.slug === resolvedCity)?.end_date ?? "").replace(
    /^\d{2}(\d{2})-(\d{2})-(\d{2})$/,
    "$1$2$3",
  );
  const eventTagValue = eventYymmdd ? `🤝 s&p-${resolvedCity}-${eventYymmdd}` : `🤝 s&p-${resolvedCity}`;

  const cityInfo = cities[resolvedCity] ?? cities.boston ?? CITIES.boston;
  const isVip = tier === "vip";

  // Step 2 embedded GHL payment form (per tier).
  const paymentFormUrl = GHL_PAYMENT_FORMS[isVip ? "vip" : "ga"];
  const paymentFormId = paymentFormUrl.split("/").pop() ?? "";
  // Load GHL's embed script once so the iframe auto-resizes.
  useEffect(() => {
    if (document.querySelector(`script[src="${GHL_FORM_EMBED_JS}"]`)) return;
    const s = document.createElement("script");
    s.src = GHL_FORM_EMBED_JS;
    s.async = true;
    document.body.appendChild(s);
  }, []);

  const navigate = useNavigate();
  const submitToGhl = useServerFn(submitCheckoutToGhl);
  // Two-step checkout: (1) questions, (2) payment. Name, email, phone, card and
  // quantity are all collected once inside the embedded GHL payment form.
  const [step, setStep] = useState<1 | 2>(1);

  // Quantity is chosen inside the GHL payment form; we treat this app's order as
  // a single base ticket for the summary.
  const selectedQty = 1;

  const [survey, setSurvey] = useState({
    agencyState: "",
    hasMoa: "",
    attendedBefore: "",
    shirtSize: "",
  });
  const [surveyError, setSurveyError] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (isVip) return { qty: 1, label: "Scale & Profit - VIP", price: live.vip ?? 1600 };
    return gaOptions.find((g) => g.qty === selectedQty) ?? gaOptions[0];
  }, [isVip, selectedQty, gaOptions, live.vip]);

  const total = selected.price;

  // Embedded payment form URL with the event + buyer details passed through, so
  // the GHL order record captures WHICH event was purchased (and prefills the
  // buyer's info). Requires matching fields/query-keys configured in the GHL form.
  const paymentSrc = useMemo(() => {
    const u = new URL(paymentFormUrl);
    const params: Record<string, string> = {
      event_city: resolvedCity,
      event_name: cityInfo.name,
      event_date: cityInfo.date,
      // For the GHL tagging workflow: the date as yymmdd and the full tag value.
      event_yymmdd: eventYymmdd,
      event_tag: eventTagValue,
      ticket_tier: isVip ? "VIP" : "General Admission",
      // Survey answers passed through so GHL captures them on submit (requires
      // matching hidden fields in the GHL form). The survey is also attached to
      // the contact server-side on payment success as a fallback.
      agency_state: survey.agencyState,
      has_moa: survey.hasMoa,
      attended_before: survey.attendedBefore,
      shirt_size: survey.shirtSize,
      // Prefill email only when it arrived in the URL (no double entry).
      ...(emailFromUrl ? { email: emailFromUrl } : {}),
    };
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    return u.toString();
  }, [
    paymentFormUrl,
    resolvedCity,
    cityInfo.name,
    cityInfo.date,
    eventYymmdd,
    eventTagValue,
    isVip,
    survey,
    emailFromUrl,
  ]);

  // When the embedded GHL payment form reports a successful submission, take
  // the buyer straight to our confirmation/loop page instead of GHL's default
  // thank-you screen. GHL's form_embed.js posts messages from its origin when
  // the form is submitted — match loosely to cover variants.
  useEffect(() => {
    if (step !== 2) return;
    const onMessage = (e: MessageEvent) => {
      try {
        const origin = e.origin || "";
        if (!/aiaimastermind\.com|leadconnectorhq\.com|msgsndr\.com/i.test(origin)) return;
        const raw = e.data;
        const str =
          typeof raw === "string" ? raw : raw && typeof raw === "object" ? JSON.stringify(raw) : "";
        if (!/form[_-]?submit|submitted|success|payment[_-]?success/i.test(str)) return;

        // Derive qty from the GHL form payload. GHL posts the chosen
        // product/price info on submit — parse it to find which tier the
        // buyer actually purchased so we know how many attendees to collect.
        let qty = 1;
        if (!isVip) {
          // 1) Explicit qty field if GHL sends one.
          const qtyMatch = str.match(/"(?:qty|quantity|ticket[_-]?count|numberOfTickets)"\s*:\s*"?(\d+)/i);
          if (qtyMatch) {
            qty = Math.min(Math.max(parseInt(qtyMatch[1], 10), 1), 20);
          } else {
            // 2) Product / price NAME — coupon-proof. Matches:
            //    "Single Ticket Only" → 1
            //    "2 Tickets", "3 Tickets", … "N Tickets" → N
            const single = /single\s*ticket/i.test(str);
            const nTickets = str.match(/(\d+)\s*tickets?\b/i);
            if (single && !nTickets) {
              qty = 1;
            } else if (nTickets) {
              qty = Math.min(Math.max(parseInt(nTickets[1], 10), 1), 20);
            } else {
              // 3) Last resort: match the amount paid (no coupon case).
              const amounts = Array.from(
                str.matchAll(/(?:amount|total|price|subtotal)"?\s*:\s*"?(\d+(?:\.\d+)?)/gi),
              )
                .map((m) => parseFloat(m[1]))
                .filter((n) => n > 0);
              if (amounts.length > 0) {
                const paid = Math.max(...amounts);
                const match = gaOptions.find((o) => Math.abs(o.price - paid) <= 5);
                if (match) qty = match.qty;
              }
            }
          }
        }

        // Pull the buyer's identity out of the GHL form payload so we can attach
        // the survey to the same contact (matched by email) and prefill the
        // confirmation page — without ever asking for name/email in our own form.
        const buyerEmail = str.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
        const fullName = str.match(/"full_name"\s*:\s*"([^"]+)"/i)?.[1]?.trim() ?? "";
        const [firstName = "", ...rest] = fullName.split(/\s+/);
        const lastName = rest.join(" ");

        // Attach the survey + event details to the contact GHL just created.
        if (buyerEmail) {
          submitToGhl({
            data: {
              firstName,
              lastName,
              email: buyerEmail,
              phone: "",
              city: resolvedCity,
              tier: isVip ? "vip" : "ga",
              quantity: isVip ? 1 : qty,
              amount: total,
              survey,
              event: {
                name: cityInfo.name,
                date: cityInfo.date,
                venue: cityInfo.venue,
                address: cityInfo.address,
                time: events.find((ev: EventRow) => ev.slug === resolvedCity)?.time,
              },
            },
          }).catch((err) => console.warn("GHL survey attach failed:", err));
        }

        navigate({
          to: "/confirmation",
          search: {
            city: resolvedCity,
            tier: isVip ? "vip" : "ga",
            qty,
            email: buyerEmail || undefined,
            firstName: firstName || undefined,
            lastName: lastName || undefined,
          },
        });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [step, navigate, resolvedCity, isVip, gaOptions, survey, total, cityInfo, events, submitToGhl]);

  // Questions → Payment: validate the survey, then reveal the GHL payment form
  // (which collects name, email, phone, card and quantity in one place).
  const goToPaymentFromSurvey = () => {
    if (
      !survey.agencyState.trim() ||
      !survey.hasMoa ||
      !survey.attendedBefore.trim() ||
      !survey.shirtSize
    ) {
      setSurveyError("Please answer all questions before continuing.");
      return;
    }
    setSurveyError(null);
    // Bridge the survey to the confirmation page (same browser) so it can be
    // saved to the contact once GHL redirects there with the buyer's email.
    try {
      window.localStorage.setItem("sp-pending-survey", JSON.stringify(survey));
    } catch {
      /* ignore private-mode / quota errors */
    }
    setStep(2);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Scale & Profit" className="h-10 w-auto" />
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
          <p className="text-sm uppercase tracking-[0.3em] text-primary">
            {cityInfo.name} — {cityInfo.date}
          </p>
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
            {/* Stepper */}
            <Card className="p-6">
              <div className="mb-6 flex items-center gap-2 text-sm">
                {[
                  [1, "A Few Questions"],
                  [2, "Payment"],
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
                    {n !== 2 && <span className="mx-2 h-px w-8 bg-border" />}
                  </div>
                ))}
              </div>

              <form onSubmit={(e) => e.preventDefault()} className="space-y-5" suppressHydrationWarning>
                {step === 1 && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      A few quick questions before we finalize your order.
                    </p>
                    <Field label="Which state is your agency located in?">
                      <Input
                        required
                        placeholder="Enter your state"
                        value={survey.agencyState}
                        onChange={(e) => setSurvey({ ...survey, agencyState: e.target.value })}
                      />
                    </Field>

                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Do you have a MOA?
                      </Label>
                      <div className="flex flex-col gap-2">
                        {["Yes", "No"].map((opt) => (
                          <label key={opt} className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="hasMoa"
                              className="accent-primary"
                              checked={survey.hasMoa === opt}
                              onChange={() => setSurvey({ ...survey, hasMoa: opt })}
                            />
                            {opt}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Have you attended a Scale + Profit seminar before?
                      </Label>
                      <div className="flex flex-col gap-2">
                        {["Yes", "No"].map((opt) => (
                          <label key={opt} className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="attendedBefore"
                              className="accent-primary"
                              checked={survey.attendedBefore === opt}
                              onChange={() => setSurvey({ ...survey, attendedBefore: opt })}
                            />
                            {opt}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Scale & Profit Shirt Size
                      </Label>
                      <div className="flex flex-col gap-2">
                        {SHIRT_SIZES.map((size) => (
                          <label key={size} className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name="shirtSize"
                              className="accent-primary"
                              checked={survey.shirtSize === size}
                              onChange={() => setSurvey({ ...survey, shirtSize: size })}
                            />
                            {size}
                          </label>
                        ))}
                      </div>
                    </div>

                    {surveyError && <p className="text-xs text-destructive">{surveyError}</p>}
                    <Button type="button" className="w-full" onClick={goToPaymentFromSurvey}>
                      Continue to Payment
                    </Button>
                  </>
                )}

                {step === 2 && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold">Complete Your Payment</h3>
                        <p className="text-sm text-muted-foreground">
                          Enter your details and pay securely below to confirm your seat.
                        </p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => setStep(1)}>
                        Back
                      </Button>
                    </div>
                    <div className="overflow-hidden rounded-lg bg-white">
                      <iframe
                        src={paymentSrc}
                        id={`inline-${paymentFormId}`}
                        title="Secure Payment"
                        data-layout='{"id":"INLINE"}'
                        data-form-id={paymentFormId}
                        data-layout-iframe-id={`inline-${paymentFormId}`}
                        className="w-full"
                        style={{ minHeight: 720, border: "none" }}
                      />
                    </div>
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
                  $
                  {(isVip
                    ? (live.vip ?? 1600)
                    : (gaOptions.find((g) => g.qty === 1)?.price ?? gaOptions[0].price)
                  ).toLocaleString()}
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

