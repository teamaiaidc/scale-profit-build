import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Calendar, MapPin, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import heroImg from "@/assets/coaches-hero.jpg";

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
    title: "Proven Systems that Scale & Free Your Time",
    body: "Learn the exact operational frameworks David & Al use to run multiple high-performing teams. Repeatable, actionable systems designed to get tasks off your plate.",
  },
  {
    title: "High-Performing Teams Built on Culture",
    body: "Master recruiting, onboarding, and leadership strategies that attract A-players and forge a culture people want to be part of.",
  },
  {
    title: "Reclaim Your CEO Time",
    body: "Identify your true hourly value and ruthlessly delegate tasks below it. Escape the daily grind and focus on visionary, high-ROI activities.",
  },
  {
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

const events = [
  {
    city: "Boston",
    date: "June 2nd & 3rd, 2026",
    venue: "Aloft Boston Seaport District",
    address: "401-403 D Street, Boston, MA 02210",
  },
  {
    city: "Nashville",
    date: "August 5th–6th, 2026",
    venue: "W Nashville Hotel",
    address: "300 12th Ave S, Nashville, TN 37203",
  },
  {
    city: "California",
    date: "December 8th–9th, 2026",
    venue: "Venue TBA",
    address: "California",
  },
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
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`px-6 py-20 md:py-28 ${className}`}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

function Index() {
  const [openEvent, setOpenEvent] = useState<number | null>(0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-bold tracking-wide">
            <Sparkles className="h-5 w-5 text-primary" />
            <span>SCALE & PROFIT</span>
          </div>
          <Button>Sign up Now!</Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <img
          src={heroImg}
          alt="David Peterson and Alex Shattuck"
          width={1600}
          height={1024}
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/60 to-background" />
        <div className="relative mx-auto max-w-4xl px-6 py-32 text-center md:py-44">
          <p className="text-sm uppercase tracking-[0.3em] text-primary">
            Join David Peterson & Alex Shattuck at
          </p>
          <h1 className="mt-4 text-5xl font-black tracking-tight md:text-7xl">
            SCALE & PROFIT SEMINAR
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            Get the blueprint for More Profit, Better Teams, and Real Freedom.
          </p>
          <Button size="lg" className="mt-8 px-10 py-6 text-base">
            Sign up Today!
          </Button>
        </div>
      </section>

      {/* Three pillars */}
      <Section className="border-y border-border">
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
          <Button size="lg" className="mt-6">
            Get Your Ticket!
          </Button>
        </div>
      </Section>

      {/* Coaches */}
      <Section className="bg-card/40">
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
          <Button size="lg">Sign Me Up!</Button>
        </div>
      </Section>

      {/* Imagine */}
      <Section>
        <h2 className="text-3xl font-bold md:text-5xl">Imagine Your Agency Transformed</h2>
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
      <Section className="bg-card/40">
        <h2 className="text-center text-3xl font-bold md:text-5xl">
          What You'll Walk Away With — The CEO Toolkit
        </h2>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {toolkit.map((t) => (
            <Card key={t.title} className="p-8">
              <Sparkles className="h-7 w-7 text-primary" />
              <h3 className="mt-4 text-xl font-bold">{t.title}</h3>
              <p className="mt-3 text-muted-foreground">{t.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* Event details + agenda */}
      <Section>
        <h2 className="text-3xl font-bold md:text-5xl">Event Details</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <Card className="p-5">
            <MapPin className="h-5 w-5 text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Location</p>
            <p className="font-semibold">Aloft Boston Seaport District</p>
          </Card>
          <Card className="p-5">
            <Calendar className="h-5 w-5 text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Dates</p>
            <p className="font-semibold">June 2nd & 3rd, 2026</p>
          </Card>
          <Card className="p-5">
            <Clock className="h-5 w-5 text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Time</p>
            <p className="font-semibold">9:00 AM – 4:00 PM</p>
          </Card>
          <Card className="p-5">
            <Sparkles className="h-5 w-5 text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Extras</p>
            <p className="font-semibold">Networking Cocktail Hour Day 1</p>
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
      <Section className="bg-card/40">
        <h2 className="text-center text-3xl font-bold md:text-5xl">
          Choose Your Scale & Profit Experience
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
          Both options deliver the blueprint to scale smarter, lead with confidence, and build a
          business that gives you freedom.
        </p>

        <div className="mt-10 space-y-4">
          {events.map((e, i) => (
            <Card key={e.city} className="overflow-hidden">
              <button
                onClick={() => setOpenEvent(openEvent === i ? null : i)}
                className="flex w-full items-center justify-between gap-4 p-6 text-left transition-colors hover:bg-muted/40"
              >
                <div>
                  <h3 className="text-2xl font-bold">{e.city}</h3>
                  <p className="text-primary">{e.date}</p>
                  <p className="text-sm text-muted-foreground">
                    {e.venue} — {e.address}
                  </p>
                </div>
                <span className="text-2xl text-primary">{openEvent === i ? "−" : "+"}</span>
              </button>

              {openEvent === i && (
                <div className="grid gap-6 border-t border-border bg-background/40 p-6 md:grid-cols-2">
                  {tiers.map((tier) => (
                    <Card
                      key={tier.name}
                      className={`p-6 ${tier.featured ? "border-primary" : ""}`}
                    >
                      <h4 className="text-xl font-bold">{tier.name}</h4>
                      <p className="mt-2 text-3xl font-black text-primary">{tier.price}</p>
                      {tier.note && (
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {tier.note}
                        </p>
                      )}
                      <ul className="mt-4 space-y-2 text-sm">
                        {tier.perks.map((p) => (
                          <li key={p} className="flex gap-2">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <span>{p}</span>
                          </li>
                        ))}
                      </ul>
                      <Button className="mt-6 w-full">Sign Up Now!</Button>
                    </Card>
                  ))}
                </div>
              )}
            </Card>
          ))}
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
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-2xl font-black text-primary-foreground">
                {n}
              </div>
              <h3 className="mt-5 text-xl font-bold">{t}</h3>
              <p className="mt-3 text-muted-foreground">{d}</p>
            </Card>
          ))}
        </div>
        <div className="mt-12 text-center">
          <Button size="lg">Get Your Ticket</Button>
        </div>
      </Section>

      {/* Closing CTA */}
      <Section className="bg-card/40">
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
          <Button size="lg" className="mt-8">
            Reserve Your Seat
          </Button>
        </div>
      </Section>

      <footer className="border-t border-border px-6 py-10 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Scale & Profit Seminar. All rights reserved.
      </footer>
    </div>
  );
}
