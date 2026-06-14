import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Check, Calendar, MapPin, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listEvents } from "@/lib/events.functions";
import { getTodayISO, splitEvents, type EventRow } from "@/lib/events";
import { loadStoredEvents } from "@/lib/events.store";
import logo from "@/assets/hero-banner.webp";
import coachesHero from "@/assets/hero-coaches.jpg";
import davidImg from "@/assets/david-peterson.webp";
import alexImg from "@/assets/alex-shattuck.webp";
import toolkitSystems from "@/assets/toolkit-systems.webp";
import toolkitTeams from "@/assets/toolkit-teams.webp";
import toolkitTime from "@/assets/toolkit-time.webp";
import toolkitProfit from "@/assets/toolkit-profit.webp";
import sponsorAgero from "@/assets/sponsor.webp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scale & Profit Seminar — Grow Your Agency" },
      {
        name: "description",
        content:
          "Join David Peterson & Alex Shattuck for the Scale & Profit Seminar. Get the blueprint for more profit, better teams, and real freedom.",
      },
      { property: "og:title", content: "Scale & Profit Seminar" },
      {
        property: "og:description",
        content: "Two immersive days of frameworks to scale your agency.",
      },
    ],
  }),
  loader: async () => ({ events: await listEvents() }),
  component: Index,
});

const painPoints = [
  "Trapped in the daily grind, feeling more like a high-paid employee than an owner?",
  "Overwhelmed by admin tasks that steal your highest-value time?",
  "Drowning in daily urgencies with no space for strategic growth?",
  "Unsure how to adapt to industry changes and stay ahead?",
  "Constantly putting out fires instead of building the future?",
  "Onboarding feels chaotic, leaving new hires unprepared?",
  "Your team looks busy, but are they truly effective and aligned?",
  "Growth stalls because you lack repeatable systems?",
  "Feel like you're carrying the entire business on your shoulders?",
  "Work draining your energy, impacting your health and relationships?",
  "You know you're capable of more but feel stuck?",
  "Frustrated doing $15/hour tasks when your time is worth $250+/hour?",
];

const toolkit = [
  {
    icon: toolkitSystems,
    title: "Proven Systems that Scale & Free Your Time",
    body: "Learn the exact operational frameworks David & Al use to run multiple high-performing teams. Repeatable, actionable systems designed to get tasks off your plate.",
  },
  {
    icon: toolkitTeams,
    title: "High-Performing Teams Built on Culture",
    body: "Master recruiting, onboarding, and leadership strategies that attract A-players and forge a culture people want to be part of.",
  },
  {
    icon: toolkitTime,
    title: "Reclaim Your CEO Time",
    body: "Identify your true hourly value and ruthlessly delegate tasks below it. Escape the daily grind and focus on visionary, high-ROI activities.",
  },
  {
    icon: toolkitProfit,
    title: "Real Profit Growth & Financial Clarity",
    body: "Brutally honest insights into structuring for profitability, managing cash flow, and making marketing a predictable profit engine.",
  },
];

const day1 = [
  ["8:00 AM", "Registration"],
  ["9:00 AM", "The Future of Insurance — Where it's heading & how to prepare"],
  ["10:00 AM", "Recruiting Pipeline — Keep your pipeline full with top talent"],
  ["10:50 AM", "Break"],
  ["11:05 AM", "Onboarding Machine — Scalable ways to get new hires productive fast"],
  ["11:50 AM", "The Unshakeable Office Culture"],
  ["12:30 PM", "Lunch"],
  ["1:15 PM", "Sponsor Spotlights"],
  ["1:45 PM", "Culture of Accountability"],
  ["2:45 PM", "Break"],
  ["3:00 PM", "Managing Remote Teams"],
  ["4:00 PM", "Plays, Recap, Final Q&A"],
  ["5:00 PM", "Networking Cocktail Hour"],
  ["7:00 PM", "VIP Dinner"],
];

const day2 = [
  ["8:00 AM", "Welcome"],
  ["9:00 AM", "Marketing That Works — What we spend, where, why, and the ROI obsession"],
  ["10:00 AM", "Profit Levers — Real talk on making & keeping more money"],
  ["10:45 AM", "Break"],
  ["11:00 AM", "CEO Time Management — Ruthless prioritization & delegation"],
  ["12:00 PM", "Lunch"],
  ["12:30 PM", "Scalable Structure — The org chart that drives growth"],
  ["1:30 PM", "MOA Ready — Preparing for what's next"],
  ["2:30 PM", "Final Q&A and Day 2 Recap — Action Planning"],
  ["3:00 PM", "Event Ends"],
];

const tiers = [
  {
    name: "General Admission",
    price: "$997",
    perks: [
      "Full access to both days of the Scale & Profit Seminar",
      "Proven frameworks, strategies, tips & tricks from David & Al",
      "Q&A sessions with top-performing agency owners",
      "Networking with high-performing agents via cocktail hour",
    ],
  },
  {
    name: "VIP Experience",
    price: "$1,600",
    note: "Limited Seats Available",
    perks: [
      "Everything in General Admission, plus:",
      "Exclusive VIP dinner with David & Al",
      "Preferred seating in the seminar room",
      "Exclusive curated swag bag",
      "VIP name badge",
      "90-minute exclusive implementation call",
    ],
    featured: true,
  },
];

function Section({
  children,
  className = "",
  id,
  tone = "dark",
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  tone?: "dark" | "light";
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-24 px-6 py-20 md:py-28 ${tone === "light" ? "bg-card/40" : ""} ${className}`}
    >
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function scrollToOffers() {
  document.getElementById("offers")?.scrollIntoView({ behavior: "smooth" });
}

function Index() {
  const { events: loaderEvents } = Route.useLoaderData();
  const [allEvents, setAllEvents] = useState(loaderEvents);
  const [openEvent, setOpenEvent] = useState<number | null>(0);
  // Pick up this browser's admin edits (localStorage) after hydration.
  useEffect(() => {
    setAllEvents(loadStoredEvents(loaderEvents));
  }, [loaderEvents]);
  // When an event is expanded (via user click), scroll its ticket tiers into view.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    if (openEvent === null) return;
    document
      .getElementById("event-tiers-panel")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [openEvent]);
  // Show only upcoming events (soonest first); fall back to all if none are upcoming.
  const { upcoming } = splitEvents(allEvents, getTodayISO());
  const events = upcoming.length > 0 ? upcoming : allEvents;
  const featured = events[0];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <img
              src={logo}
              alt="Scale & Profit"
              className="h-10 w-auto"
            />
          </Link>
          <Button onClick={scrollToOffers}>Sign up Now!</Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${coachesHero})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/90 via-background/80 to-background" />
        <div className="relative mx-auto max-w-4xl px-6 py-24 text-center md:py-32">
          <img
            src={logo}
            alt="Scale & Profit"
            width={520}
            height={433}
            className="mx-auto mb-8 h-40 w-auto md:h-56"
          />
          <p className="text-sm uppercase tracking-[0.3em] text-primary">
            Join David Peterson & Alex Shattuck at
          </p>
          <h1 className="mt-4 text-5xl font-black tracking-tight md:text-7xl">
            SCALE & PROFIT SEMINAR
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            Get the blueprint for More Profit, Better Teams, and Real Freedom.
          </p>
          <Button size="lg" className="mt-8 px-10 py-6 text-base" onClick={scrollToOffers}>
            Sign up Today!
          </Button>
        </div>
      </section>

      {/* Three pillars */}
      <Section tone="light" className="border-y border-border">
        <div className="grid gap-8 md:grid-cols-3">
          {[
            ["Maximize Profit", "Understand & control the levers of true, sustainable profitability."],
            ["A-Player Culture", "Attract, develop, and retain top talent that drives results."],
            ["Own Your Freedom", "Design systems that liberate your time and run effectively without you."],
          ].map(([t, d]) => (
            <div key={t} className="text-center">
              <h3 className="text-2xl font-bold text-primary">{t}</h3>
              <p className="mt-3 text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Pain points */}
      <Section>
        <h2 className="text-center text-3xl font-bold md:text-5xl">
          Does This Sound Familiar? <span className="text-primary">You're Not Alone.</span>
        </h2>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {painPoints.map((p) => (
            <Card key={p} className="border-border bg-card p-5">
              <p className="text-card-foreground">{p}</p>
            </Card>
          ))}
        </div>
        <div className="mt-12 text-center">
          <p className="mx-auto max-w-3xl text-xl font-semibold md:text-2xl">
            Stop trying to navigate scaling your agency alone.{" "}
            <span className="text-primary">There's a smarter way.</span>
          </p>
          <Button size="lg" className="mt-6" onClick={scrollToOffers}>
            Get Your Ticket!
          </Button>
        </div>
      </Section>

      {/* Coaches */}
      <Section tone="light">
        <h2 className="text-center text-3xl font-bold md:text-5xl">
          Your Coaches: From the Trenches to the Top
        </h2>
        <p className="mx-auto mt-4 max-w-3xl text-center text-muted-foreground">
          Learn the systems David Peterson and Alex Shattuck use to scale multiple agencies
          profitably. Pure, actionable strategy focused on building high-performance teams,
          maximizing your bottom line, and reclaiming your time.
        </p>

        <div className="mt-12 grid gap-8 md:grid-cols-2">
          <Card className="p-8">
            <img
              src={davidImg}
              alt="David Peterson (Coach P)"
              className="mb-5 h-48 w-48 rounded-full object-cover"
            />
            <h3 className="text-2xl font-bold">David Peterson (Coach P)</h3>
            <p className="mt-1 italic text-primary">Systems & Team Building Expert</p>
            <p className="mt-4 text-muted-foreground">
              Father of four, founder of Coach P, and owner of 3 thriving agencies in
              Dallas/Fort Worth. David built his insurance business organically, without debt,
              by focusing on value, delegation, and empowering his people.
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              {[
                "3-Office Agent in Dallas/Fort Worth",
                "State Farm Trophy Winner (#5 Multiline Agent)",
                "President's Club: Auto, Fire, Life, Health, Multiline",
                "Exotic Plus (Legacy) / Exotic (MOA)",
                "Million Dollar Round Table — Court of the Table",
                "Chairman's Circle (Legacy & MOA)",
                "Led team to 1,100 Life Apps and 1,000 Health Apps in 2024",
              ].map((a) => (
                <li key={a} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-8">
            <img
              src={alexImg}
              alt="Alex Shattuck"
              className="mb-5 h-48 w-48 rounded-full object-cover"
            />
            <h3 className="text-2xl font-bold">Alex Shattuck</h3>
            <p className="mt-1 italic text-primary">Autopilot Recruiting</p>
            <p className="mt-4 text-muted-foreground">
              Alex launched his first office in Owosso, MI in 2012, his New Market MOA in
              DeWitt in 2018, and a third office in Rockford in 2022. A USMC veteran and
              best-selling author of "Complacency Kills" and "Small Business, BIG RECRUITING."
            </p>
            <ul className="mt-5 space-y-2 text-sm">
              {[
                "Ambassador Club & Lifetime President's Club",
                "Chairman's Circle, SVP Club & Honor Club",
                "Never missed travel in either office",
                "MDRT qualifier",
                "Best-selling author (3 books)",
                "Founder of Autopilot Recruiting",
                "U.S. Marine Corps Infantry — Fallujah, Iraq",
              ].map((a) => (
                <li key={a} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <p className="mx-auto mt-10 max-w-3xl text-center text-muted-foreground">
          Together, David and Alex offer a powerful blend of strategic systems, relentless
          execution, and real-world experience in building profitable, scalable agencies.
        </p>
        <div className="mt-8 text-center">
          <Button size="lg" onClick={scrollToOffers}>
            Sign Me Up!
          </Button>
        </div>
      </Section>

      {/* Imagine */}
      <Section>
        <h2 className="text-center text-3xl font-bold md:text-5xl">
          Imagine Your Agency Transformed
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {[
            "Attracting and keeping top talent because you've built a destination culture.",
            "Getting out of the weeds for good, reclaiming your time for visionary work.",
            "Turning operational chaos into predictable, repeatable, scalable systems.",
            "Leading a team fueled by accountability, ownership, and high performance.",
            "Making strategic decisions with clarity and confidence as a true CEO.",
            "Increasing profits significantly without working yourself into the ground.",
            "Finally having the freedom you envisioned when you started.",
          ].map((t) => (
            <div key={t} className="flex gap-3 rounded-lg border border-border bg-card p-5">
              <Check className="mt-1 h-5 w-5 shrink-0 text-primary" />
              <p>{t}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Toolkit */}
      <Section tone="light">
        <h2 className="text-center text-3xl font-bold md:text-5xl">
          What You'll Walk Away With — The CEO Toolkit
        </h2>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {toolkit.map((t) => (
            <Card key={t.title} className="p-8">
              <img src={t.icon} alt="" className="h-14 w-14 object-contain" />
              <h3 className="mt-4 text-xl font-bold">{t.title}</h3>
              <p className="mt-3 text-muted-foreground">{t.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* Event details + agenda */}
      <Section>
        <h2 className="text-center text-3xl font-bold md:text-5xl">Event Details</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <Card className="p-5">
            <MapPin className="h-5 w-5 text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Location</p>
            <p className="font-semibold">{featured.venue}</p>
          </Card>
          <Card className="p-5">
            <Calendar className="h-5 w-5 text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Dates</p>
            <p className="font-semibold">{featured.date}</p>
          </Card>
          <Card className="p-5">
            <Clock className="h-5 w-5 text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Time</p>
            <p className="font-semibold">{featured.time}</p>
          </Card>
          <Card className="p-5">
            <Sparkles className="h-5 w-5 text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Extras</p>
            <p className="font-semibold">
              {featured.details || "Networking Cocktail Hour Day 1"}
            </p>
          </Card>
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-2">
          <div>
            <h3 className="text-2xl font-bold">Day 1: Building the Engine</h3>
            <ul className="mt-5 divide-y divide-border rounded-lg border border-border bg-card">
              {day1.map(([t, d]) => (
                <li key={t} className="flex gap-4 px-5 py-3">
                  <span className="w-24 shrink-0 font-semibold text-primary">{t}</span>
                  <span className="text-sm">{d}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-2xl font-bold">Day 2: Maximizing Output & Profit</h3>
            <ul className="mt-5 divide-y divide-border rounded-lg border border-border bg-card">
              {day2.map(([t, d]) => (
                <li key={t} className="flex gap-4 px-5 py-3">
                  <span className="w-24 shrink-0 font-semibold text-primary">{t}</span>
                  <span className="text-sm">{d}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* Events / tickets */}
      <Section id="offers" tone="light">
        <h2 className="text-center text-3xl font-bold md:text-5xl">
          Choose Your Scale & Profit Experience
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
          Both options deliver the blueprint to scale smarter, lead with confidence, and build a
          business that gives you freedom.
        </p>

        {(() => {
          const slots: (EventRow | null)[] = events.slice(0, 4);
          while (slots.length < 4) slots.push(null);
          return (
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {slots.map((e, i) =>
                e ? (
                  <Card key={e.slug} className="flex flex-col p-6">
                    <h3 className="text-2xl font-bold">{e.city}</h3>
                    <p className="mt-1 text-primary">{e.date}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {e.venue}
                      {e.address ? ` — ${e.address}` : ""}
                    </p>
                    <Button
                      className="mt-auto w-full"
                      onClick={() => setOpenEvent(openEvent === i ? null : i)}
                      aria-expanded={openEvent === i}
                      aria-controls="event-tiers-panel"
                    >
                      {openEvent === i ? "Hide Tickets" : "View Tickets"}
                    </Button>
                  </Card>
                ) : (
                  <Card
                    key={`tbd-${i}`}
                    className="flex flex-col border-dashed p-6 opacity-80"
                  >
                    <h3 className="text-2xl font-bold text-muted-foreground">TBD</h3>
                    <p className="mt-1 text-sm uppercase tracking-[0.2em] text-primary">
                      Coming Soon
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      New city announcement on the way.
                    </p>
                    <Button className="mt-auto w-full" variant="outline" disabled>
                      Coming Soon
                    </Button>
                  </Card>
                ),
              )}
            </div>
          );
        })()}

        <div
          id="event-tiers-panel"
          className={`grid transition-all duration-500 ease-out ${
            openEvent !== null && events[openEvent]
              ? "mt-8 grid-rows-[1fr] opacity-100"
              : "mt-0 grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            {openEvent !== null && events[openEvent] && (
              <div
                key={events[openEvent]!.slug}
                className="animate-fade-in rounded-xl border border-border bg-background/40 p-6"
              >
                <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Selected event
                    </p>
                    <h3 className="text-2xl font-bold">
                      {events[openEvent]!.city}{" "}
                      <span className="text-base font-normal text-primary">
                        · {events[openEvent]!.date}
                      </span>
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {events[openEvent]!.venue}
                  </p>
                </div>
                <div className="grid gap-6 md:grid-cols-2">
                  {tiers.map((tier) => (
                    <Card
                      key={tier.name}
                      className={`flex h-full flex-col p-6 ${tier.featured ? "border-primary" : ""}`}
                    >
                      <h4 className="text-xl font-bold">
                        {tier.name}{" "}
                        <span className="text-base font-normal text-muted-foreground">
                          — {events[openEvent]!.city}
                        </span>
                      </h4>
                      <p className="mt-2 text-3xl font-black text-primary">{tier.price}</p>
                      {tier.note && (
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {tier.note}
                        </p>
                      )}
                      <ul className="mt-4 flex-1 space-y-2 text-sm">
                        {tier.perks.map((p) => (
                          <li key={p} className="flex gap-2">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                      <Button asChild className="mt-6 w-full">
                        <Link
                          to="/checkout"
                          search={{
                            city: events[openEvent]!.slug,
                            tier: tier.featured ? "vip" : "ga",
                          }}
                        >
                          Sign Up Now!
                        </Link>
                      </Button>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* Game plan */}
      <Section>
        <h2 className="text-center text-3xl font-bold md:text-5xl">
          The Scale & Profit Game Plan
        </h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            ["1", "Attend the Seminar", "Register and join us at our upcoming seminar."],
            [
              "2",
              "Implement Our Proven Systems",
              "Apply tested methods for recruiting, onboarding, culture, marketing, accountability, structure, and profit.",
            ],
            [
              "3",
              "Scale Confidently & Lead Like a CEO",
              "Build a profitable, sustainable agency that gives you freedom.",
            ],
          ].map(([n, t, d]) => (
            <Card key={n} className="p-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-black text-primary-foreground">
                {n}
              </div>
              <h3 className="mt-5 text-xl font-bold">{t}</h3>
              <p className="mt-3 text-muted-foreground">{d}</p>
            </Card>
          ))}
        </div>
        <div className="mt-12 text-center">
          <Button size="lg" onClick={scrollToOffers}>
            Get Your Ticket
          </Button>
        </div>
      </Section>

      {/* Sponsors */}
      <Section tone="light">
        <h2 className="text-center text-3xl font-bold md:text-5xl">
          Thank You For Being a Scale & Profit Sponsor
        </h2>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-12">
          <img
            src={sponsorAgero}
            alt="Agero"
            className="h-16 w-auto object-contain"
          />
        </div>
      </Section>

      {/* Closing CTA */}
      <Section>
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold md:text-5xl">
            You Deserve a Business That Works for You
          </h2>
          <p className="mt-6 text-muted-foreground">
            You want to grow your business, lead your team with confidence, and increase
            profits — while still having time and energy for what matters most. You need clear
            systems, a dependable team, and a strategy that makes growing predictable.
          </p>
          <p className="mt-4 text-muted-foreground">
            That's why we created the Scale & Profit Seminar — two days of hands-on learning
            where we share the exact frameworks, strategies, and tools we've used to build
            multiple high-performing agencies.
          </p>
          <Button size="lg" className="mt-8" onClick={scrollToOffers}>
            Reserve Your Seat
          </Button>
        </div>
      </Section>

      <footer className="border-t border-border px-6 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 text-center">
          <img src={logo} alt="Scale & Profit" className="h-16 w-auto" />
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <a href="#" className="hover:text-foreground">Terms &amp; Conditions</a>
            <a href="#" className="hover:text-foreground">Privacy Policy</a>
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Scale &amp; Profit. All rights reserved.
          </p>
          <p className="mx-auto max-w-3xl text-xs text-muted-foreground">
            This event is not affiliated with, endorsed by, or sponsored by State Farm. The views
            and opinions expressed are those of the presenters and do not necessarily reflect those
            of State Farm or its affiliates.
          </p>
        </div>
      </footer>
    </div>
  );
}
