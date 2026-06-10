# GHL Automation Handoff — Scale & Profit Checkout

This is what the site sends into GHL and what the automation builder can hook into.
Location ID: `mVdYbXfJcF10Y7anuoNt`

## Flow recap

1. **Step 1 (site form):** buyer fills Your Info → A Few Questions. On "Continue to
   Payment" the site **upserts the buyer contact** (fields + tags below) and creates
   an opportunity — *before* payment.
2. **Step 2 (embedded GHL form):** the real charge happens inside the GHL payment
   form. This is where GHL's native **purchase / payment** triggers fire.

---

## 1. Contact custom fields to create/confirm in GHL

The site writes these to the buyer contact by **field key**. Create a custom field
for each (any field type, but match the key):

| Key | Example value | Notes |
|-----|---------------|-------|
| `event_city` | `boston` | Which event (city slug) — primary identifier |
| `ticket_tier` | `VIP` / `General Admission` | |
| `order_amount` | `997` | Indicative amount from the site |
| `do_you_have_a_moa_1` | `Yes` / `No` | Survey answer — "Do you have a MOA?" |
| `have_you_attended_a_scale__profit_seminar_before_1` | free text | Survey answer — "Attended before?" |
| `scale__profit_shirt_size` | `Large` | Survey answer — shirt size |

> **Agency state** is written to GHL's **native contact State field**
> (`{{contact.state}}`) — it is *not* a custom field. No custom field needed for it.
>
> The three survey custom-field keys above must match **exactly** (they're the part
> after `contact.` in the merge tag, e.g. `{{contact.do_you_have_a_moa_1}}`).
>
> **Ticket count** is tracked on the **opportunity**, not the contact — see §3 and §6.

## 2. Tags applied to the buyer contact

- `scale-profit-seminar`
- `scale-profit-{city}` (e.g. `scale-profit-boston`)
- `scale-profit-{tier}` (`scale-profit-ga` / `scale-profit-vip`)
- `scale-profit-{city}-{tier}` (e.g. `scale-profit-boston-vip`)

Contact **source**: `Scale & Profit Seminar Checkout`

## 3. Opportunity created (Step 1)

- Created in the **first pipeline / first stage** in the location.
- Name: `First Last — {tier} ({city})`
- `monetaryValue` = order amount, status `open`.
- Opportunity custom field **`sp_no_of_ticket_purchased`**
  (`{{opportunity.sp_no_of_ticket_purchased}}`) is set to the ticket count.

> ⚠️ **Ticket count = 1 at creation.** The site creates the opportunity *before*
> payment, where the real quantity isn't known yet, so it writes `1`. The real
> count is chosen inside the GHL payment form — your automation must **overwrite
> `{{opportunity.sp_no_of_ticket_purchased}}` with the real quantity** after the
> charge (see §6). The site's admin "Attendees" view reads whatever this field holds.

## 4. Embedded payment forms (Step 2)

| Tier | Form URL |
|------|----------|
| GA | `https://go.aiaimastermind.com/widget/form/EB8ObhaPz6Fw2Fq6urY0` |
| VIP | `https://go.aiaimastermind.com/widget/form/VaXtddWW607K6i0P30d8` |

The site appends these as **URL query params** for prefill / capture. To record them
on the order, add form fields whose **query key** matches:

`event_city`, `event_name`, `event_date`, `ticket_tier`,
`first_name`, `last_name`, `email`, `phone`

(`first_name`/`last_name`/`email`/`phone` are native and usually prefill on their own.
The one that matters for tracking is **`event_city`** — add it as a hidden field.)

## 5. Recommended automation triggers

| Goal | Trigger |
|------|---------|
| Fire on actual purchase | **Order Submitted / Payment Received** (from the GHL payment form) |
| Fire when a lead reaches checkout (pre-payment) | **Contact Tag added** = `scale-profit-seminar`, or **Contact Created/Updated** with source `Scale & Profit Seminar Checkout` |
| Branch by event | Filter on `event_city` custom field (or the `scale-profit-{city}` tag) |
| Branch by tier | Filter on `ticket_tier` (or `scale-profit-vip` / `scale-profit-ga` tag) |

---

## 6. Tracking ticket quantity (multiple tickets) + the loop page

**Important:** quantity is chosen **inside the GHL payment form**, not on the site.
The real count must be written into the **opportunity** field
`sp_no_of_ticket_purchased` (`{{opportunity.sp_no_of_ticket_purchased}}`). The site
seeds this field with `1` when it creates the opportunity pre-payment; your
automation overwrites it with the real number.

**Set it up:** add a "Number of Tickets" selector (dropdown 1–5, or the product
quantity field) to each payment form, then in the **post-payment automation** map
that value onto the buyer's opportunity field `sp_no_of_ticket_purchased`. Now
`{{opportunity.sp_no_of_ticket_purchased}}` holds the true per-buyer count, and the
site's admin "Attendees" view displays it.

### Driving the post-purchase "loop" confirmation page

**Goal:** each ticket becomes its own **attendee record** (a separate GHL contact).

1. In the payment form's **On-Submit redirect**, send the buyer to the confirmation
   page (`/confirmation`) with the count + identity, e.g.
   `https://<site>/confirmation?qty={{opportunity.sp_no_of_ticket_purchased}}&city={{contact.event_city}}&tier=vip&email={{contact.email}}&first_name={{contact.first_name}}&last_name={{contact.last_name}}`
2. The page reads `qty` and **renders one attendee form per ticket** (it scales
   automatically). Attendee #1 is **pre-filled** with the buyer's name + email so they
   can confirm they're attending (or edit it).
3. On submit, the page saves **each ticket as its own contact** in GHL, tagged
   `scale-profit-attendee` + the event tags. So N tickets → N attendee records.

   Params accepted: `qty`, `city`, `tier`, `email`, `first_name`/`firstName`,
   `last_name`/`lastName`.

> The site previously had a "Who's Attending?" step that created attendee contacts
> exactly this way; it was removed so attendees can be collected post-purchase with
> the correct count.

---

## What YOU provide to the automation builder

- ✅ Confirm/create the **custom fields** in §1.
- ✅ Add the **hidden `event_city` field** (and any others you want recorded) to both
  payment forms — §4.
- ✅ Add a **"Number of Tickets" selector** to each payment form and, in the
  post-payment automation, map it to the **opportunity** field
  `sp_no_of_ticket_purchased` — §6.
- ✅ Provide the **confirmation/loop page URL** once built, and set it as the form's
  on-submit redirect — §6.
- ✅ Confirm the **products & prices** are the two "ACTIVE" products the site reads.
