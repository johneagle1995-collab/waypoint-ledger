import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plane, MapPin, CalendarDays, DollarSign, Plus, X, Trash2, Users,
  Briefcase, ChevronDown, ChevronUp, Wallet, Edit2, Check, PlaneTakeoff,
  PlaneLanding, AlertCircle, Loader2, LogOut, Lock, Mail
} from "lucide-react";
import { supabase } from "./supabaseClient";

/* ---------------------------------------------------------------------- */
/*  Design tokens                                                         */
/* ---------------------------------------------------------------------- */
const C = {
  bg: "#141C29",
  bgAlt: "#1C2739",
  bgAlt2: "#22304A",
  paper: "#EFE7D6",
  paperAlt: "#E4D8B9",
  ink: "#221D14",
  inkSoft: "#5B5240",
  brass: "#C79A3D",
  brassDim: "#8A6E31",
  coral: "#BE5A3E",
  sage: "#5F8567",
  teal: "#3B6E73",
  cream: "#F4EEDD",
  creamDim: "#B9B097",
};


const CATEGORY_META = {
  Flights: { color: "#3B6E73" },
  Lodging: { color: "#8A6E31" },
  Food: { color: "#5F8567" },
  Transport: { color: "#7A5C7E" },
  Activities: { color: "#BE5A3E" },
  Other: { color: "#5B5240" },
};
const CATEGORIES = Object.keys(CATEGORY_META);

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const fmtMoney = (n, currency = "USD") => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(n) || 0);
  } catch {
    return `$${(Number(n) || 0).toLocaleString()}`;
  }
};
const fmtDays = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? `${v}` : v.toFixed(1);
};

function businessDays(start, end) {
  if (!start || !end) return 0;
  let count = 0;
  let d = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (d <= endD) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// Returns the most recent anniversary date (job.resetMonth/resetDay) that has already passed
function lastAnniversary(job, ref = new Date()) {
  const m = (job.resetMonth || 1) - 1;
  const d = job.resetDay || 1;
  let anniv = new Date(ref.getFullYear(), m, d);
  if (anniv > ref) anniv.setFullYear(anniv.getFullYear() - 1);
  return anniv;
}
function nextAnniversary(job, ref = new Date()) {
  const a = lastAnniversary(job, ref);
  const n = new Date(a);
  n.setFullYear(n.getFullYear() + 1);
  return n;
}
function resetDueThisCycle(member) {
  const job = currentJob(member);
  if (!job || job.policyType !== "fixed") return false;
  const anniv = lastAnniversary(job);
  const hasReset = (member.ledger || []).some((e) => e.note === "Annual reset" && new Date(e.date) >= anniv);
  return !hasReset;
}
function nightsBetween(start, end) {
  if (!start || !end) return 1;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)));
}

function tripStatus(trip) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(trip.startDate + "T00:00:00");
  const end = new Date(trip.endDate + "T00:00:00");
  if (today < start) return "upcoming";
  if (today > end) return "past";
  return "active";
}

function computeBalance(member) {
  return (member.ledger || []).reduce((s, e) => s + e.days, 0);
}

function currentJob(member) {
  const h = member.jobHistory || [];
  return h.length ? h[h.length - 1] : null;
}

/* ---------------------------------------------------------------------- */
/*  Packing intelligence — hidden climate/geography reference + logic     */
/*  (Not shown to the user as a raw list; consulted to build suggestions) */
/* ---------------------------------------------------------------------- */

// Each zone describes typical conditions per SEASON (not calendar quarter),
// since the same calendar months mean very different weather depending on
// hemisphere and climate type.
const ZONE_PROFILES = {
  tropical: {
    winter: { label: "Warm, drier stretch", tags: ["hot", "humid", "sun-strong"] },
    spring: { label: "Warm, rain increasing", tags: ["hot", "humid", "rain"] },
    summer: { label: "Hot & wet season", tags: ["hot", "humid", "rain"] },
    fall: { label: "Warm, rain tapering", tags: ["hot", "humid", "rain"] },
  },
  monsoon: {
    winter: { label: "Dry season", tags: ["hot", "dry", "sun-strong"] },
    spring: { label: "Building heat", tags: ["hot", "dry", "sun-strong"] },
    summer: { label: "Monsoon / wet season", tags: ["hot", "humid", "rain"] },
    fall: { label: "Wet season tapering", tags: ["hot", "humid", "rain"] },
  },
  desert: {
    winter: { label: "Mild days, cold nights", tags: ["mild", "cold-nights", "dry"] },
    spring: { label: "Warm days, cool nights", tags: ["mild", "dry", "windy"] },
    summer: { label: "Very hot, dry", tags: ["hot", "dry", "sun-strong"] },
    fall: { label: "Cooling, dry", tags: ["mild", "dry"] },
  },
  mediterranean: {
    winter: { label: "Mild & rainy", tags: ["mild", "rain"] },
    spring: { label: "Mild, some rain", tags: ["mild", "rain"] },
    summer: { label: "Hot & dry", tags: ["hot", "dry", "sun-strong"] },
    fall: { label: "Mild, rain returning", tags: ["mild", "rain"] },
  },
  oceanic: {
    winter: { label: "Cool & wet", tags: ["cold", "rain", "windy"] },
    spring: { label: "Mild & rainy", tags: ["mild", "rain"] },
    summer: { label: "Mild, occasional rain", tags: ["mild", "rain"] },
    fall: { label: "Cool & wet", tags: ["mild", "rain", "windy"] },
  },
  humid_subtropical: {
    winter: { label: "Mild, occasional cold snap", tags: ["mild", "rain"] },
    spring: { label: "Warming, storms possible", tags: ["mild", "humid", "rain"] },
    summer: { label: "Hot & humid", tags: ["hot", "humid", "sun-strong"] },
    fall: { label: "Warm, drier", tags: ["mild", "humid"] },
  },
  temperate: {
    winter: { label: "Cold", tags: ["cold", "variable"] },
    spring: { label: "Mild, changeable", tags: ["mild", "variable", "rain"] },
    summer: { label: "Warm", tags: ["hot", "sun-strong"] },
    fall: { label: "Cool, changeable", tags: ["mild", "variable", "windy"] },
  },
  continental: {
    winter: { label: "Cold, snow likely", tags: ["cold", "snow"] },
    spring: { label: "Cool, thawing", tags: ["mild", "variable", "rain"] },
    summer: { label: "Warm", tags: ["hot", "sun-strong"] },
    fall: { label: "Cool, crisp", tags: ["mild", "windy"] },
  },
  subarctic: {
    winter: { label: "Very cold, snow", tags: ["cold", "snow", "windy"] },
    spring: { label: "Still cold", tags: ["cold", "variable"] },
    summer: { label: "Cool, short summer", tags: ["mild"] },
    fall: { label: "Cold returning", tags: ["cold", "windy"] },
  },
  highland: {
    winter: { label: "Cold, big day/night swing", tags: ["cold", "variable", "sun-strong"] },
    spring: { label: "Cool, variable", tags: ["mild", "variable"] },
    summer: { label: "Mild days, cold nights", tags: ["mild", "cold-nights", "sun-strong"] },
    fall: { label: "Cool, variable", tags: ["mild", "variable"] },
  },
};

const ZONE_EXTRAS = {
  tropical: ["Insect repellent", "After-bite / anti-itch cream"],
  monsoon: ["Insect repellent", "Quick-dry clothing"],
  desert: ["Extra reusable water bottle", "Electrolyte packets"],
  highland: ["Note: consider altitude adjustment for younger kids or anyone with health concerns"],
  subarctic: ["Hand & toe warmers"],
};

function getSeason(month, hemisphere) {
  // month: 0-11
  const northernMap = { 11: "winter", 0: "winter", 1: "winter", 2: "spring", 3: "spring", 4: "spring", 5: "summer", 6: "summer", 7: "summer", 8: "fall", 9: "fall", 10: "fall" };
  const season = northernMap[month];
  if (hemisphere === "S") {
    const flip = { winter: "summer", summer: "winter", spring: "fall", fall: "spring" };
    return flip[season];
  }
  return season;
}

// US states — all Northern hemisphere, approximate climate zone
const US_STATES = [
  ["Alabama", "humid_subtropical"], ["Alaska", "subarctic"], ["Arizona", "desert"],
  ["Arkansas", "humid_subtropical"], ["California", "mediterranean"], ["Colorado", "highland"],
  ["Connecticut", "temperate"], ["Delaware", "temperate"], ["Florida", "tropical"],
  ["Georgia", "humid_subtropical"], ["Hawaii", "tropical"], ["Idaho", "continental"],
  ["Illinois", "continental"], ["Indiana", "continental"], ["Iowa", "continental"],
  ["Kansas", "continental"], ["Kentucky", "temperate"], ["Louisiana", "humid_subtropical"],
  ["Maine", "continental"], ["Maryland", "temperate"], ["Massachusetts", "temperate"],
  ["Michigan", "continental"], ["Minnesota", "continental"], ["Mississippi", "humid_subtropical"],
  ["Missouri", "continental"], ["Montana", "continental"], ["Nebraska", "continental"],
  ["Nevada", "desert"], ["New Hampshire", "continental"], ["New Jersey", "temperate"],
  ["New Mexico", "desert"], ["New York", "temperate"], ["North Carolina", "humid_subtropical"],
  ["North Dakota", "continental"], ["Ohio", "continental"], ["Oklahoma", "humid_subtropical"],
  ["Oregon", "oceanic"], ["Pennsylvania", "temperate"], ["Rhode Island", "temperate"],
  ["South Carolina", "humid_subtropical"], ["South Dakota", "continental"], ["Tennessee", "humid_subtropical"],
  ["Texas", "humid_subtropical"], ["Utah", "highland"], ["Vermont", "continental"],
  ["Virginia", "temperate"], ["Washington", "oceanic"], ["Washington D.C.", "temperate"],
  ["West Virginia", "temperate"], ["Wisconsin", "continental"], ["Wyoming", "highland"],
];

// Countries — [name, hemisphere, zone]
const COUNTRIES = [
  ["United States", "N", null], // uses US_STATES instead
  ["Canada", "N", "continental"], ["Mexico", "N", "desert"], ["United Kingdom", "N", "oceanic"],
  ["Ireland", "N", "oceanic"], ["France", "N", "temperate"], ["Germany", "N", "temperate"],
  ["Spain", "N", "mediterranean"], ["Portugal", "N", "mediterranean"], ["Italy", "N", "mediterranean"],
  ["Greece", "N", "mediterranean"], ["Netherlands", "N", "oceanic"], ["Belgium", "N", "temperate"],
  ["Switzerland", "N", "highland"], ["Austria", "N", "highland"], ["Norway", "N", "subarctic"],
  ["Sweden", "N", "continental"], ["Finland", "N", "subarctic"], ["Denmark", "N", "oceanic"],
  ["Iceland", "N", "subarctic"], ["Poland", "N", "continental"], ["Czech Republic", "N", "temperate"],
  ["Croatia", "N", "mediterranean"], ["Turkey", "N", "mediterranean"], ["Russia", "N", "continental"],
  ["Japan", "N", "temperate"], ["South Korea", "N", "temperate"], ["China", "N", "continental"],
  ["India", "N", "monsoon"], ["Thailand", "N", "tropical"], ["Vietnam", "N", "monsoon"],
  ["Philippines", "N", "tropical"], ["Indonesia", "S", "tropical"], ["Malaysia", "N", "tropical"],
  ["Singapore", "N", "tropical"], ["United Arab Emirates", "N", "desert"], ["Israel", "N", "mediterranean"],
  ["Egypt", "N", "desert"], ["Morocco", "N", "mediterranean"], ["South Africa", "S", "mediterranean"],
  ["Kenya", "S", "tropical"], ["Nigeria", "N", "tropical"], ["Australia", "S", "desert"],
  ["New Zealand", "S", "oceanic"], ["Fiji", "S", "tropical"], ["Brazil", "S", "tropical"],
  ["Argentina", "S", "temperate"], ["Chile", "S", "mediterranean"], ["Peru", "S", "highland"],
  ["Colombia", "N", "tropical"], ["Costa Rica", "N", "tropical"], ["Jamaica", "N", "tropical"],
  ["Dominican Republic", "N", "tropical"], ["Bahamas", "N", "tropical"], ["Cuba", "N", "tropical"],
  ["Puerto Rico", "N", "tropical"],
];

const TAG_ITEMS = {
  cold: ["Insulated winter coat", "Warm hat & gloves"],
  "cold-nights": ["Warm layer for evenings"],
  snow: ["Waterproof snow boots", "Snow pants (if playing in snow)"],
  mild: ["Light jacket or cardigan"],
  hot: [],
  humid: ["Anti-chafe balm (optional)"],
  dry: ["Lip balm & moisturizer"],
  rain: ["Packable rain jacket", "Compact umbrella"],
  windy: ["Windbreaker"],
  "sun-strong": ["Sunscreen SPF 30+", "Sunglasses", "Sun hat"],
  variable: ["Extra packable layer"],
};

// Turns trip length + weather tags into concrete itemized clothing counts,
// e.g. "5× T-shirts" rather than a vague "pack some outfits."
function computeClothingQuantities(nights, tags) {
  const wearDays = Math.max(1, Math.min(nights + 1, 10)); // cap; longer trips lean on laundry
  const isHot = tags.includes("hot");
  const isCold = tags.includes("cold") || tags.includes("cold-nights") || tags.includes("snow");
  const items = [];
  items.push({ qty: wearDays, item: isHot ? "T-shirts / short-sleeve tops" : isCold ? "Long-sleeve shirts / tops" : "Tops (mix of short & long sleeve)" });
  items.push({ qty: Math.max(2, Math.ceil(wearDays / 2)), item: isHot ? "Shorts" : isCold ? "Pants" : "Pants & shorts (mixed)" });
  items.push({ qty: wearDays, item: "Underwear" });
  items.push({ qty: wearDays, item: "Pairs of socks" });
  items.push({ qty: nights >= 6 ? 2 : 1, item: "Sets of pajamas / sleepwear" });
  if (isCold) items.push({ qty: 2, item: "Sweaters or fleece layers" });
  if (tags.includes("snow")) items.push({ qty: 2, item: "Thermal base-layer sets" });
  return items.map(({ qty, item }) => `${qty}× ${item}`);
}

const OPTIONAL_PATTERN = /\((if needed|optional|if not provided|if required|if playing in snow|if not renting)\)/i;
function isOptionalItem(text) {
  return OPTIONAL_PATTERN.test(text);
}
function stripOptionalNote(text) {
  return text.replace(OPTIONAL_PATTERN, "").trim();
}

function ageInYears(birthDate) {
  if (!birthDate) return null;
  const b = new Date(birthDate + "T00:00:00");
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function ageBucket(member) {
  const age = ageInYears(member.birthDate);
  if (member.type === "kid") {
    if (age === null) return "child";
    if (age < 1) return "infant";
    if (age < 4) return "toddler";
    if (age < 13) return "child";
    return "teen";
  }
  if (age !== null && age >= 65) return "senior";
  return "adult";
}

const AGE_ITEMS = {
  infant: ["Diapers & wipes", "Bottles / formula or feeding supplies", "Baby carrier or travel stroller", "Pacifier / comfort item"],
  toddler: ["Pull-ups or diapers", "Favorite toy or comfort item", "Toddler-friendly snacks", "Extra full outfit changes"],
  child: ["Kid-friendly entertainment (books, tablet)", "Familiar snacks"],
  teen: ["Phone charger", "Headphones / portable battery"],
  adult: [],
  senior: ["Medication organizer & prescriptions", "Comfortable supportive walking shoes", "Reading glasses (if needed)"],
};

// Activities the traveler can pick for a trip — each adds its own personal
// (per-traveler) and shared (once-for-the-family) packing items. Some are
// restricted away from very young age buckets via skipBuckets.
const ACTIVITIES = [
  { key: "Beach & Swimming", personal: ["Beach towel"], shared: ["Beach umbrella or shade tent", "Cooler"] },
  { key: "Hiking & Outdoors", personal: ["Hiking boots or trail shoes", "Moisture-wicking socks", "Daypack"], shared: ["Trail map / offline maps downloaded", "First-aid kit"] },
  { key: "Skiing & Snow Sports", personal: ["Ski/snowboard jacket & pants", "Thermal base layers", "Goggles", "Waterproof gloves"], shared: ["Hand & toe warmers"] },
  { key: "Camping", personal: ["Sleeping bag", "Headlamp or flashlight"], shared: ["Tent", "Camp stove & fuel", "Cooler", "Bug spray"] },
  { key: "Formal Event / Wedding", personal: ["Formal outfit", "Dress shoes"], shared: [], skipBuckets: ["infant", "toddler"] },
  { key: "Business / Work", personal: ["Business attire", "Laptop & charger"], shared: [], skipBuckets: ["infant", "toddler", "child"] },
  { key: "Theme Parks", personal: ["Comfortable walking shoes", "Portable phone battery"], shared: ["Ponchos (for wet rides)"] },
  { key: "Boating & Water Sports", personal: ["Water shoes", "Rash guard"], shared: ["Dry bag", "Life jackets (if not provided)"] },
  { key: "Fishing", personal: ["Hat with brim", "Polarized sunglasses"], shared: ["Fishing gear & tackle box", "Fishing license (if required)"] },
  { key: "Golf", personal: ["Golf shoes", "Golf glove"], shared: ["Golf clubs (if not renting)"], skipBuckets: ["infant", "toddler", "child"] },
  { key: "Biking", personal: ["Padded shorts", "Bike helmet"], shared: ["Bike repair kit"], skipBuckets: ["infant"] },
  { key: "Sports / Spectating", personal: ["Team gear or jersey", "Comfortable athletic shoes"], shared: ["Portable seat cushions"] },
];

// Combines the built-in activity item lists with any items the family has
// added themselves (stored per-activity, applies to every future trip).
function getActivityDefinition(key, activityExtras) {
  const base = ACTIVITIES.find((a) => a.key === key) || { key, personal: [], shared: [] };
  const extra = (activityExtras && activityExtras[key]) || { personal: [], shared: [] };
  return {
    key,
    skipBuckets: base.skipBuckets,
    personal: [...(base.personal || []), ...(extra.personal || [])],
    shared: [...(base.shared || []), ...(extra.shared || [])],
  };
}

function generatePackingList(trip, members, activityExtras) {
  const travelers = (trip.travelers || []).map((t) => members.find((m) => m.id === t.memberId)).filter(Boolean);
  const nights = nightsBetween(trip.startDate, trip.endDate);
  const month = new Date(trip.startDate + "T00:00:00").getMonth();
  const hidden = new Set(trip.packingHidden || []);
  const custom = trip.packingCustom || [];

  let zoneKey = null, hemisphere = "N", locationLabel = "";
  if (trip.regionCountry === "United States" && trip.regionState) {
    const found = US_STATES.find((s) => s[0] === trip.regionState);
    if (found) { zoneKey = found[1]; hemisphere = "N"; locationLabel = `${trip.regionState}, United States`; }
  } else if (trip.regionCountry) {
    const found = COUNTRIES.find((c) => c[0] === trip.regionCountry);
    if (found) { zoneKey = found[2]; hemisphere = found[1]; locationLabel = trip.regionCountry; }
  }

  let seasonInfo = null;
  let weatherTags = [];
  if (zoneKey && ZONE_PROFILES[zoneKey]) {
    const season = getSeason(month, hemisphere);
    const profile = ZONE_PROFILES[zoneKey][season];
    seasonInfo = { season, label: profile.label, zoneKey };
    weatherTags = profile.tags;
  }

  // Items shared across the whole family (bring one, not one per person)
  const shared = new Set(["Travel confirmations & itinerary"]);
  if (zoneKey) (ZONE_EXTRAS[zoneKey] || []).forEach((i) => shared.add(i));
  if (trip.regionCountry && trip.regionCountry !== "United States") shared.add("Power adapter / voltage converter (bring a couple for the family)");
  if (nights >= 7) shared.add("Travel-size laundry detergent or laundry bag");

  const activities = (trip.activities || []).map((key) => getActivityDefinition(key, activityExtras));
  activities.forEach((a) => (a.shared || []).forEach((i) => shared.add(i)));
  const wantsSwim = (zoneKey === "tropical" || zoneKey === "mediterranean") || activities.some((a) => a.key === "Beach & Swimming" || a.key === "Boating & Water Sports");

  // Items generated individually for each traveler
  const perPerson = travelers.map((m) => {
    const cats = {
      "Weather & Clothing": new Set(),
      "Personal & Toiletries": new Set(["ID / passport", "Toothbrush & toothpaste", "Deodorant", "Reusable water bottle", "Phone charger"]),
      "Age-Specific": new Set(),
      "Activities": new Set(),
      "Always Bring": new Set(m.standingItems || []),
    };
    weatherTags.forEach((tag) => (TAG_ITEMS[tag] || []).forEach((i) => cats["Weather & Clothing"].add(i)));
    computeClothingQuantities(nights, weatherTags).forEach((i) => cats["Weather & Clothing"].add(i));
    if (wantsSwim) {
      cats["Weather & Clothing"].add("2× Swimsuits (one to dry while wearing the other)");
      cats["Weather & Clothing"].add("1× Sandals / flip-flops");
    }
    const bucket = ageBucket(m);
    (AGE_ITEMS[bucket] || []).forEach((i) => cats["Age-Specific"].add(i));
    if (m.gender === "Female" && ["teen", "adult", "senior"].includes(bucket)) cats["Personal & Toiletries"].add("Feminine hygiene products (if needed)");
    if (m.gender === "Male" && ["teen", "adult", "senior"].includes(bucket)) cats["Personal & Toiletries"].add("Razor / shaving kit (if needed)");
    if (bucket === "adult" || bucket === "senior" || bucket === "teen") cats["Personal & Toiletries"].add("Any regular medications");
    activities.forEach((a) => {
      if (a.skipBuckets && a.skipBuckets.includes(bucket)) return;
      (a.personal || []).forEach((i) => cats["Activities"].add(i));
    });

    const categories = {};
    const suggestions = [];
    Object.entries(cats).forEach(([k, v]) => {
      const required = [];
      v.forEach((item) => {
        if (hidden.has(`${m.id}::${item}`)) return;
        if (isOptionalItem(item)) suggestions.push(stripOptionalNote(item));
        else required.push(item);
      });
      if (required.length) categories[k] = required;
    });
    const customForPerson = custom.filter((c) => c.scope === m.id);
    return { member: m, categories, suggestions, custom: customForPerson };
  });

  const sharedRequired = [];
  const sharedSuggestions = [];
  shared.forEach((item) => {
    if (hidden.has(`shared::${item}`)) return;
    if (isOptionalItem(item)) sharedSuggestions.push(stripOptionalNote(item));
    else sharedRequired.push(item);
  });
  const sharedCustom = custom.filter((c) => c.scope === "shared");

  return { seasonInfo, locationLabel, perPerson, shared: sharedRequired, sharedSuggestions, sharedCustom };
}

/* ---------------------------------------------------------------------- */
/*  Storage (Supabase — one row per authenticated user)                   */
/*                                                                         */
/*  Saves are conditional on updated_at matching what we last saw. If     */
/*  another device wrote in between, the write is rejected instead of     */
/*  silently clobbering their change — the caller reloads fresh data and  */
/*  the user is told to redo their edit rather than losing it invisibly.  */
/* ---------------------------------------------------------------------- */
const emptyData = { members: [], trips: [] };

async function loadData(userId) {
  try {
    const { data, error } = await supabase
      .from("waypoint_data")
      .select("data, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const now = new Date().toISOString();
      await supabase.from("waypoint_data").insert({ user_id: userId, data: emptyData, updated_at: now });
      return { value: emptyData, updatedAt: now, ok: true };
    }
    return { value: data.data || emptyData, updatedAt: data.updated_at, ok: true };
  } catch (e) {
    console.error("Failed to load", e);
    return { value: emptyData, updatedAt: null, ok: false };
  }
}

async function saveData(userId, data, expectedUpdatedAt) {
  try {
    const now = new Date().toISOString();
    let query = supabase.from("waypoint_data").update({ data, updated_at: now }).eq("user_id", userId);
    if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
    const { data: rows, error } = await query.select("updated_at");
    if (error) throw error;
    if (expectedUpdatedAt && (!rows || rows.length === 0)) {
      return { ok: false, conflict: true };
    }
    return { ok: true, updatedAt: now };
  } catch (e) {
    console.error("Failed to save", e);
    return { ok: false, conflict: false, error: e };
  }
}

/* ---------------------------------------------------------------------- */
/*  Small UI atoms                                                        */
/* ---------------------------------------------------------------------- */
function Button({ children, onClick, variant = "solid", style = {}, ...rest }) {
  const base = {
    fontFamily: "'Public Sans', sans-serif",
    fontWeight: 600,
    fontSize: 13,
    borderRadius: 8,
    padding: "8px 14px",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    border: "1px solid transparent",
    transition: "all 0.15s ease",
  };
  const variants = {
    solid: { background: C.brass, color: C.ink, border: `1px solid ${C.brass}` },
    ghost: { background: "transparent", color: C.cream, border: `1px solid ${C.creamDim}` },
    ghostPaper: { background: "transparent", color: C.ink, border: `1px solid ${C.inkSoft}` },
    danger: { background: "transparent", color: C.coral, border: `1px solid ${C.coral}` },
  };
  return (
    <button onClick={onClick} style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 5 }}>
        {label}
      </div>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "'Public Sans', sans-serif",
  fontSize: 16,
  padding: "8px 10px",
  borderRadius: 6,
  border: `1px solid ${C.creamDim}`,
  background: "#fff",
  color: C.ink,
  outline: "none",
  overflow: "hidden",
};

function TextInput(props) {
  const style = props.type === "date" ? { ...inputStyle, padding: "8px 4px" } : inputStyle;
  return <input style={style} {...props} />;
}
function Select(props) {
  return <select style={{ ...inputStyle, cursor: "pointer" }} {...props} />;
}

/* Barcode-style decorative strip */
function Barcode({ seed }) {
  const bars = [];
  let s = 0;
  for (let i = 0; i < seed.length; i++) s += seed.charCodeAt(i);
  for (let i = 0; i < 28; i++) {
    const w = ((s * (i + 7)) % 3) + 1;
    bars.push(w);
  }
  return (
    <div style={{ display: "flex", alignItems: "stretch", height: 18, gap: 1.5, opacity: 0.55 }}>
      {bars.map((w, i) => (
        <div key={i} style={{ width: w, background: C.ink }} />
      ))}
    </div>
  );
}

/* Perforated punch holes for boarding-pass card */
function Perforation() {
  const holes = new Array(14).fill(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 12 }}>
      {holes.map((_, i) => (
        <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: C.bg, margin: "0 auto" }} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Family member (luggage tag)                                           */
/* ---------------------------------------------------------------------- */
function MemberTag({ member, onOpen }) {
  const job = currentJob(member);
  const balance = computeBalance(member);
  const isKid = member.type === "kid";
  const isUnlimited = job?.policyType === "unlimited";
  const pct = job?.policyType === "fixed" && job.annualDays
    ? Math.max(0, Math.min(100, (balance / job.annualDays) * 100))
    : null;

  return (
    <div
      onClick={onOpen}
      style={{
        position: "relative",
        minWidth: 178,
        background: C.paper,
        borderRadius: 10,
        padding: "14px 14px 12px",
        cursor: "pointer",
        boxShadow: "0 4px 10px rgba(0,0,0,0.25)",
        border: `1px solid ${C.paperAlt}`,
        transform: member._rot || "rotate(0deg)",
      }}
    >
      <div style={{ position: "absolute", top: -6, left: "50%", transform: "translateX(-50%)", width: 12, height: 12, borderRadius: "50%", background: C.bg, border: `2px solid ${C.brass}` }} />
      <div style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 17, color: C.ink }}>{member.name}</div>
      <div style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11, color: C.inkSoft, marginTop: 2, marginBottom: 10 }}>
        {isKid ? "Traveler" : (job?.title || "No job set")}
      </div>

      {isKid ? (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: C.teal }}>— N/A —</div>
      ) : isUnlimited ? (
        <div>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 20, color: C.teal, fontWeight: 600 }}>∞</span>
          <span style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11, color: C.inkSoft, marginLeft: 6 }}>unlimited</span>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600, color: balance < 0 ? C.coral : C.ink }}>
              {fmtDays(balance)}
            </span>
            <span style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11, color: C.inkSoft }}>
              days{job?.annualDays ? ` / ${job.annualDays}` : ""}
            </span>
          </div>
          {pct !== null && (
            <div style={{ marginTop: 6, height: 5, borderRadius: 3, background: C.paperAlt, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: balance < 0 ? C.coral : C.sage }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Member detail / edit panel                                            */
/* ---------------------------------------------------------------------- */
function MemberPanel({ member, onClose, onUpdate, onDelete }) {
  const today = new Date().toISOString().slice(0, 10);
  const job = currentJob(member) || { title: "", policyType: "fixed", annualDays: 15, accrualRate: 1.25, resetMonth: 1, resetDay: 1, startDate: today };
  const [jobDraft, setJobDraft] = useState({ ...job, resetDateStr: `${new Date().getFullYear()}-${String(job.resetMonth || 1).padStart(2, "0")}-${String(job.resetDay || 1).padStart(2, "0")}` });
  const [editingJob, setEditingJob] = useState(!currentJob(member) && member.type === "adult");
  const [newJobBalance, setNewJobBalance] = useState(job.annualDays || 0);
  const [adjustAmt, setAdjustAmt] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [newStandingItem, setNewStandingItem] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const balance = computeBalance(member);

  const addStandingItem = () => {
    if (!newStandingItem.trim()) return;
    onUpdate({ ...member, standingItems: [...(member.standingItems || []), newStandingItem.trim()] });
    setNewStandingItem("");
  };
  const removeStandingItem = (item) => {
    onUpdate({ ...member, standingItems: (member.standingItems || []).filter((i) => i !== item) });
  };

  const addLedger = (entry) => {
    const ledger = [...(member.ledger || []), { id: uid(), date: today, ...entry }];
    onUpdate({ ...member, ledger });
  };

  const saveNewJob = () => {
    const rd = new Date(jobDraft.resetDateStr + "T00:00:00");
    const cleanJob = {
      id: uid(), title: jobDraft.title, policyType: jobDraft.policyType,
      annualDays: Number(jobDraft.annualDays), accrualRate: Number(jobDraft.accrualRate),
      resetMonth: rd.getMonth() + 1, resetDay: rd.getDate(), startDate: today,
    };
    const jobHistory = [...(member.jobHistory || []), cleanJob];
    let ledger = member.ledger || [];
    if (jobDraft.policyType !== "unlimited" && Number(newJobBalance) !== 0) {
      ledger = [...ledger, { id: uid(), date: today, type: "adjust", days: Number(newJobBalance), note: "Starting balance (new job)" }];
    }
    onUpdate({ ...member, jobHistory, ledger });
    setEditingJob(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16, paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.paper, borderRadius: 12, width: "100%", maxWidth: 440, maxHeight: "88vh", overflowY: "auto", padding: 20, fontFamily: "'Public Sans', sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 600, color: C.ink }}>{member.name}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.inkSoft }}><X size={20} /></button>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <div style={{ flex: 1.3, minWidth: 0 }}>
            <Field label="Birthdate">
              <TextInput type="date" value={member.birthDate || ""} onChange={(e) => onUpdate({ ...member, birthDate: e.target.value || null })} />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Field label="Gender">
              <Select value={member.gender || "Prefer not to say"} onChange={(e) => onUpdate({ ...member, gender: e.target.value })}>
                <option>Prefer not to say</option>
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
              </Select>
            </Field>
          </div>
        </div>

        {member.type === "adult" && (
          <>
            <div style={{ marginTop: 14, padding: 12, background: "#fff", borderRadius: 8, border: `1px solid ${C.paperAlt}` }}>
              {!editingJob ? (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: C.ink }}>{job.title || "Untitled job"}</div>
                      <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 2 }}>
                        {job.policyType === "fixed" && `${job.annualDays} days/year · resets ${nextAnniversary(job).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                        {job.policyType === "accrual" && `${job.accrualRate} days/month accrual`}
                        {job.policyType === "unlimited" && "Unlimited PTO"}
                      </div>
                    </div>
                    <Button variant="ghostPaper" onClick={() => { setJobDraft(job); setEditingJob(true); }}><Edit2 size={13} /> New job</Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Field label="Job title">
                    <TextInput value={jobDraft.title} onChange={(e) => setJobDraft({ ...jobDraft, title: e.target.value })} placeholder="e.g. Product Manager @ Acme" />
                  </Field>
                  <Field label="PTO policy">
                    <Select value={jobDraft.policyType} onChange={(e) => setJobDraft({ ...jobDraft, policyType: e.target.value })}>
                      <option value="fixed">Fixed days per year</option>
                      <option value="accrual">Accrues per month</option>
                      <option value="unlimited">Unlimited</option>
                    </Select>
                  </Field>
                  {jobDraft.policyType === "fixed" && (
                    <>
                      <Field label="Days per year">
                        <TextInput type="number" value={jobDraft.annualDays} onChange={(e) => setJobDraft({ ...jobDraft, annualDays: Number(e.target.value) })} />
                      </Field>
                      <Field label="PTO reset date (work anniversary or company reset day)">
                        <TextInput type="date" value={jobDraft.resetDateStr} onChange={(e) => setJobDraft({ ...jobDraft, resetDateStr: e.target.value })} />
                      </Field>
                    </>
                  )}
                  {jobDraft.policyType === "accrual" && (
                    <Field label="Days accrued per month">
                      <TextInput type="number" step="0.25" value={jobDraft.accrualRate} onChange={(e) => setJobDraft({ ...jobDraft, accrualRate: Number(e.target.value) })} />
                    </Field>
                  )}
                  {jobDraft.policyType !== "unlimited" && (
                    <Field label="Starting balance for this job (days available now)">
                      <TextInput type="number" step="0.5" value={newJobBalance} onChange={(e) => setNewJobBalance(e.target.value)} />
                    </Field>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <Button onClick={saveNewJob}><Check size={13} /> Save job</Button>
                    {currentJob(member) && <Button variant="ghostPaper" onClick={() => setEditingJob(false)}>Cancel</Button>}
                  </div>
                </div>
              )}
            </div>

            {job.policyType !== "unlimited" ? (
              <>
                <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 28, fontWeight: 600, color: balance < 0 ? C.coral : C.ink }}>{fmtDays(balance)}</span>
                  <span style={{ fontSize: 12, color: C.inkSoft }}>days available</span>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {job.policyType === "accrual" && (
                    <Button variant="ghostPaper" onClick={() => addLedger({ type: "accrual", days: job.accrualRate, note: "Monthly accrual" })}>
                      <Plus size={13} /> Log month's accrual (+{job.accrualRate})
                    </Button>
                  )}
                  {job.policyType === "fixed" && (
                    <div>
                      <Button variant="ghostPaper" onClick={() => addLedger({ type: "accrual", days: job.annualDays, note: "Annual reset" })}>
                        <Plus size={13} /> Reset balance (+{job.annualDays}) — anniversary {lastAnniversary(job).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </Button>
                      {resetDueThisCycle(member) && (
                        <div style={{ fontSize: 11, color: C.coral, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                          <AlertCircle size={12} /> Reset looks overdue for this cycle — tap to apply it
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Field label="Manual adjustment (days)">
                      <TextInput type="number" step="0.5" value={adjustAmt} onChange={(e) => setAdjustAmt(e.target.value)} placeholder="e.g. -2 or 3" />
                    </Field>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Field label="Note">
                      <TextInput value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="Reason" />
                    </Field>
                  </div>
                  <Button
                    style={{ marginBottom: 12 }}
                    onClick={() => {
                      if (!adjustAmt) return;
                      addLedger({ type: "adjust", days: Number(adjustAmt), note: adjustNote || "Manual adjustment" });
                      setAdjustAmt(""); setAdjustNote("");
                    }}
                  >Apply</Button>
                </div>

                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 6 }}>Ledger</div>
                  <div style={{ maxHeight: 160, overflowY: "auto", border: `1px solid ${C.paperAlt}`, borderRadius: 8 }}>
                    {(member.ledger || []).slice().reverse().map((e) => (
                      <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", fontSize: 12, borderBottom: `1px solid ${C.paperAlt}` }}>
                        <span style={{ color: C.inkSoft }}>{fmtDate(e.date)} · {e.note}</span>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: e.days < 0 ? C.coral : C.sage, fontWeight: 600 }}>
                          {e.days > 0 ? "+" : ""}{fmtDays(e.days)}
                        </span>
                      </div>
                    ))}
                    {!(member.ledger || []).length && <div style={{ padding: 10, fontSize: 12, color: C.inkSoft }}>No entries yet.</div>}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 28, fontWeight: 600, color: C.ink }}>
                    {fmtDays((member.ledger || []).filter((e) => e.type === "use").reduce((s, e) => s + Math.abs(e.days), 0))}
                  </span>
                  <span style={{ fontSize: 12, color: C.inkSoft }}>days used — unlimited PTO, no remaining balance to track</span>
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 6 }}>Usage history</div>
                  <div style={{ maxHeight: 160, overflowY: "auto", border: `1px solid ${C.paperAlt}`, borderRadius: 8 }}>
                    {(member.ledger || []).slice().reverse().map((e) => (
                      <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", fontSize: 12, borderBottom: `1px solid ${C.paperAlt}` }}>
                        <span style={{ color: C.inkSoft }}>{fmtDate(e.date)} · {e.note}</span>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.coral, fontWeight: 600 }}>{fmtDays(Math.abs(e.days))}</span>
                      </div>
                    ))}
                    {!(member.ledger || []).length && <div style={{ padding: 10, fontSize: 12, color: C.inkSoft }}>No trips logged yet.</div>}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        <div style={{ marginTop: 18, borderTop: `1px solid ${C.paperAlt}`, paddingTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 8 }}>Always pack for every trip</div>
          <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 10 }}>Items that should show up on {member.name}'s packing list automatically, every trip — medications, a CPAP machine, a comfort item, glasses, etc.</div>
          {(member.standingItems || []).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {member.standingItems.map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 10px", background: "#fff", borderRadius: 6, marginBottom: 4, border: `1px solid ${C.paperAlt}` }}>
                  <span style={{ fontSize: 13 }}>{item}</span>
                  <button onClick={() => removeStandingItem(item)} style={{ background: "none", border: "none", cursor: "pointer", color: C.coral }}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <TextInput value={newStandingItem} onChange={(e) => setNewStandingItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStandingItem()} placeholder="e.g. CPAP machine, EpiPen" />
            <Button onClick={addStandingItem}><Plus size={13} /></Button>
          </div>
        </div>

        <div style={{ marginTop: 18, borderTop: `1px solid ${C.paperAlt}`, paddingTop: 12 }}>
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={13} /> Remove family member
          </Button>
        </div>
      </div>
      {confirmingDelete && (
        <ConfirmDialog
          title="Remove family member?"
          message={`This removes ${member.name} from the family. Their PTO history goes with them, and they'll be taken off any trips they were part of.`}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => onDelete(member.id)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Add member modal                                                      */
/* ---------------------------------------------------------------------- */
function AddMemberModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("adult");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState("Prefer not to say");
  const [jobTitle, setJobTitle] = useState("");
  const [policyType, setPolicyType] = useState("fixed");
  const [annualDays, setAnnualDays] = useState(15);
  const [accrualRate, setAccrualRate] = useState(1.25);
  const [resetDate, setResetDate] = useState(new Date().toISOString().slice(0, 10));
  const [startingBalance, setStartingBalance] = useState(15);

  const submit = () => {
    if (!name.trim()) return;
    const rd = new Date(resetDate + "T00:00:00");
    const job = {
      id: uid(), title: jobTitle || "Job", policyType,
      annualDays: Number(annualDays), accrualRate: Number(accrualRate),
      resetMonth: rd.getMonth() + 1, resetDay: rd.getDate(),
      startDate: new Date().toISOString().slice(0, 10),
    };
    const ledger = [];
    if (policyType !== "unlimited" && Number(startingBalance) !== 0) {
      ledger.push({ id: uid(), date: new Date().toISOString().slice(0, 10), type: "adjust", days: Number(startingBalance), note: "Starting balance" });
    }
    const member = {
      id: uid(),
      name: name.trim(),
      type,
      birthDate: birthDate || null,
      gender,
      jobHistory: type === "adult" ? [job] : [],
      ledger,
      _rot: `rotate(${(Math.random() * 3 - 1.5).toFixed(1)}deg)`,
    };
    onAdd(member);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16, paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.paper, borderRadius: 12, width: "100%", maxWidth: 400, padding: 20, fontFamily: "'Public Sans', sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600 }}>Add family member</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.inkSoft }}><X size={20} /></button>
        </div>
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya" autoFocus />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="adult">Adult (has a job / PTO)</option>
            <option value="kid">Kid / dependent</option>
          </Select>
        </Field>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1.3, minWidth: 0 }}>
            <Field label="Birthdate (optional — powers age-based packing suggestions)">
              <TextInput type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </Field>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Field label="Gender (optional)">
              <Select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option>Prefer not to say</option>
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
              </Select>
            </Field>
          </div>
        </div>
        {type === "adult" && (
          <>
            <Field label="Job title">
              <TextInput value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Nurse @ St. Mary's" />
            </Field>
            <Field label="PTO policy">
              <Select value={policyType} onChange={(e) => setPolicyType(e.target.value)}>
                <option value="fixed">Fixed days per year</option>
                <option value="accrual">Accrues per month</option>
                <option value="unlimited">Unlimited</option>
              </Select>
            </Field>
            {policyType === "fixed" && (
              <>
                <Field label="Days per year"><TextInput type="number" value={annualDays} onChange={(e) => { setAnnualDays(e.target.value); }} /></Field>
                <Field label="PTO reset date (their work anniversary or company reset day)">
                  <TextInput type="date" value={resetDate} onChange={(e) => setResetDate(e.target.value)} />
                </Field>
              </>
            )}
            {policyType === "accrual" && (
              <Field label="Days accrued per month"><TextInput type="number" step="0.25" value={accrualRate} onChange={(e) => setAccrualRate(e.target.value)} /></Field>
            )}
            {policyType !== "unlimited" && (
              <Field label="Current balance right now (days available — factor in any already used)">
                <TextInput type="number" step="0.5" value={startingBalance} onChange={(e) => setStartingBalance(e.target.value)} />
              </Field>
            )}
          </>
        )}
        <Button onClick={submit} style={{ marginTop: 6, width: "100%", justifyContent: "center" }}>Add to family</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Trip card (boarding pass)                                             */
/* ---------------------------------------------------------------------- */
function TripCard({ trip, members, onOpen, currency }) {
  const status = tripStatus(trip);
  const total = (trip.expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);
  const badge = { upcoming: { text: "UPCOMING", color: C.teal }, active: { text: "IN PROGRESS", color: C.sage }, past: { text: "COMPLETED", color: C.inkSoft } }[status];
  const travelerNames = (trip.travelers || []).map((t) => members.find((m) => m.id === t.memberId)?.name).filter(Boolean);

  return (
    <div onClick={onOpen} style={{ display: "flex", background: C.paper, borderRadius: 12, overflow: "hidden", boxShadow: "0 6px 16px rgba(0,0,0,0.28)", cursor: "pointer" }}>
      <div style={{ flex: 1, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, color: C.ink }}>{trip.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, color: C.inkSoft, fontSize: 12.5 }}>
              <MapPin size={12} /> {trip.destination}
            </div>
          </div>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: badge.color, border: `1px solid ${badge.color}`, borderRadius: 4, padding: "3px 6px" }}>
            {badge.text}
          </span>
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.ink }}>
            <PlaneTakeoff size={13} color={C.brassDim} /> <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmtDate(trip.startDate)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.ink }}>
            <PlaneLanding size={13} color={C.brassDim} /> <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmtDate(trip.endDate)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: C.ink }}>
            <Users size={13} color={C.brassDim} /> {travelerNames.join(", ") || "No travelers yet"}
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Barcode seed={trip.id} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 600, color: C.ink }}>{fmtMoney(total, currency)}</div>
            {trip.budget ? <div style={{ fontSize: 11, color: total > trip.budget ? C.coral : C.sage }}>of {fmtMoney(trip.budget, currency)} budget</div> : null}
          </div>
        </div>
      </div>
      <div style={{ width: 1, background: `repeating-linear-gradient(${C.bg}, ${C.bg} 6px, transparent 6px, transparent 12px)` }} />
      <div style={{ display: "flex", alignItems: "center", padding: "0 4px", background: C.paper }}>
        <Perforation />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Trip detail / edit panel                                              */
/* ---------------------------------------------------------------------- */
/* Reusable confirm dialog — replaces window.confirm() for a native-feeling,
   Capacitor-webview-safe destructive-action confirmation. */
function ConfirmDialog({ title, message, confirmLabel = "Delete", onConfirm, onCancel }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16, paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }} onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.paper, borderRadius: 12, width: "100%", maxWidth: 360, padding: 20, fontFamily: "'Public Sans', sans-serif" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, color: C.ink, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: C.inkSoft, marginBottom: 18 }}>{message}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghostPaper" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

function AddPackingItemForm({ onAdd }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState(1);
  const submit = () => {
    if (!name.trim()) return;
    onAdd(name.trim(), Number(qty) || 1);
    setName("");
    setQty(1);
  };
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <div style={{ width: 54 }}>
        <TextInput type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      <TextInput value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Add an item…" />
      <Button variant="ghostPaper" onClick={submit}><Plus size={13} /></Button>
    </div>
  );
}

function TripPanel({ trip, members, onClose, onUpdate, onDelete, activityExtras, onUpdateActivityExtras, currency }) {
  const [tab, setTab] = useState("details");
  const [draft, setDraft] = useState(trip);
  const [expForm, setExpForm] = useState({ category: "Flights", description: "", amount: "", paidBy: "" });
  const [packingView, setPackingView] = useState("all"); // "all" | "shared" | memberId
  const [customizingActivity, setCustomizingActivity] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const total = (draft.expenses || []).reduce((s, e) => s + Number(e.amount || 0), 0);

  const toggleTraveler = (memberId) => {
    const exists = draft.travelers.find((t) => t.memberId === memberId);
    let travelers;
    if (exists) {
      travelers = draft.travelers.filter((t) => t.memberId !== memberId);
    } else {
      const days = businessDays(draft.startDate, draft.endDate);
      travelers = [...draft.travelers, { memberId, ptoDays: days }];
    }
    setDraft({ ...draft, travelers });
  };

  const updateTravelerDays = (memberId, days) => {
    setDraft({ ...draft, travelers: draft.travelers.map((t) => t.memberId === memberId ? { ...t, ptoDays: Number(days) } : t) });
  };

  const addExpense = () => {
    const amt = Number(expForm.amount);
    if (!expForm.description.trim() || !expForm.amount || !(amt > 0)) return;
    const expenses = [...(draft.expenses || []), { id: uid(), ...expForm, amount: amt, date: new Date().toISOString().slice(0, 10) }];
    const next = { ...draft, expenses };
    setDraft(next);
    onUpdate(next);
    setExpForm({ category: "Flights", description: "", amount: "", paidBy: "" });
  };

  const removeExpense = (id) => {
    const next = { ...draft, expenses: draft.expenses.filter((e) => e.id !== id) };
    setDraft(next);
    onUpdate(next);
  };

  const dateInvalid = draft.startDate && draft.endDate && draft.endDate < draft.startDate;
  const save = () => {
    if (dateInvalid) return;
    onUpdate(draft);
    onClose();
  };

  const ptoEligible = (m) => m.type === "adult" && !!currentJob(m);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16, paddingTop: "calc(16px + env(safe-area-inset-top))", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.paper, borderRadius: 12, width: "100%", maxWidth: 520, maxHeight: "88vh", overflowY: "auto", padding: 20, fontFamily: "'Public Sans', sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600 }}>{draft.title || "New trip"}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: C.inkSoft }}><X size={20} /></button>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 12, marginBottom: 16 }}>
          {["details", "travelers", "expenses", "packing"].map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              fontFamily: "'Public Sans', sans-serif", fontSize: 12, fontWeight: 600, textTransform: "capitalize",
              padding: "6px 12px", borderRadius: 6, cursor: "pointer",
              background: tab === t ? C.brass : "transparent", color: tab === t ? C.ink : C.inkSoft,
              border: `1px solid ${tab === t ? C.brass : C.paperAlt}`,
            }}>{t}</button>
          ))}
        </div>

        {tab === "details" && (
          <div>
            <Field label="Trip title"><TextInput value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Grandma's 70th in Lisbon" /></Field>
            <Field label="Destination"><TextInput value={draft.destination} onChange={(e) => setDraft({ ...draft, destination: e.target.value })} placeholder="e.g. Lisbon, Portugal" /></Field>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}><Field label="Start date"><TextInput type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} /></Field></div>
              <div style={{ flex: 1, minWidth: 0 }}><Field label="End date"><TextInput type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} /></Field></div>
            </div>
            <Field label="Budget (optional)"><TextInput type="number" value={draft.budget || ""} onChange={(e) => setDraft({ ...draft, budget: Number(e.target.value) })} placeholder="e.g. 4000" /></Field>
            <Field label="Notes"><TextInput value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Confirmation numbers, ideas, links..." /></Field>

            <div style={{ marginTop: 6, padding: 12, background: "#fff", borderRadius: 8, border: `1px solid ${C.paperAlt}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 8 }}>Climate region (powers packing suggestions)</div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Field label="Country">
                    <Select
                      value={draft.regionCountry || ""}
                      onChange={(e) => {
                        const country = e.target.value;
                        const auto = !draft.destination && country ? (country === "United States" ? "" : country) : draft.destination;
                        setDraft({ ...draft, regionCountry: country, regionState: "", destination: auto });
                      }}
                    >
                      <option value="">— Select —</option>
                      {COUNTRIES.map(([name]) => <option key={name} value={name}>{name}</option>)}
                    </Select>
                  </Field>
                </div>
                {draft.regionCountry === "United States" && (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Field label="State">
                      <Select
                        value={draft.regionState || ""}
                        onChange={(e) => {
                          const state = e.target.value;
                          const auto = !draft.destination && state ? `${state}, United States` : draft.destination;
                          setDraft({ ...draft, regionState: state, destination: auto });
                        }}
                      >
                        <option value="">— Select —</option>
                        {US_STATES.map(([name]) => <option key={name} value={name}>{name}</option>)}
                      </Select>
                    </Field>
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: 12, padding: 12, background: "#fff", borderRadius: 8, border: `1px solid ${C.paperAlt}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 8 }}>Planned activities (also powers packing suggestions)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ACTIVITIES.map((a) => {
                  const active = (draft.activities || []).includes(a.key);
                  return (
                    <div key={a.key} style={{ display: "inline-flex", alignItems: "center", gap: 1, background: active ? C.brass : "transparent", borderRadius: 16, border: `1px solid ${active ? C.brass : C.paperAlt}` }}>
                      <button
                        type="button"
                        onClick={() => {
                          const current = draft.activities || [];
                          const next = active ? current.filter((x) => x !== a.key) : [...current, a.key];
                          setDraft({ ...draft, activities: next });
                        }}
                        style={{
                          fontFamily: "'Public Sans', sans-serif", fontSize: 12, fontWeight: 600,
                          padding: "6px 4px 6px 11px", borderRadius: "16px 0 0 16px", cursor: "pointer",
                          background: "transparent", color: active ? C.ink : C.inkSoft, border: "none",
                        }}
                      >
                        {a.key}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomizingActivity(customizingActivity === a.key ? null : a.key)}
                        title={`Add items to ${a.key}`}
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: active ? C.ink : C.inkSoft, padding: "6px 9px 6px 4px", opacity: 0.75, borderRadius: "0 16px 16px 0" }}
                      >
                        <Edit2 size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {customizingActivity && (() => {
                const def = getActivityDefinition(customizingActivity, activityExtras);
                const extra = (activityExtras && activityExtras[customizingActivity]) || { personal: [], shared: [] };
                const addItem = (scope, name) => {
                  const current = activityExtras[customizingActivity] || { personal: [], shared: [] };
                  const next = { ...activityExtras, [customizingActivity]: { ...current, [scope]: [...(current[scope] || []), name] } };
                  onUpdateActivityExtras(next);
                };
                const removeItem = (scope, name) => {
                  const current = activityExtras[customizingActivity] || { personal: [], shared: [] };
                  const next = { ...activityExtras, [customizingActivity]: { ...current, [scope]: (current[scope] || []).filter((i) => i !== name) } };
                  onUpdateActivityExtras(next);
                };
                const isCustom = (scope, name) => (extra[scope] || []).includes(name);
                return (
                  <div style={{ marginTop: 12, padding: 12, background: C.paper, borderRadius: 8, border: `1px solid ${C.paperAlt}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 600, color: C.ink }}>{customizingActivity} — items</div>
                      <button onClick={() => setCustomizingActivity(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.inkSoft }}><X size={16} /></button>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.inkSoft, marginBottom: 10 }}>These apply to this activity on <strong>every trip</strong> for your whole family — add once, like "Golf clubs," and it'll show up whenever this activity is selected.</div>

                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.brassDim, marginBottom: 4 }}>Per traveler</div>
                    {def.personal.map((item) => (
                      <div key={item} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 13 }}>
                        <span>{item}</span>
                        {isCustom("personal", item) && <button onClick={() => removeItem("personal", item)} style={{ background: "none", border: "none", cursor: "pointer", color: C.coral }}><Trash2 size={12} /></button>}
                      </div>
                    ))}
                    <AddPackingItemForm onAdd={(name, qty) => addItem("personal", qty > 1 ? `${qty}× ${name}` : name)} />

                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.brassDim, marginTop: 14, marginBottom: 4 }}>Shared for the family</div>
                    {def.shared.map((item) => (
                      <div key={item} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 13 }}>
                        <span>{item}</span>
                        {isCustom("shared", item) && <button onClick={() => removeItem("shared", item)} style={{ background: "none", border: "none", cursor: "pointer", color: C.coral }}><Trash2 size={12} /></button>}
                      </div>
                    ))}
                    <AddPackingItemForm onAdd={(name, qty) => addItem("shared", qty > 1 ? `${qty}× ${name}` : name)} />
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {tab === "travelers" && (
          <div>
            <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 10 }}>Select who's going. PTO days default to weekdays in the trip range — edit as needed.</div>
            {members.length === 0 && <div style={{ fontSize: 13, color: C.inkSoft }}>Add family members first.</div>}
            {members.map((m) => {
              const t = draft.travelers.find((x) => x.memberId === m.id);
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "#fff", borderRadius: 8, marginBottom: 6, border: `1px solid ${C.paperAlt}` }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13.5 }}>
                    <input type="checkbox" checked={!!t} onChange={() => toggleTraveler(m.id)} />
                    {m.name}
                  </label>
                  {t && ptoEligible(m) && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <input type="number" step="0.5" value={t.ptoDays} onChange={(e) => updateTravelerDays(m.id, e.target.value)} style={{ ...inputStyle, width: 60, padding: "4px 6px" }} />
                      <span style={{ fontSize: 11, color: C.inkSoft }}>PTO days</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "expenses" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600 }}>{fmtMoney(total, currency)}</div>
              {draft.budget ? <div style={{ fontSize: 12, color: total > draft.budget ? C.coral : C.sage }}>{fmtMoney(draft.budget - total, currency)} {total > draft.budget ? "over" : "left"} of {fmtMoney(draft.budget, currency)}</div> : null}
            </div>
            {draft.budget ? (
              <div style={{ height: 6, borderRadius: 3, background: C.paperAlt, overflow: "hidden", marginBottom: 14 }}>
                <div style={{ width: `${Math.min(100, (total / draft.budget) * 100)}%`, height: "100%", background: total > draft.budget ? C.coral : C.sage }} />
              </div>
            ) : null}

            <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: 12 }}>
              {(draft.expenses || []).map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", background: "#fff", borderRadius: 8, marginBottom: 5, border: `1px solid ${C.paperAlt}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: CATEGORY_META[e.category]?.color, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.description}</div>
                      <div style={{ fontSize: 10.5, color: C.inkSoft }}>{e.category}{e.paidBy ? ` · paid by ${members.find(m => m.id === e.paidBy)?.name || ""}` : ""}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 13 }}>{fmtMoney(e.amount, currency)}</span>
                    <button onClick={() => removeExpense(e.id)} style={{ background: "none", border: "none", cursor: "pointer", color: C.coral }}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
              {!(draft.expenses || []).length && <div style={{ fontSize: 12, color: C.inkSoft }}>No expenses logged yet.</div>}
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", padding: 10, background: "#fff", borderRadius: 8, border: `1px solid ${C.paperAlt}` }}>
              <div style={{ width: 100 }}>
                <Field label="Category"><Select value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select></Field>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <Field label="Description"><TextInput value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} placeholder="e.g. Delta flights" /></Field>
              </div>
              <div style={{ width: 90 }}>
                <Field label="Amount"><TextInput type="number" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} placeholder="0" /></Field>
              </div>
              <div style={{ width: 110 }}>
                <Field label="Paid by"><Select value={expForm.paidBy} onChange={(e) => setExpForm({ ...expForm, paidBy: e.target.value })}>
                  <option value="">—</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select></Field>
              </div>
              <Button onClick={addExpense} style={{ marginBottom: 12 }}><Plus size={13} /> Add</Button>
            </div>
          </div>
        )}

        {tab === "packing" && (
          <div>
            {(() => {
              const { seasonInfo, locationLabel, perPerson, shared, sharedSuggestions, sharedCustom } = generatePackingList(draft, members, activityExtras);
              const checked = draft.packingChecked || [];
              const toggleItem = (key) => {
                const next = checked.includes(key) ? checked.filter((i) => i !== key) : [...checked, key];
                const nextDraft = { ...draft, packingChecked: next };
                setDraft(nextDraft);
                onUpdate(nextDraft);
              };
              const hideItem = (key) => {
                const nextDraft = { ...draft, packingHidden: [...(draft.packingHidden || []), key] };
                setDraft(nextDraft);
                onUpdate(nextDraft);
              };
              const addCustom = (scope, name, qty) => {
                const text = qty > 1 ? `${qty}× ${name}` : name;
                const nextDraft = { ...draft, packingCustom: [...(draft.packingCustom || []), { id: uid(), scope, name: text }] };
                setDraft(nextDraft);
                onUpdate(nextDraft);
              };
              const deleteCustom = (id) => {
                const nextDraft = { ...draft, packingCustom: (draft.packingCustom || []).filter((c) => c.id !== id) };
                setDraft(nextDraft);
                onUpdate(nextDraft);
              };

              const renderRow = (key, label, isChecked, onDeleteClick) => (
                <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer", color: isChecked ? C.inkSoft : C.ink, textDecoration: isChecked ? "line-through" : "none" }}>
                    <input type="checkbox" checked={isChecked} onChange={() => toggleItem(key)} />
                    {label}
                  </label>
                  <button onClick={onDeleteClick} title="Remove from this list" style={{ background: "none", border: "none", cursor: "pointer", color: C.creamDim, opacity: 0.6 }}><X size={13} /></button>
                </div>
              );

              const renderCategories = (categories, scope) => (
                Object.entries(categories).map(([cat, items]) => (
                  <div key={cat} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.brassDim, marginBottom: 6 }}>{cat}</div>
                    {items.map((item) => {
                      const key = `${scope}::${item}`;
                      return renderRow(key, item, checked.includes(key), () => hideItem(key));
                    })}
                  </div>
                ))
              );

              const renderCustomList = (items) => !items.length ? null : (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.brassDim, marginBottom: 6 }}>Added by you</div>
                  {items.map((c) => {
                    const key = `${c.scope}::custom::${c.id}`;
                    return renderRow(key, c.name, checked.includes(key), () => deleteCustom(c.id));
                  })}
                </div>
              );

              const renderSuggestions = (items) => !items.length ? null : (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${C.paperAlt}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 6 }}>Suggestions — bring if needed</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {items.map((item) => (
                      <li key={item} style={{ fontSize: 13, color: C.inkSoft, padding: "2px 0" }}>{item}</li>
                    ))}
                  </ul>
                </div>
              );

              if (!perPerson.length) {
                return <div style={{ fontSize: 13, color: C.inkSoft }}>Add travelers on the Travelers tab, and a climate region on Details, to generate per-person lists.</div>;
              }

              const sharedBlock = (
                <div style={{ padding: 12, background: "#fff", borderRadius: 8, border: `1px solid ${C.paperAlt}` }}>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: C.ink, marginBottom: 8 }}>Shared for the family</div>
                  {shared.map((item) => {
                    const key = `shared::${item}`;
                    return renderRow(key, item, checked.includes(key), () => hideItem(key));
                  })}
                  {renderCustomList(sharedCustom)}
                  {renderSuggestions(sharedSuggestions)}
                  <AddPackingItemForm onAdd={(name, qty) => addCustom("shared", name, qty)} />
                </div>
              );

              return (
                <div>
                  <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 12 }}>
                    {locationLabel ? <>Based on <strong style={{ color: C.ink }}>{locationLabel}</strong>{seasonInfo ? <> — typically <strong style={{ color: C.ink }}>{seasonInfo.label.toLowerCase()}</strong> this time of year</> : null}.</> : "Add a climate region on the Details tab for weather-aware suggestions."}
                    {" "}Tap the × next to any item to remove it from this list.
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                    <button onClick={() => setPackingView("all")} style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: packingView === "all" ? C.brass : "transparent", color: packingView === "all" ? C.ink : C.inkSoft, border: `1px solid ${packingView === "all" ? C.brass : C.paperAlt}` }}>Everyone</button>
                    {perPerson.map(({ member }) => (
                      <button key={member.id} onClick={() => setPackingView(member.id)} style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: packingView === member.id ? C.brass : "transparent", color: packingView === member.id ? C.ink : C.inkSoft, border: `1px solid ${packingView === member.id ? C.brass : C.paperAlt}` }}>{member.name}</button>
                    ))}
                    <button onClick={() => setPackingView("shared")} style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 6, cursor: "pointer", background: packingView === "shared" ? C.brass : "transparent", color: packingView === "shared" ? C.ink : C.inkSoft, border: `1px solid ${packingView === "shared" ? C.brass : C.paperAlt}` }}>Shared</button>
                  </div>

                  {packingView === "all" && perPerson.map(({ member, categories, suggestions, custom }) => (
                    <div key={member.id} style={{ marginBottom: 18, padding: 12, background: "#fff", borderRadius: 8, border: `1px solid ${C.paperAlt}` }}>
                      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: C.ink, marginBottom: 8 }}>{member.name}</div>
                      {renderCategories(categories, member.id)}
                      {renderCustomList(custom)}
                      {renderSuggestions(suggestions)}
                      <AddPackingItemForm onAdd={(name, qty) => addCustom(member.id, name, qty)} />
                    </div>
                  ))}

                  {packingView !== "all" && packingView !== "shared" && (() => {
                    const p = perPerson.find((x) => x.member.id === packingView);
                    if (!p) return null;
                    return (
                      <div style={{ padding: 12, background: "#fff", borderRadius: 8, border: `1px solid ${C.paperAlt}` }}>
                        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: C.ink, marginBottom: 8 }}>{p.member.name}</div>
                        {renderCategories(p.categories, p.member.id)}
                        {renderCustomList(p.custom)}
                        {renderSuggestions(p.suggestions)}
                        <AddPackingItemForm onAdd={(name, qty) => addCustom(p.member.id, name, qty)} />
                      </div>
                    );
                  })()}

                  {packingView === "shared" && sharedBlock}
                  {packingView === "all" && sharedBlock}
                </div>
              );
            })()}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, borderTop: `1px solid ${C.paperAlt}`, paddingTop: 14 }}>
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={13} /> Delete trip
          </Button>
          <div>
            {dateInvalid && <div style={{ fontSize: 11, color: C.coral, marginBottom: 4, textAlign: "right" }}>End date is before the start date</div>}
            <Button onClick={save} disabled={dateInvalid} style={dateInvalid ? { opacity: 0.5, cursor: "not-allowed" } : {}}><Check size={13} /> Save trip</Button>
          </div>
        </div>
      </div>
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this trip?"
          message="This also removes any PTO days it used from everyone's ledger. This can't be undone."
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => onDelete(draft.id)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Auth (single shared family login)                                     */
/* ---------------------------------------------------------------------- */
function AuthScreen() {
  const [mode, setMode] = useState("signin"); // signin | signup | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setInfo(""); setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo("Account created. If email confirmation is on, check your inbox, then sign in.");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setInfo("If that email has an account, a reset link is on its way — check your inbox.");
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, paddingTop: "calc(20px + env(safe-area-inset-top))", paddingBottom: "calc(20px + env(safe-area-inset-bottom))", fontFamily: "'Public Sans', sans-serif" }}>
      <form onSubmit={submit} style={{ background: C.paper, borderRadius: 12, padding: 26, width: "100%", maxWidth: 360 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: C.brass, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Plane size={18} color={C.bg} />
          </div>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 700, color: C.ink }}>Waypoint Ledger</div>
        </div>
        <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 18 }}>
          {mode === "signin" && "One shared family login. Sign in below."}
          {mode === "signup" && "Create it once, then everyone signs in with the same email & password."}
          {mode === "forgot" && "Enter the family's email and we'll send a reset link."}
        </div>

        <Field label="Email">
          <div style={{ position: "relative" }}>
            <TextInput type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="family@example.com" />
          </div>
        </Field>
        {mode !== "forgot" && (
          <Field label="Password">
            <TextInput type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
        )}

        {error && <div style={{ fontSize: 12, color: C.coral, marginBottom: 10 }}>{error}</div>}
        {info && <div style={{ fontSize: 12, color: C.sage, marginBottom: 10 }}>{info}</div>}

        <Button type="submit" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : mode === "signin" ? <Lock size={13} /> : <Mail size={13} />}
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create shared account" : "Send reset link"}
        </Button>

        <div style={{ textAlign: "center", marginTop: 14, fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {mode === "signin" && (
            <>
              <span style={{ color: C.inkSoft }}>First time setting this up? <a href="#" onClick={(e) => { e.preventDefault(); setMode("signup"); setError(""); setInfo(""); }} style={{ color: C.teal, fontWeight: 600 }}>Create the family account</a></span>
              <span style={{ color: C.inkSoft }}><a href="#" onClick={(e) => { e.preventDefault(); setMode("forgot"); setError(""); setInfo(""); }} style={{ color: C.teal, fontWeight: 600 }}>Forgot the password?</a></span>
            </>
          )}
          {mode === "signup" && (
            <span style={{ color: C.inkSoft }}>Already set up? <a href="#" onClick={(e) => { e.preventDefault(); setMode("signin"); setError(""); setInfo(""); }} style={{ color: C.teal, fontWeight: 600 }}>Sign in</a></span>
          )}
          {mode === "forgot" && (
            <span style={{ color: C.inkSoft }}>Remembered it? <a href="#" onClick={(e) => { e.preventDefault(); setMode("signin"); setError(""); setInfo(""); }} style={{ color: C.teal, fontWeight: 600 }}>Sign in</a></span>
          )}
        </div>
      </form>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.cream, fontFamily: "'Public Sans', sans-serif", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <Loader2 className="animate-spin" size={22} style={{ marginRight: 8 }} /> Loading…
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Main App                                                              */
/* ---------------------------------------------------------------------- */
export default function AppRoot() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <LoadingScreen />;
  if (recovering) return <SetNewPasswordScreen onDone={() => setRecovering(false)} />;
  if (!session) return <AuthScreen />;
  return <WaypointLedger session={session} />;
}

function SetNewPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      onDone();
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, paddingTop: "calc(20px + env(safe-area-inset-top))", paddingBottom: "calc(20px + env(safe-area-inset-bottom))", fontFamily: "'Public Sans', sans-serif" }}>
      <form onSubmit={submit} style={{ background: C.paper, borderRadius: 12, padding: 26, width: "100%", maxWidth: 360 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 700, color: C.ink, marginBottom: 10 }}>Set a new password</div>
        <Field label="New password">
          <TextInput type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoFocus />
        </Field>
        {error && <div style={{ fontSize: 12, color: C.coral, marginBottom: 10 }}>{error}</div>}
        <Button type="submit" style={{ width: "100%", justifyContent: "center" }} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />} Update password
        </Button>
      </form>
    </div>
  );
}

function WaypointLedger({ session }) {
  const userId = session.user.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const [openMemberId, setOpenMemberId] = useState(null);
  const [openTripId, setOpenTripId] = useState("");
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error | conflict
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const lastUpdatedAtRef = useRef(null);
  const panelOpenRef = useRef(false);
  const pendingRef = useRef(null); // holds the last failed/conflicted payload for retry

  useEffect(() => {
    panelOpenRef.current = !!openMemberId || !!openTripId || showAddMember;
  }, [openMemberId, openTripId, showAddMember]);

  useEffect(() => {
    (async () => {
      const res = await loadData(userId);
      setData(res.value);
      lastUpdatedAtRef.current = res.updatedAt;
      setLoading(false);
    })();
  }, [userId]);

  // Live sync: pick up changes made from another device/session. Skipped
  // while a panel is open so it can't yank data out from under an active
  // edit — the next save will detect the conflict safely instead.
  useEffect(() => {
    const channel = supabase
      .channel("waypoint_data_" + userId)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "waypoint_data", filter: `user_id=eq.${userId}` },
        (payload) => {
          if (panelOpenRef.current) return;
          if (payload.new.updated_at === lastUpdatedAtRef.current) return; // our own write echoing back
          setData(payload.new.data);
          lastUpdatedAtRef.current = payload.new.updated_at;
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const persist = useCallback(async (next) => {
    setData(next);
    setSaveStatus("saving");
    const result = await saveData(userId, next, lastUpdatedAtRef.current);
    if (result.ok) {
      lastUpdatedAtRef.current = result.updatedAt;
      pendingRef.current = null;
      setSaveStatus("saved");
    } else if (result.conflict) {
      pendingRef.current = next;
      const fresh = await loadData(userId);
      setData(fresh.value);
      lastUpdatedAtRef.current = fresh.updatedAt;
      setSaveStatus("conflict");
    } else {
      pendingRef.current = next;
      setSaveStatus("error");
    }
  }, [userId]);

  const retrySave = () => {
    if (pendingRef.current) persist(pendingRef.current);
  };

  const deleteAccount = async () => {
    try {
      await supabase.rpc("delete_user_account");
    } catch (e) {
      console.error("Account deletion failed", e);
    }
    await supabase.auth.signOut();
  };

  if (loading || !data) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.cream, fontFamily: "'Public Sans', sans-serif", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <Loader2 className="animate-spin" size={22} style={{ marginRight: 8 }} /> Loading ledger…
      </div>
    );
  }

  const members = data.members;
  const trips = data.trips;

  const addMember = (m) => persist({ ...data, members: [...members, m] });
  const updateMember = (m) => persist({ ...data, members: members.map((x) => x.id === m.id ? m : x) });
  const deleteMember = (id) => {
    persist({
      ...data,
      members: members.filter((m) => m.id !== id),
      trips: trips.map((t) => ({ ...t, travelers: t.travelers.filter((tr) => tr.memberId !== id) })),
    });
    setOpenMemberId(null);
  };

  const syncPtoLedgers = (mem, trip) => {
    return mem.map((m) => {
      const cleaned = (m.ledger || []).filter((e) => e.tripId !== trip.id);
      const tr = trip.travelers.find((t) => t.memberId === m.id);
      if (tr && tr.ptoDays > 0 && currentJob(m)) {
        cleaned.push({ id: uid(), date: trip.startDate, type: "use", days: -Math.abs(tr.ptoDays), note: `Trip: ${trip.title}`, tripId: trip.id });
      }
      return { ...m, ledger: cleaned };
    });
  };

  const upsertTrip = (t) => {
    const nextMembers = syncPtoLedgers(members, t);
    const exists = trips.some((x) => x.id === t.id);
    const nextTrips = exists ? trips.map((x) => (x.id === t.id ? t : x)) : [...trips, t];
    persist({ ...data, members: nextMembers, trips: nextTrips });
  };
  const deleteTrip = (id) => {
    const nextMembers = members.map((m) => ({ ...m, ledger: (m.ledger || []).filter((e) => e.tripId !== id) }));
    persist({ ...data, members: nextMembers, trips: trips.filter((t) => t.id !== id) });
    setOpenTripId("");
  };
  const updateActivityExtras = (nextExtras) => {
    persist({ ...data, activityExtras: nextExtras });
  };

  const sorted = [...trips].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  const upcoming = sorted.filter((t) => tripStatus(t) !== "past");
  const past = sorted.filter((t) => tripStatus(t) === "past").reverse();

  const yearNow = new Date().getFullYear();
  const spentThisYear = trips.filter((t) => new Date(t.startDate).getFullYear() === yearNow)
    .reduce((s, t) => s + (t.expenses || []).reduce((s2, e) => s2 + Number(e.amount || 0), 0), 0);
  const ptoUsedThisYear = members.reduce((s, m) => s + (m.ledger || []).filter((e) => e.type === "use" && new Date(e.date).getFullYear() === yearNow).reduce((s2, e) => s2 + Math.abs(e.days), 0), 0);

  const openMember = members.find((m) => m.id === openMemberId);
  const openTrip = openTripId === "__new__" ? { id: uid(), title: "", destination: "", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), budget: 0, notes: "", travelers: [], expenses: [], regionCountry: "", regionState: "", packingChecked: [], activities: [], packingHidden: [], packingCustom: [] } : trips.find((t) => t.id === openTripId);

  const statusText = { idle: "", saving: "saving…", saved: "saved", error: "couldn't save", conflict: "reloaded — please redo your last change" }[saveStatus];
  const statusColor = saveStatus === "error" || saveStatus === "conflict" ? C.coral : C.creamDim;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, backgroundImage: `radial-gradient(circle at 20% 0%, ${C.bgAlt2} 0%, ${C.bg} 60%)`, paddingTop: "env(safe-area-inset-top)", paddingBottom: "calc(60px + env(safe-area-inset-bottom))", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      {/* Header */}
      <div style={{ padding: "26px 20px 20px", maxWidth: 920, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: C.brass, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Plane size={20} color={C.bg} />
            </div>
            <div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 700, color: C.cream, letterSpacing: "0.01em" }}>Waypoint Ledger</div>
              <div style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 12, color: statusColor }}>Family PTO, trips & spending — {statusText}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant="ghost" onClick={() => setShowAddMember(true)}><Users size={14} /> Family</Button>
            <Button onClick={() => setOpenTripId("__new__")}><Plus size={14} /> New trip</Button>
            <Button variant="ghost" onClick={() => supabase.auth.signOut()}><LogOut size={14} /></Button>
          </div>
        </div>

        {(saveStatus === "error" || saveStatus === "conflict") && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(190,90,62,0.15)", border: `1px solid ${C.coral}`, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: C.cream }}>
              {saveStatus === "error" ? "That last change couldn't be saved — check your connection." : "Someone else saved changes at the same time, so we reloaded the latest data. Your last edit may need to be redone."}
            </span>
            {saveStatus === "error" && <Button variant="ghost" onClick={retrySave} style={{ padding: "4px 10px" }}>Retry</Button>}
          </div>
        )}

        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button onClick={() => setShowDeleteAccount(true)} style={{ background: "none", border: "none", cursor: "pointer", color: C.creamDim, fontSize: 10.5, textDecoration: "underline", padding: 0 }}>Delete account & all data</button>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: C.creamDim }}>
            Currency:
            <select
              value={data.currency || "USD"}
              onChange={(e) => persist({ ...data, currency: e.target.value })}
              style={{ background: C.bgAlt, color: C.cream, border: `1px solid ${C.bgAlt2}`, borderRadius: 4, fontSize: 10.5, padding: "2px 4px" }}
            >
              {["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "MXN", "NZD", "CHF", "INR"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        {/* Stat strip */}
        <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
          {[
            { label: `Trips ${yearNow}`, value: trips.filter((t) => new Date(t.startDate).getFullYear() === yearNow).length },
            { label: `Spent ${yearNow}`, value: fmtMoney(spentThisYear, data.currency || "USD") },
            { label: `PTO used ${yearNow}`, value: `${fmtDays(ptoUsedThisYear)} days` },
          ].map((s) => (
            <div key={s.label} style={{ background: C.bgAlt, border: `1px solid ${C.bgAlt2}`, borderRadius: 10, padding: "10px 16px", minWidth: 120 }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 600, color: C.brass }}>{s.value}</div>
              <div style={{ fontSize: 10.5, color: C.creamDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Family */}
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "0 20px" }}>
        <div style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.creamDim, marginBottom: 10 }}>Family</div>
        {members.length === 0 ? (
          <div onClick={() => setShowAddMember(true)} style={{ border: `1px dashed ${C.bgAlt2}`, borderRadius: 10, padding: 20, textAlign: "center", color: C.creamDim, cursor: "pointer", fontFamily: "'Public Sans', sans-serif", fontSize: 13 }}>
            No family members yet — click to add the first one.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 14 }}>
              {members.filter((m) => m.type === "adult" && currentJob(m) && currentJob(m).policyType !== "unlimited")
                .map((m) => <MemberTag key={m.id} member={m} onOpen={() => setOpenMemberId(m.id)} />)}
            </div>
            {members.some((m) => m.type === "kid" || !currentJob(m) || currentJob(m)?.policyType === "unlimited") && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: -4, marginBottom: 16 }}>
                <span style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11, color: C.creamDim }}>Also in the family:</span>
                {members.filter((m) => m.type === "kid" || !currentJob(m) || currentJob(m)?.policyType === "unlimited").map((m) => (
                  <button key={m.id} onClick={() => setOpenMemberId(m.id)} style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 14, background: "transparent", color: C.creamDim, border: `1px solid ${C.bgAlt2}`, cursor: "pointer" }}>
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Trips */}
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "10px 20px 0" }}>
        <div style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.creamDim, margin: "16px 0 10px" }}>Upcoming & active</div>
        {upcoming.length === 0 && <div style={{ color: C.creamDim, fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>No trips planned yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {upcoming.map((t) => <TripCard key={t.id} trip={t} members={members} onOpen={() => setOpenTripId(t.id)} currency={data.currency || "USD"} />)}
        </div>

        {past.length > 0 && (
          <>
            <div style={{ fontFamily: "'Public Sans', sans-serif", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.creamDim, margin: "26px 0 10px" }}>Past trips</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: 0.85 }}>
              {past.map((t) => <TripCard key={t.id} trip={t} members={members} onOpen={() => setOpenTripId(t.id)} currency={data.currency || "USD"} />)}
            </div>
          </>
        )}
      </div>

      {showAddMember && <AddMemberModal onClose={() => setShowAddMember(false)} onAdd={(m) => { addMember(m); setShowAddMember(false); }} />}
      {showDeleteAccount && (
        <ConfirmDialog
          title="Delete account & all data?"
          message="This permanently deletes the shared family login and every family member, trip, expense, and PTO record tied to it. This cannot be undone."
          confirmLabel="Delete everything"
          onCancel={() => setShowDeleteAccount(false)}
          onConfirm={deleteAccount}
        />
      )}
      {openMember && <MemberPanel member={openMember} onClose={() => setOpenMemberId(null)} onUpdate={updateMember} onDelete={deleteMember} />}
      {openTrip && <TripPanel trip={openTrip} members={members} onClose={() => setOpenTripId("")} onUpdate={upsertTrip} onDelete={deleteTrip} activityExtras={data.activityExtras || {}} onUpdateActivityExtras={updateActivityExtras} currency={data.currency || "USD"} />}
    </div>
  );
}
