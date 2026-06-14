import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { getGhlTicketQuantityByEmail } from "@/lib/ghl.functions";
import { normalizeCity } from "@/lib/city";
import logo from "@/assets/hero-banner.webp";

type Search = {
  city?: string;
  tier?: "ga" | "vip";
  qty?: number;
  email?: string;
  firstName?: string;
  lastName?: string;
  endDate?: string;
};

const BUFFER_INITIAL_DELAY_MS = 15000;
const BUFFER_INTERVAL_MS = 5000;
const BUFFER_MAX_WAIT_MS = 75000;

const isMergeTag = (value?: string) => !value || /{{|}}/.test(value);
const clean = (value: unknown) =>
  typeof value === "string" && value.trim() && !isMergeTag(value) ? value.trim() : undefined;
const parseTicketQty = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || isMergeTag(value)) return 1;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : 1;
};
const clampTicketQty = (value: number) => Math.min(Math.max(Math.trunc(value), 1), 20);

export const Route = createFileRoute("/confirmation-buffer")({
  validateSearch: (s: Record<string, unknown>): Search => {
    const str = (a: unknown, b: unknown) => clean(a) ?? clean(b);
    const ticketValue =
      s.qty ??
      s.sp_no_of_ticket_purchased ??
      s["contact.sp_no_of_ticket_purchased"] ??
      s.ticket_quantity;

    return {
      city: normalizeCity(s.event_city) ?? normalizeCity(s.eventCity) ?? normalizeCity(s.city) ?? "boston",
      tier: s.tier === "vip" ? "vip" : "ga",
      qty: clampTicketQty(parseTicketQty(ticketValue)),
      email: clean(s.email),
      firstName: str(s.firstName, s.first_name),
      lastName: str(s.lastName, s.last_name),
      endDate: str(s.endDate, s.end_date),
    };
  },
  head: () => ({
    meta: [{ title: "Finalizing Order — Scale & Profit Seminar" }],
  }),
  component: ConfirmationBufferPage,
});

function ConfirmationBufferPage() {
  const { city, tier = "ga", qty = 1, email, firstName, lastName, endDate } = Route.useSearch();
  const navigate = useNavigate();
  const getTicketQty = useServerFn(getGhlTicketQuantityByEmail);
  const getTicketQtyRef = useRef(getTicketQty);

  useEffect(() => {
    getTicketQtyRef.current = getTicketQty;
  }, [getTicketQty]);

  useEffect(() => {
    let active = true;

    const goToConfirmation = (nextQty: number) => {
      if (!active) return;
      navigate({
        to: "/confirmation",
        replace: true,
        search: {
          city: city ?? "boston",
          tier,
          qty: clampTicketQty(nextQty),
          email,
          firstName,
          lastName,
          endDate,
        },
      });
    };

    if (tier === "vip" || qty > 1 || !email) {
      const timer = setTimeout(() => goToConfirmation(tier === "vip" ? 1 : qty), 500);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }

    const timer = setTimeout(async () => {
      const startedAt = Date.now();
      while (active && Date.now() - startedAt < BUFFER_MAX_WAIT_MS) {
        try {
          const result = await getTicketQtyRef.current({ data: { email } });
          if (result.quantity > 1) {
            goToConfirmation(result.quantity);
            return;
          }
        } catch (err) {
          console.warn("Ticket quantity buffer lookup failed:", err);
        }
        await new Promise((resolve) => setTimeout(resolve, BUFFER_INTERVAL_MS));
      }
      goToConfirmation(qty);
    }, BUFFER_INITIAL_DELAY_MS);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [city, tier, qty, email, firstName, lastName, endDate, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <img src={logo} alt="Scale & Profit" className="h-10 w-auto" />
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl px-6 py-16">
        <Card className="w-full p-8 text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
          <h1 className="mt-6 text-3xl font-black">Finalizing your ticket count…</h1>
          <p className="mt-3 text-muted-foreground">
            Hang tight while we confirm your purchased quantity before opening attendee registration.
          </p>
        </Card>
      </main>
    </div>
  );
}