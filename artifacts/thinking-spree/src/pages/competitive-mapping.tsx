// @ts-nocheck
import React, { useState, useEffect, useRef } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip,
} from "recharts";
import {
  Globe, FileText, Link2, Building2, Check, Lock, ChevronRight, ChevronLeft, X,
  Sparkles, TrendingUp, Layers, Target, ListOrdered, GitBranch, Route, FileSpreadsheet,
  ArrowUp, ArrowDown, Plus, Zap, Users, Loader2, ExternalLink, Search, Send,
  MessageSquareText, Bot, Maximize2,
} from "lucide-react";
import { Layout } from "@/components/Layout";

// Same-origin API inside the suite (Express under /api). Every call throws on
// failure so the UI falls back to local behaviour and stays operational.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const apiEnabled = true;
const jf = (path: string, opts: any = {}) =>
  fetch(BASE + path, { credentials: "include", headers: { "content-type": "application/json" }, ...opts })
    .then((r) => { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });
const api = {
  createMap: (b: any) => jf("/api/competitive-maps", { method: "POST", body: JSON.stringify(b) }),
  loadCopilot: (id: any) => jf(`/api/competitive-maps/${id}/copilot`),
  askCopilot: (id: any, question: string, focusCompany: string) =>
    jf(`/api/competitive-maps/${id}/copilot`, { method: "POST", body: JSON.stringify({ question, focusCompany }) }),
  generateSheet: (payload: any) => jf("/api/competitive-maps/generate", { method: "POST", body: JSON.stringify(payload) }),
  fence: (b: any) => jf("/api/competitive-maps/fence", { method: "POST", body: JSON.stringify(b) }),
  bmc: (b: any) => jf("/api/competitive-maps/bmc", { method: "POST", body: JSON.stringify(b) }),
  inspSuggest: (b: any) => jf("/api/competitive-maps/inspiration/suggest", { method: "POST", body: JSON.stringify(b) }),
  inspAdd: (b: any) => jf("/api/competitive-maps/inspiration", { method: "POST", body: JSON.stringify(b) }),
};

/* ────────────────────────────────────────────────────────────────────────
   Thinking Spree — Competitive Mapping (v2)
   Ivory canvas · deep-navy ink · brass gold · Instrument Serif + Inter.
   Front-end prototype; scrape + AI steps are simulated with real timing.
   AI routing: light tasks → Gemini 3.5 Flash-Lite, heavy tasks → 3.5 Flash.
   ──────────────────────────────────────────────────────────────────────── */

const C = {
  bg: "#FCFBF7", ink: "#1B2233", navy: "#1D2E5C", sidebar: "#141B2B",
  gold: "#DFA23B", goldSoft: "#F6E6C6", success: "#2D8659",
  border: "#DCDFE6", muted: "#5E6472", card: "#FFFFFF", faint: "#F1F0EA", link: "#1D4E9B",
};
const serif = "'Instrument Serif', Georgia, 'Times New Roman', serif";
const sans = "'Inter', ui-sans-serif, system-ui, sans-serif";
const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";

const STAGES = [
  { key: "feed", label: "Data Feed", icon: FileText },
  { key: "overview", label: "Company Overview", icon: Building2 },
  { key: "fencing", label: "Fencing", icon: Search },
  { key: "prioritize", label: "Prioritize", icon: ListOrdered },
  { key: "breakdown", label: "Breakdown", icon: Layers },
  { key: "inspiration", label: "Inspiration", icon: Route },
  { key: "generate", label: "Generate Sheet", icon: FileSpreadsheet },
];

/* ── companies (for tint / logo initials) ──────────────────────────────── */
const CO = {
  statiq: { name: "Statiq", tint: "#2E7D66" }, bolt: { name: "Bolt.Earth", tint: "#C6552E" },
  jiobp: { name: "Jio-BP Pulse", tint: "#1D4E9B" }, mojo: { name: "Mojo Green", tint: "#3B7D3B", star: true },
  spark: { name: "SparkCharge", tint: "#7A4FB5", star: true }, ecoflow: { name: "EcoFlow", tint: "#C08A2E" },
  hopcharge: { name: "Hopcharge", tint: "#2E6C8F" }, chargezone: { name: "ChargeZone", tint: "#0E7C7B" },
  tata: { name: "Tata Power EZ", tint: "#1B4D8F" }, ather: { name: "Ather Grid", tint: "#178A5B" },
  exicom: { name: "Exicom", tint: "#9A3D6E" }, delta: { name: "Delta Electronics", tint: "#B5852E" },
  kazam: { name: "Kazam", tint: "#5C6BC0" }, glida: { name: "Glida", tint: "#7A5230" },
  servotech: { name: "Servotech", tint: "#A0522D" },
};
// Companies that have clearly scaled beyond Quintinno's ARR / valuation — the ones
// Fencing exists to surface. Smaller direct analogs still appear but aren't flagged.
const SCALED_BEYOND = new Set(["statiq", "bolt", "jiobp", "spark", "ecoflow", "chargezone", "tata", "ather", "exicom", "delta", "glida", "servotech"]);

/* ── overview (subject company) ────────────────────────────────────────── */
const OVERVIEW = {
  name: "Quintinno Labs", tagline: "Portable, modular fast-charging for EVs — power that comes to the vehicle.",
  website: "quintinnolabs.com", founded: "2021", hq: "Bengaluru, India", stage: "Series A",
  growth: [{ y: "FY22", rev: 4 }, { y: "FY23", rev: 11 }, { y: "FY24", rev: 34 }, { y: "FY25", rev: 78 }, { y: "FY26e", rev: 150 }],
  metrics: [
    { label: "ARR (FY25)", value: "₹78 Cr", note: "+129% YoY" }, { label: "Units deployed", value: "3,400", note: "22 cities" },
    { label: "B2B fleet clients", value: "48", note: "logistics + cabs" }, { label: "Avg. utilisation", value: "63%", note: "per charger / day" },
  ],
  products: [
    { name: "Quint Portable DC", rev: "₹41 Cr", seg: "B2B", problem: "Fleet depots lack fixed fast-charging; grid upgrades take 6–9 months.", uses: ["Depot top-up between shifts", "On-demand roadside rescue", "Event / pop-up charging"] },
    { name: "Quint Swap Modules", rev: "₹22 Cr", seg: "B2B", problem: "2/3-wheeler downtime during charging kills gig-driver earnings.", uses: ["Battery-as-a-service for gig fleets", "Micro-swap kiosks at fuel stations"] },
    { name: "Quint Home Compact", rev: "₹15 Cr", seg: "B2C", problem: "Apartment owners can't install fixed wall chargers in shared parking.", uses: ["Portable overnight home charge", "Shared-society rotating charger"] },
  ],
};
const AI_DIRECTIONS = [
  { t: "Portability as the wedge", r: "Only 2 named peers ship a truly portable DC unit — Quint's clearest point of difference to defend." },
  { t: "Fleet-first go-to-market", r: "B2B fleet is 80% of revenue; comparables that cracked fleet economics teach the most about unit economics at scale." },
  { t: "Battery-swap adjacency", r: "Swap and portable-charge markets are converging; swap-native players reveal where Quint's roadmap may collide." },
];

/* ── FENCING: full research-grid columns (mirrors the master sheet) ────── */
const FCOLS = [
  { g: "id", k: "sr", label: "Sr. No", w: 46, sticky: 0 },
  { g: "id", k: "company", label: "Company", w: 132, sticky: 46 },
  { g: "id", k: "product", label: "Product", w: 150 },
  { g: "id", k: "image", label: "Product Image", w: 118 },
  { g: "demand", k: "useCase", label: "Use Case", w: 220 },
  { g: "demand", k: "audience", label: "Target Audience (from whom monetisation happens)", w: 210 },
  { g: "demand", k: "segD", label: "B2C / B2B", w: 66 },
  { g: "demand", k: "detailsD", label: "Details — demand-side profile", w: 240 },
  { g: "demand", k: "problemD", label: "Problem Statement", w: 210 },
  { g: "demand", k: "vpD", label: "Value Proposition", w: 210 },
  { g: "supply", k: "supplyTG", label: "User / Supply Target Group", w: 160 },
  { g: "supply", k: "segS", label: "B2C / B2B", w: 66 },
  { g: "supply", k: "detailsS", label: "Details — supply-side profile", w: 220 },
  { g: "supply", k: "problemS", label: "Problem Statement", w: 200 },
  { g: "supply", k: "vpS", label: "Value Proposition", w: 200 },
  { g: "product", k: "prodDesc", label: "Product Description", w: 230 },
  { g: "product", k: "prodFeat", label: "Product Features", w: 230 },
  { g: "gtm", k: "tgJourney", label: "Target Group Journey (Post Purchase)", w: 210 },
  { g: "gtm", k: "supplyJourney", label: "Supply Target Group Journey", w: 200 },
  { g: "gtm", k: "relTG", label: "Relationship with TG", w: 190 },
  { g: "gtm", k: "mktg", label: "Marketing Channels", w: 190 },
  { g: "gtm", k: "sales", label: "Sales Channels", w: 180 },
  { g: "gtm", k: "people", label: "Key People (Founders / CXOs)", w: 180 },
  { g: "gtm", k: "activities", label: "Key Activities", w: 180 },
  { g: "gtm", k: "resources", label: "Key Resources", w: 180 },
  { g: "gtm", k: "pricing", label: "Pricing", w: 170 },
  { g: "gtm", k: "partners", label: "Key Partners (Outsourced)", w: 180 },
  { g: "fin", k: "estRev", label: "Est. Company Revenue", w: 130 },
  { g: "fin", k: "segPct", label: "Segment %", w: 84 },
  { g: "fin", k: "revenue", label: "Revenue", w: 110 },
  { g: "fin", k: "revHw", label: "Revenue — Hardware", w: 120 },
  { g: "fin", k: "ppu", label: "Price / unit", w: 100 },
  { g: "fin", k: "qtySold", label: "Quantity Sold", w: 96 },
  { g: "fin", k: "revSw", label: "Revenue — Software", w: 120 },
  { g: "fin", k: "earnStation", label: "Earnings / Station", w: 120 },
  { g: "fin", k: "quantity", label: "Quantity", w: 84 },
  { g: "fin", k: "totalCost", label: "Total Cost", w: 100 },
  { g: "fin", k: "varCost", label: "Variable Costs", w: 110 },
  { g: "fin", k: "varCostU", label: "Var. Cost / unit", w: 100 },
  { g: "fin", k: "fixedCost", label: "Fixed Cost", w: 100 },
  { g: "fin", k: "pl", label: "Profit / Loss", w: 100 },
  { g: "fund", k: "fundStage", label: "Funding Stage", w: 110 },
  { g: "fund", k: "raised", label: "Amount Raised (₹ Cr)", w: 120 },
  { g: "fund", k: "valuation", label: "Valuation (₹ Cr)", w: 110 },
  { g: "fund", k: "valMult", label: "Last Val ÷ Revenue", w: 120 },
  { g: "fund", k: "investors", label: "Investors", w: 190 },
];
const GROUPS = {
  id: { label: "Identity", color: C.navy }, demand: { label: "Demand-side Target Group", color: "#2E6C8F" },
  supply: { label: "Supply-side Target Group", color: "#2E7D66" }, product: { label: "Product", color: "#8A5A12" },
  gtm: { label: "GTM & Operations", color: "#6A4FB5" }, fin: { label: "Financials", color: "#9A3D6E" },
  fund: { label: "Funding", color: "#B5852E" },
};

const NA = "NA";
// helper to build a row with defaults NA for unspecified fin/fund fields
const row = (o) => ({
  segPct: NA, revenue: NA, revHw: NA, ppu: NA, qtySold: NA, revSw: NA, earnStation: NA, quantity: NA,
  totalCost: NA, varCost: NA, varCostU: NA, fixedCost: NA, pl: NA, estRev: NA, fundStage: NA, raised: NA,
  valuation: NA, valMult: NA, investors: NA, ...o,
});

const FROWS = [
  row({ sr: "1", company: "statiq", product: "Statiq Circle EV Charger", useCase: "EV owners in apartments (P1) and independent houses; builders, offices, hotels, cafes and paid parking offering charging to guests.", audience: "EV owners; new apartments / society builders", segD: "B2C", detailsD: "Anyone owning an EV (except captive Tata/OEM users) in top metros; tech-comfortable, 25–45, mid–high income.", problemD: "Apartment owners lack a compact charger and access to a public network.", vpD: "Remote start/stop, anti-theft, compact 3.3 kW unit + access to the Statiq network — owners can even earn by renting it out.", supplyTG: "Society builders, offices, hotels", segS: "B2B", detailsS: "Property owners wanting to offer charging as an amenity / revenue line.", problemS: "No easy way to monetise parking with charging.", vpS: "Turnkey networked charger with billing + metering.", prodDesc: "Compact charging station for 2/3/4-wheelers, 3.3 kW.", prodFeat: "App control, auto cut-off, surge protection, RFID, IP64, IoT-enabled.", tgJourney: "Discover on app → book → plug → auto-billed → rate.", supplyJourney: "Onboard site → list on network → earn per session.", relTG: "App-first, self-serve, community reviews.", mktg: "App-store, social, society tie-ups.", sales: "Direct app + builder partnerships.", people: "Akshit Bansal (CEO), Raghav Arora (CTO).", activities: "Network ops, app + hardware dev.", resources: "Charger IP, pan-India network.", pricing: "Hardware ₹ + per-kWh session fee.", partners: "OEM cell suppliers, society builders.",
    estRev: "₹95 Cr", segPct: "38%", revenue: "₹36 Cr", revHw: "₹22 Cr", ppu: "₹28,000", qtySold: "7,800", earnStation: "₹1.8L/yr", pl: "Loss", fundStage: "Series A", raised: "62", valuation: "560", valMult: "5.9×", investors: "Macquarie, Shell Ventures" }),
  row({ sr: "2", company: "statiq", product: "Statiq Pillar EV Charger", useCase: "Overnight-stay hotels and offices giving charging to guests/employees; malls, cinemas and outer-city parking.", audience: "Overnight hotels, offices", segD: "B2B", detailsD: "Hospitality + corporate parks wanting fast overnight charge for guests.", problemD: "Guests arrive with low charge and want a full battery by morning.", vpD: "Wi-Fi + Bluetooth, hands-free billing, auto cut-off — owners needn't supervise.", supplyTG: "Hotels, corporate parks", segS: "B2B", detailsS: "Medium-large properties with parking footprint.", problemS: "Idle parking → want a differentiated amenity.", vpS: "Branded networked pillar with reporting.", prodDesc: "11 kW AC charger, Type-2 + 3.3 kW socket.", prodFeat: "IP54, IoT, Bluetooth, RFID; full charge 0.8–3 hrs.", tgJourney: "Check-in → charge overnight → billed to room/app.", supplyJourney: "Install → brand → monthly settlement.", relTG: "Amenity-led, low-touch.", mktg: "Hospitality partnerships, B2B sales.", sales: "Field sales + channel.", people: "Akshit Bansal (CEO).", activities: "B2B deployment, servicing.", resources: "Pillar hardware, service techs.", pricing: "CapEx sale or RevShare.", partners: "AC-charger OEMs.", estRev: "₹95 Cr", segPct: "26%", revenue: "₹25 Cr", revHw: "₹18 Cr", ppu: "₹95,000", qtySold: "1,900", fundStage: "Series A", raised: "62", valuation: "560", valMult: "5.9×", investors: "Macquarie, Shell Ventures" }),
  row({ sr: "3", company: "statiq", product: "CCS Charger (Statiq)", useCase: "Parking plazas, mall/metro parking, petrol pumps and gas stations for quick top-up while people shop.", audience: "Charging stations, petrol pumps", segD: "B2B", detailsD: "CPOs and fuel retailers building public fast-charge points.", problemD: "Public EV users need a fast charge and go.", vpD: "60 kW DC fast charge for 4-wheelers, hassle-free billing.", supplyTG: "CPOs, fuel retail", segS: "B2B", detailsS: "High-footfall commercial sites.", problemS: "Need fast throughput per bay.", vpS: "DC hardware + network integration.", prodDesc: "60 kW DC fast charger, 4-wheeler.", prodFeat: "IP64, IoT, RFID; 40–60 min full charge.", tgJourney: "Arrive → fast charge 40 min → pay app.", supplyJourney: "Site prep → grid → commission.", relTG: "Utility, speed-led.", mktg: "Fuel-retail tie-ups.", sales: "Enterprise CPO sales.", people: "Akshit Bansal (CEO).", activities: "DC deployment, grid mgmt.", resources: "DC chargers, network.", pricing: "Per-kWh + demand charge.", partners: "Grid, fuel retailers.", estRev: "₹95 Cr", segPct: "36%", revenue: "₹34 Cr", earnStation: "₹4.2L/yr", fundStage: "Series A", raised: "62", valuation: "560", valMult: "5.9×", investors: "Macquarie, Shell Ventures" }),
  row({ sr: "4", company: "bolt", product: "Level 1 Charger — Bolt.Earth Lite", useCase: "Individuals in apartments needing a safe personal charge point where societies don't provide one.", audience: "Individual EV owners in apartments", segD: "B2C", detailsD: "Metro 2/3-wheeler owners; value + safety conscious.", problemD: "Shared plug points get misused; no authentication.", vpD: "Authenticated multi-brand charging for 2/3-wheelers.", supplyTG: "Societies / apartments", segS: "B2C", detailsS: "RWAs enabling resident charging.", problemS: "Unmetered power theft.", vpS: "Cheap IoT point with auth.", prodDesc: "Smart light-duty AC point (Lite).", prodFeat: "Multi-brand, app auth, surge cut-off, LED indicators.", tgJourney: "Buy → mount → app-auth charge.", supplyJourney: "RWA installs → residents subscribe.", relTG: "Affordable, DIY.", mktg: "D2C online, EV dealerships.", sales: "E-commerce + dealer.", people: "Mohit Yadav (Founder).", activities: "IoT hardware at scale.", resources: "Largest point network (India).", pricing: "₹ low CapEx + app.", partners: "2W OEMs.", estRev: "₹120 Cr", segPct: "22%", revenue: "₹26 Cr", ppu: "₹4,500", qtySold: "58,000", fundStage: "Series A", raised: "40", valuation: "410", valMult: "3.4×", investors: "Union Square Ventures, Prime VP" }),
  row({ sr: "5", company: "bolt", product: "Level 2 Charger — Bolt.Earth", useCase: "EV owners in societies/bungalows; commercial parking at hotels, cafes and offices on city outskirts / highways.", audience: "4-wheeler EV owners", segD: "B2B", detailsD: "Hospitality + commercial parking wanting paid charging.", problemD: "4W owners want to charge while dining / staying.", vpD: "Quick AC charging with app-based monitoring.", supplyTG: "4-wheeler owners", segS: "B2C", detailsS: "Owners needing charge while parked.", problemS: "Charge during a visit without waiting.", vpS: "Reserve + pay via app.", prodDesc: "AC charger 7.7 / 11 / 22 kW variants.", prodFeat: "Smart auto power cut-off, surge protection, 5m cable.", tgJourney: "Reserve → arrive → charge → pay.", supplyJourney: "Onboard venue → monitor via app.", relTG: "Convenience-led.", mktg: "Venue partnerships.", sales: "B2B + marketplace.", people: "Mohit Yadav (Founder).", activities: "Deployment, IoT ops.", resources: "IoT platform.", pricing: "CapEx + per-session.", partners: "Venue owners.", estRev: "₹120 Cr", segPct: "40%", revenue: "₹48 Cr", ppu: "₹42,000", qtySold: "11,400", fundStage: "Series A", raised: "40", valuation: "410", valMult: "3.4×", investors: "Union Square Ventures, Prime VP" }),
  row({ sr: "6", company: "bolt", product: "Level 3 DC Charger — Bolt.Earth", useCase: "Public parking (malls, petrol pumps), bus depots and fleet hubs needing high-throughput DC charging.", audience: "Commercial fleet owners, bus depots", segD: "B2B", detailsD: "Fleet operators, transport corporations, petrol pumps.", problemD: "Fleets need fast turnaround between routes.", vpD: "High-power DC with fleet management.", supplyTG: "Fleet + petrol pumps", segS: "B2B", detailsS: "Depots with grid capacity.", problemS: "Downtime = lost trips.", vpS: "DC + telemetry + billing.", prodDesc: "DC fast charger (fleet-grade).", prodFeat: "Load balancing, remote diagnostics, OCPP.", tgJourney: "Depot charge between shifts.", supplyJourney: "Grid upgrade → commission → operate.", relTG: "Enterprise SLA.", mktg: "Fleet BD.", sales: "Enterprise.", people: "Mohit Yadav (Founder).", activities: "DC ops, fleet SaaS.", resources: "DC hardware, SaaS.", pricing: "Per-kWh + SaaS.", partners: "Transport corps.", estRev: "₹120 Cr", segPct: "38%", revenue: "₹46 Cr", earnStation: "₹6.1L/yr", fundStage: "Series A", raised: "40", valuation: "410", valMult: "3.4×", investors: "Union Square Ventures, Prime VP" }),
  row({ sr: "7", company: "jiobp", product: "Jio-BP Pulse Station", useCase: "Public EV owners and highway corridors, co-located with fuel pumps for mass-market fast charging.", audience: "Any public EV owner", segD: "B2C", detailsD: "Mass-market metro + highway EV owners.", problemD: "Range anxiety on intercity trips.", vpD: "Dense, fuel-retail-backed public network at scale.", supplyTG: "Fuel dealers", segS: "B2B", detailsS: "Existing Jio-BP fuel outlets.", problemS: "Convert footfall to EV revenue.", vpS: "Ready site + brand + network.", prodDesc: "Public AC + DC fast-charge station.", prodFeat: "App payments, multi-connector, loyalty.", tgJourney: "Navigate → charge → Jio pay.", supplyJourney: "Retrofit pump → operate.", relTG: "Brand-trust, mass-market.", mktg: "Jio ecosystem, retail.", sales: "Owned network.", people: "Backed by RIL + bp JV.", activities: "Network rollout.", resources: "Fuel-retail footprint.", pricing: "Per-kWh public tariff.", partners: "bp, RIL.", estRev: "₹300 Cr+", segPct: NA, revenue: NA, fundStage: "JV (RIL × bp)", raised: NA, valuation: NA, investors: "Reliance, bp" }),
  row({ sr: "8", company: "mojo", product: "POKT Portable Charger", useCase: "Fleet depots, roadside rescue and temporary sites needing charging with no fixed grid connection — direct analog to Quint.", audience: "Fleet operators, depots", segD: "B2B", detailsD: "Last-mile + logistics fleets in Indian metros.", problemD: "Depots can't wait months for grid upgrades to add charging.", vpD: "Deploy portable DC in days, pay per use — no fixed CapEx.", supplyTG: "Depot / fleet ops", segS: "B2B", detailsS: "Operators scaling EV fleets fast.", problemS: "Grid + fixed infra bottleneck.", vpS: "Charging without grid upgrades.", prodDesc: "Portable battery-integrated DC charging unit.", prodFeat: "Movable, modular, app dispatch, telemetry.", tgJourney: "Order unit → deploy → charge → billed/kWh.", supplyJourney: "Assess site → drop unit → operate.", relTG: "Ops partner, high-touch.", mktg: "Fleet BD, pilots.", sales: "Direct B2B.", people: "Mojo Green founding team.", activities: "Portable unit assembly, field ops.", resources: "Portable DC IP, field network.", pricing: "Per-kWh + unit subscription.", partners: "Cell suppliers, fleet aggregators.", estRev: "₹18 Cr", segPct: "100%", revenue: "₹18 Cr", earnStation: "₹3.4L/yr", pl: "Loss", fundStage: "Seed+", raised: "22", valuation: "140", valMult: "7.8×", investors: "Angel + micro-VC" }),
  row({ sr: "9", company: "spark", product: "Roadie v2 Mobile Charger", useCase: "US fleets, dealerships and roadside rescue — 60% of deliveries are on-demand roadside charging.", audience: "Commercial fleets, dealerships", segD: "B2B", detailsD: "US fleets + dealer networks; enterprise buyers.", problemD: "Fixed charging can't scale ahead of fleet growth.", vpD: "Charging-as-a-Service — no installation, on-demand within hours.", supplyTG: "Fleet + dealership ops", segS: "B2B", detailsS: "Enterprise mobility operators.", problemS: "Uptime + flexibility.", vpS: "Mobile CaaS with telemetry + SLA.", prodDesc: "Mobile modular charging unit + dispatch platform.", prodFeat: "Battery-integrated, dispatch app, fleet dashboard.", tgJourney: "Request → dispatched → charged → SLA-billed.", supplyJourney: "Fleet contract → scheduled dispatch.", relTG: "Enterprise SLA, dashboard.", mktg: "OEM + enterprise BD.", sales: "Enterprise + OEM channel.", people: "Joshua Aviv (CEO/Founder).", activities: "Dispatch ops, CaaS.", resources: "Roadie IP, US ops footprint.", pricing: "CaaS subscription + per-session.", partners: "Ford Pro, dealerships, cell suppliers.", estRev: "$28M", segPct: "100%", revenue: "$28M", pl: "Loss", fundStage: "Series A", raised: "≈190 (₹)", valuation: NA, investors: "Volvo-adjacent, Mark Cuban, strategics" }),
  row({ sr: "10", company: "ecoflow", product: "Delta Pro Portable Power", useCase: "Consumers wanting home backup + occasional portable EV top-up; strong D2C channel.", audience: "Premium consumers", segD: "B2C", detailsD: "Global prosumers; home + outdoor.", problemD: "Need portable power incl. EV top-up.", vpD: "$1B+ portable-power brand, huge consumer reach.", supplyTG: "Retail / D2C", segS: "B2C", detailsS: "Online + big-box retail.", problemS: "Adjacent EV top-up demand.", vpS: "Modular battery ecosystem.", prodDesc: "Portable power station (adjacent to EV charging).", prodFeat: "Expandable capacity, app, fast recharge.", tgJourney: "Buy online → plug-and-play.", supplyJourney: "Retail distribution.", relTG: "Consumer brand loyalty.", mktg: "D2C, Amazon, YouTube.", sales: "E-commerce + retail.", people: "Global consumer-electronics team.", activities: "Consumer hardware, brand.", resources: "Brand, supply chain.", pricing: "One-time hardware sale.", partners: "Retail + marketplaces.", estRev: "$1B+", fundStage: "Late / PE", raised: NA, valuation: NA, investors: "Sequoia China (early)" }),
  row({ sr: "11", company: "hopcharge", product: "Doorstep Fast Charging", useCase: "Premium EV owners who want charging delivered to their doorstep via mobile units on subscription.", audience: "Premium 4W EV owners", segD: "B2C", detailsD: "High-income metro owners valuing convenience.", problemD: "No time / space to charge at home.", vpD: "Subscription doorstep charging via mobile units.", supplyTG: "Mobile-unit ops", segS: "B2B", detailsS: "Owned mobile fleet.", problemS: "Route density economics.", vpS: "Service-led model.", prodDesc: "Mobile off-grid fast-charging unit.", prodFeat: "Doorstep dispatch, app scheduling.", tgJourney: "Subscribe → schedule → charged at door.", supplyJourney: "Route planning → dispatch.", relTG: "Premium concierge.", mktg: "Premium D2C.", sales: "Subscription.", people: "Arjun Sharma / founding team.", activities: "Mobile dispatch ops.", resources: "Mobile units.", pricing: "Monthly subscription.", partners: "Cell + telematics.", estRev: "₹9 Cr", fundStage: "Seed", raised: "13", valuation: "95", valMult: "10.5×", investors: "Blume, angels" }),
  row({ sr: "12", company: "chargezone", product: "ChargeZone Hypercharger", useCase: "Highway corridors and city hubs needing ultra-fast DC charging for cars and e-buses.", audience: "Public + e-bus operators", segD: "B2B", detailsD: "Transport operators + public.", problemD: "Highway fast-charge gaps.", vpD: "Ultra-fast DC + e-bus depots at corridor scale.", supplyTG: "Transport corps", segS: "B2B", detailsS: "STUs + logistics.", problemS: "Bus depot throughput.", vpS: "High-power DC + O&M.", prodDesc: "Hyper DC charger up to 400 kW.", prodFeat: "Multi-connector, OCPP, load mgmt.", tgJourney: "Corridor charge → app pay.", supplyJourney: "Depot build → operate.", relTG: "Infra partner.", mktg: "Gov + transport BD.", sales: "Enterprise + gov.", people: "Kartikey Hariyani (Founder).", activities: "Corridor build-out.", resources: "DC hardware, sites.", pricing: "Per-kWh + O&M.", partners: "STUs, OEMs.", estRev: "₹70 Cr", fundStage: "Series B", raised: "88", valuation: "620", valMult: "8.9×", investors: "British Intl Investment" }),
  row({ sr: "13", company: "tata", product: "Tata Power EZ Home Charger", useCase: "Home charging for Tata EV owners and broader 4W owners across metros.", audience: "Home 4W EV owners", segD: "B2C", detailsD: "Tata Nexon/Tiago owners; mainstream.", problemD: "Reliable home charging + service.", vpD: "OEM-backed trusted home charging + service network.", supplyTG: "Home installers", segS: "B2B", detailsS: "Certified installer network.", problemS: "Install quality + safety.", vpS: "Certified install + warranty.", prodDesc: "AC home wallbox 7.2 kW.", prodFeat: "App, safety cut-off, OEM integration.", tgJourney: "Buy EV → bundled charger → install.", supplyJourney: "Installer onboarded → service.", relTG: "OEM trust.", mktg: "Tata dealer network.", sales: "OEM bundle + dealers.", people: "Tata Power leadership.", activities: "Install + network ops.", resources: "Tata brand + network.", pricing: "Bundled / CapEx.", partners: "Tata Motors dealers.", estRev: "₹250 Cr+", fundStage: "Corporate", raised: NA, valuation: NA, investors: "Tata Power" }),
  row({ sr: "14", company: "tata", product: "Tata Power EZ Public Fast Charger", useCase: "Public and commercial fast charging across Tata's national network.", audience: "Public EV owners", segD: "B2B", detailsD: "CPO sites nationwide.", problemD: "Public charging availability.", vpD: "Largest OEM-backed public network in India.", supplyTG: "Site partners", segS: "B2B", detailsS: "Malls, offices, pumps.", problemS: "Reliable uptime.", vpS: "Managed network + app.", prodDesc: "Public DC fast charger.", prodFeat: "Multi-connector, app, RFID.", tgJourney: "Locate on app → fast charge.", supplyJourney: "Site tie-up → operate.", relTG: "Trusted utility.", mktg: "Tata ecosystem.", sales: "Owned + partner sites.", people: "Tata Power leadership.", activities: "National rollout.", resources: "Brand, grid access.", pricing: "Public tariff /kWh.", partners: "Site owners.", estRev: "₹250 Cr+", fundStage: "Corporate", raised: NA, valuation: NA, investors: "Tata Power" }),
  row({ sr: "15", company: "ather", product: "Ather Grid Point Charger", useCase: "2-wheeler EV owners (Ather + others) using the Ather Grid public 2W network.", audience: "2W EV owners", segD: "B2C", detailsD: "Urban 2W commuters.", problemD: "2W-specific fast charging is scarce.", vpD: "Dense 2W-optimised public grid, free/low-cost.", supplyTG: "Retail sites", segS: "B2B", detailsS: "Cafes, malls hosting Grid.", problemS: "Footfall + brand.", vpS: "Branded 2W charge points.", prodDesc: "2W fast-charge grid point.", prodFeat: "App, fast 2W charge, connected.", tgJourney: "App locate → 2W charge.", supplyJourney: "Host point → footfall.", relTG: "Community, brand.", mktg: "Ather app + community.", sales: "Owned network.", people: "Tarun Mehta, Swapnil Jain.", activities: "2W grid ops.", resources: "Ather brand + app.", pricing: "Free / low /kWh.", partners: "Retail hosts.", estRev: "part of Ather", fundStage: "Public (parent)", raised: NA, valuation: NA, investors: "Hero MotoCorp, GIC" }),
  row({ sr: "16", company: "exicom", product: "Harmony DC Fast Charger", useCase: "OEM and CPO fast-charging hardware supply plus fleet depots.", audience: "CPOs, OEMs", segD: "B2B", detailsD: "Hardware buyers at scale.", problemD: "Need reliable DC hardware supply.", vpD: "Listed hardware maker with proven DC portfolio.", supplyTG: "OEM / CPO", segS: "B2B", detailsS: "Bulk hardware procurement.", problemS: "Quality + support.", vpS: "Manufacturing scale + warranty.", prodDesc: "Harmony DC series 30–240 kW.", prodFeat: "OCPP, liquid-cooled, modular.", tgJourney: "Procure → deploy on own network.", supplyJourney: "Manufacture → ship.", relTG: "OEM supplier.", mktg: "B2B + tenders.", sales: "Enterprise + gov.", people: "Anant Nahata (MD).", activities: "Manufacturing, R&D.", resources: "Factories, IP.", pricing: "Hardware sale.", partners: "OEMs, CPOs.", estRev: "₹800 Cr (grp)", fundStage: "Listed (IPO)", raised: NA, valuation: "≈3,900", investors: "Public markets" }),
  row({ sr: "17", company: "delta", product: "Delta AC Max Charger", useCase: "Commercial AC charging for offices, malls and fleets; global hardware brand.", audience: "Commercial sites", segD: "B2B", detailsD: "Enterprise + property.", problemD: "Reliable commercial AC charging.", vpD: "Global power-electronics brand, high reliability.", supplyTG: "Property / fleet", segS: "B2B", detailsS: "Large commercial parking.", problemS: "Uptime at scale.", vpS: "Proven hardware + service.", prodDesc: "AC Max 22 kW commercial charger.", prodFeat: "OCPP, RFID, load balancing.", tgJourney: "Deploy → operate on network.", supplyJourney: "Manufacture → integrate.", relTG: "Global supplier.", mktg: "B2B global.", sales: "Enterprise channel.", people: "Delta Electronics leadership.", activities: "Manufacturing.", resources: "Global supply chain.", pricing: "Hardware sale.", partners: "System integrators.", estRev: "global", fundStage: "Listed (global)", raised: NA, valuation: NA, investors: "Public markets" }),
  row({ sr: "18", company: "kazam", product: "Kazam Smart AC Charger", useCase: "Affordable smart AC charging for societies, fleets and small businesses; software-led.", audience: "Societies, small fleets", segD: "B2C", detailsD: "Value-first metro + tier-2 users.", problemD: "Affordable smart metered charging.", vpD: "Low-cost hardware + strong CMS software layer.", supplyTG: "CPO / fleet SaaS", segS: "B2B", detailsS: "CPOs wanting white-label SaaS.", problemS: "Software + billing stack.", vpS: "White-label CMS platform.", prodDesc: "Smart AC charger + CMS SaaS.", prodFeat: "App, dynamic load, white-label CMS.", tgJourney: "Install → manage via CMS.", supplyJourney: "License CMS → operate.", relTG: "Affordable + SaaS.", mktg: "D2C + SaaS BD.", sales: "Hardware + SaaS.", people: "Vaibhav Tyagi, Akshay Shekhar.", activities: "Hardware + software.", resources: "CMS platform.", pricing: "Low CapEx + SaaS.", partners: "CPOs.", estRev: "₹40 Cr", fundStage: "Series A", raised: "30", valuation: "260", valMult: "6.5×", investors: "Alteria, angels" }),
  row({ sr: "19", company: "glida", product: "Glida Public Charging", useCase: "Public and fleet DC charging network (formerly Fortum Charge & Drive India).", audience: "Public + fleets", segD: "B2B", detailsD: "Metro public + fleets.", problemD: "Reliable managed public network.", vpD: "European-heritage managed CPO network.", supplyTG: "Site + fleet", segS: "B2B", detailsS: "Commercial sites.", problemS: "Uptime + roaming.", vpS: "Managed network + roaming.", prodDesc: "Public DC + AC network.", prodFeat: "Roaming, app, OCPP.", tgJourney: "App → charge → pay.", supplyJourney: "Site → operate.", relTG: "Managed utility.", mktg: "B2B + app.", sales: "Owned network.", people: "Glida leadership.", activities: "Network O&M.", resources: "Sites + platform.", pricing: "Per-kWh.", partners: "Site owners.", estRev: "₹55 Cr", fundStage: "PE-backed", raised: NA, valuation: NA, investors: "Fortum / PE" }),
  row({ sr: "20", company: "servotech", product: "Servotech DC Fast Charger", useCase: "Government tenders and CPO hardware supply plus solar-integrated charging.", audience: "Gov, CPOs", segD: "B2B", detailsD: "Tender + CPO buyers.", problemD: "Localised DC hardware supply.", vpD: "Listed maker winning large gov EV tenders.", supplyTG: "Gov / CPO", segS: "B2B", detailsS: "Public tenders.", problemS: "Volume supply.", vpS: "Local manufacturing scale.", prodDesc: "DC fast chargers 30–240 kW.", prodFeat: "OCPP, solar-ready, modular.", tgJourney: "Tender → deploy.", supplyJourney: "Manufacture → ship.", relTG: "Gov supplier.", mktg: "Tenders + B2B.", sales: "Gov + enterprise.", people: "Raman Bhatia (MD).", activities: "Manufacturing.", resources: "Factory, IP.", pricing: "Hardware sale.", partners: "Gov bodies.", estRev: "₹350 Cr (grp)", fundStage: "Listed", raised: NA, valuation: NA, investors: "Public markets" }),
];

/* ── BMC with clickable sources ────────────────────────────────────────── */
const L = (t, src) => ({ t, src });
const BMC_DATA = {
  mojo: {
    kp: [L("OEM battery-cell suppliers", "https://www.google.com/search?q=Mojo+Green+battery+cell+supplier"), L("Fleet aggregators (BluSmart-type)", "https://www.google.com/search?q=India+EV+fleet+aggregator+charging"), L("Fuel-retail site partners", "https://www.google.com/search?q=fuel+retail+EV+charging+India")],
    ka: [L("Portable unit assembly", "https://www.google.com/search?q=portable+DC+EV+charger+manufacturing"), L("Field-ops dispatch network", "https://www.google.com/search?q=mobile+EV+charging+dispatch")],
    vp: [L("Charging with zero fixed grid upgrade", "https://www.google.com/search?q=EV+charging+without+grid+upgrade"), L("Deploy in days, not quarters", "https://www.google.com/search?q=fast+deploy+EV+charging"), L("Pay-per-use OpEx model", "https://www.google.com/search?q=charging+as+a+service+opex")],
    cr: [L("Dedicated fleet account managers", "https://www.google.com/search?q=fleet+account+management+EV"), L("Self-serve dispatch app", "https://www.google.com/search?q=EV+charging+dispatch+app")],
    cs: [L("Last-mile logistics fleets", "https://www.google.com/search?q=last+mile+logistics+EV+fleet+India"), L("Depot operators without grid capacity", "https://www.google.com/search?q=EV+depot+grid+capacity")],
    kr: [L("Portable DC hardware IP", "https://www.google.com/search?q=portable+DC+charger+IP"), L("Field technician network", "https://www.google.com/search?q=EV+charging+field+technicians")],
    ch: [L("Direct B2B sales", "https://www.google.com/search?q=B2B+EV+charging+sales"), L("Fleet-aggregator partnerships", "https://www.google.com/search?q=fleet+aggregator+partnership+EV")],
    cost: [L("Hardware BOM & assembly", "https://www.google.com/search?q=EV+charger+BOM+cost"), L("Field-ops labour", "https://www.google.com/search?q=field+ops+cost+EV"), L("Battery replacement cycles", "https://www.google.com/search?q=EV+battery+replacement+cost")],
    rev: [L("Per-kWh usage fees", "https://www.google.com/search?q=per+kWh+charging+revenue"), L("Monthly unit subscription", "https://www.google.com/search?q=EV+charger+subscription"), L("Deployment / setup fees", "https://www.google.com/search?q=EV+charging+setup+fee")],
  },
  spark: {
    kp: [L("Ford Pro / OEM fleet programs", "https://www.google.com/search?q=SparkCharge+Ford+Pro"), L("Dealership networks", "https://www.google.com/search?q=SparkCharge+dealership"), L("Battery-module suppliers", "https://www.google.com/search?q=SparkCharge+battery+module")],
    ka: [L("Mobile charging dispatch", "https://www.google.com/search?q=SparkCharge+mobile+charging"), L("Charging-as-a-service ops", "https://www.google.com/search?q=charging+as+a+service")],
    vp: [L("Charging without any installation", "https://www.google.com/search?q=SparkCharge+no+installation"), L("On-demand roadside within hours", "https://www.google.com/search?q=SparkCharge+on+demand"), L("Scales ahead of fixed infra", "https://www.google.com/search?q=mobile+charging+scale")],
    cr: [L("Enterprise SLAs", "https://www.google.com/search?q=EV+charging+enterprise+SLA"), L("Fleet dashboard + telemetry", "https://www.google.com/search?q=SparkCharge+fleet+dashboard")],
    cs: [L("Commercial fleets", "https://www.google.com/search?q=SparkCharge+commercial+fleet"), L("Dealerships", "https://www.google.com/search?q=SparkCharge+dealership+charging"), L("Roadside-assistance networks", "https://www.google.com/search?q=EV+roadside+assistance+charging")],
    kr: [L("Roadie mobile-charger IP", "https://www.google.com/search?q=SparkCharge+Roadie"), L("US ops footprint", "https://www.google.com/search?q=SparkCharge+coverage+US")],
    ch: [L("Enterprise sales", "https://www.google.com/search?q=SparkCharge+enterprise+sales"), L("OEM channel partnerships", "https://www.google.com/search?q=SparkCharge+OEM+partnership")],
    cost: [L("Mobile unit capex", "https://www.google.com/search?q=mobile+charger+capex"), L("Dispatch logistics", "https://www.google.com/search?q=charging+dispatch+logistics"), L("R&D", "https://www.google.com/search?q=SparkCharge+R%26D")],
    rev: [L("CaaS subscription", "https://www.google.com/search?q=charging+as+a+service+subscription"), L("Per-session charging", "https://www.google.com/search?q=per+session+charging+fee"), L("Hardware leasing", "https://www.google.com/search?q=EV+charger+leasing")],
  },
};

/* ── Inspiration: pre-seeded aspirational giants + generator ───────────── */
const INSP_TEMPLATE = (name) => ({
  who: name, generated: true,
  phases: [
    { era: "Year 1–2", product: `${name} started with a focused core product and iterated toward its first repeatable use-case.`, market: "Positioned narrowly against one clear pain before broadening.", funding: "Early seed capital; amounts largely undisclosed.", growth: "Prototype → first paying customers; small founding team.", customers: "Early adopters and pilot accounts." },
    { era: "Year 2–3", product: `${name} moved up the value chain from product to service/platform.`, market: "Repositioned around outcomes, not features.", funding: "First institutional round.", growth: "Multi-market expansion; headcount scaling.", customers: "First enterprise / anchor customers." },
    { era: "Year 3–4", product: `${name} scaled operations and added adjacent lines.`, market: "Category-leader positioning.", funding: "Growth round led by strategics.", growth: "Volume becomes the headline metric.", customers: "National / multi-site operators." },
    { era: "Year 4–5", product: `${name} became a platform others build on.`, market: "Ecosystem / platform play.", funding: "Late-stage / strategic co-investment.", growth: "Market-defining scale.", customers: "OEM channels and platform partners." },
  ],
});
const INSPIRATION = {
  spark: { who: "SparkCharge", phases: [
    { era: "2016–2018", product: "Founded around a portable, modular EV charger — Roadie — designed to charge without any fixed infrastructure.", market: "Positioned as 'charging that comes to you' — the anti-station pitch.", funding: "Seed + Techstars accelerator; modest, mostly undisclosed.", growth: "Prototype → first pilots; founding team under 10.", customers: "Early individual EV owners and pilot fleets." },
    { era: "2019–2020", product: "Shifted from selling hardware to Charging-as-a-Service; added telemetry + dispatch.", market: "Moved up the value chain from device maker to mobility-service operator.", funding: "Notable Shark Tank / Mark Cuban investment; expanded private rounds.", growth: "≈1 year of R&D to productionise CaaS; multi-city ops.", customers: "Dealerships and first commercial fleet contracts." },
    { era: "2021–2023", product: "Scaled mobile fleet-charging; 60% of deliveries became on-demand roadside.", market: "Enterprise fleet-first positioning with SLA-backed uptime.", funding: "$23M Series A led by strategic mobility investors.", growth: "Deployed across dozens of US metros; headcount into low hundreds.", customers: "Ford Pro programs, national dealership groups, logistics fleets." },
    { era: "2024–2025", product: "Broadened to depot + roadside + event charging on one dispatch platform.", market: "Platform play: 'flexible charging infrastructure', not a single device.", funding: "Continued strategic capital; OEM co-investment.", growth: "Charging-session volume the headline metric.", customers: "OEM fleet channels and multi-site logistics operators." },
  ]},
  chargepoint: { who: "ChargePoint", phases: [
    { era: "2007–2011", product: "Built networked charging stations + the software to manage them.", market: "Positioned as the network layer, not just hardware.", funding: "Early VC rounds to seed the network.", growth: "First thousands of ports; land-grab strategy.", customers: "Workplaces and municipalities." },
    { era: "2012–2017", product: "Doubled down on SaaS + subscriptions on top of hardware.", market: "'Largest network' positioning; recurring software revenue.", funding: "Multiple growth rounds ($100M+ cumulative).", growth: "Tens of thousands of ports across North America + Europe.", customers: "Fleets, retail, commercial real estate." },
    { era: "2018–2020", product: "Fleet + DC fast-charging lines; end-to-end management suite.", market: "Full-stack 'charging as a network + service'.", funding: "Large private rounds ahead of going public.", growth: "Hundreds of thousands of managed ports.", customers: "Enterprise fleets, automakers." },
    { era: "2021–2022", product: "Public-company scale; software the durable moat.", market: "Category-defining network + subscription platform.", funding: "SPAC listing; public markets.", growth: "Network + subscription revenue the headline.", customers: "Global fleets, OEMs, CPOs." },
  ]},
};

/* ── atoms ─────────────────────────────────────────────────────────────── */
const DataCtx = React.createContext<any>(null);
const useData = () => React.useContext(DataCtx);
const EMPTY_BMC = { kp: [], ka: [], kr: [], vp: [], cr: [], ch: [], cs: [], cost: [], rev: [] };
const isScaled = (r: any) => (r && typeof r.scaledBeyond === "boolean") ? r.scaledBeyond : SCALED_BEYOND.has(r?.company);
function hashTint(str: string) {
  let h = 0; for (let i = 0; i < (str || "").length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  const palette = ["#2E7D66", "#C6552E", "#1D4E9B", "#3B7D3B", "#7A4FB5", "#C08A2E", "#2E6C8F", "#0E7C7B", "#1B4D8F", "#178A5B", "#9A3D6E", "#B5852E", "#5C6BC0", "#7A5230", "#A0522D"];
  return palette[h % palette.length];
}
function buildCompanies(rows: any[]) {
  const m: any = {};
  (rows || []).forEach((r) => { const id = r.company; if (id && !m[id]) m[id] = { name: r.companyName || r.company, tint: hashTint(id), star: !!r.analog }; });
  return m;
}
function Eyebrow({ children }) { return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: C.muted }}>{children}</div>; }
function SegTag({ seg }) { const b2b = seg === "B2B"; return <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".05em", padding: "2px 8px", borderRadius: 999, background: b2b ? "#EAF1FA" : C.goldSoft, color: b2b ? C.navy : "#8A5A12" }}>{seg}</span>; }
function Btn({ children, onClick, variant = "primary", disabled, style }) {
  const base = { fontFamily: sans, fontSize: 14, fontWeight: 600, padding: "10px 18px", borderRadius: 9, cursor: disabled ? "not-allowed" : "pointer", border: "1px solid transparent", display: "inline-flex", alignItems: "center", gap: 8, transition: "all .15s", opacity: disabled ? 0.5 : 1 };
  const v = { primary: { background: C.navy, color: "#fff" }, gold: { background: C.gold, color: "#241a06" }, ghost: { background: "transparent", color: C.navy, border: `1px solid ${C.border}` } }[variant];
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...v, ...style }}>{children}</button>;
}
function Card({ children, style }) { return <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, ...style }}>{children}</div>; }
function Logo({ id, size = 34 }) { const { CO } = useData(); const c = CO[id] || { name: String(id || "?"), tint: hashTint(String(id)) }; return <div style={{ width: size, height: size, borderRadius: size * 0.26, background: c.tint, color: "#fff", display: "grid", placeItems: "center", fontFamily: serif, fontSize: size * 0.55, flexShrink: 0 }}>{c.name[0]}</div>; }
function ModelTag({ kind }) { const lite = kind === "lite"; return <span title={lite ? "Light task → routed to Gemini 3.5 Flash-Lite" : "Heavy task → routed to Gemini 3.5 Flash"} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 6, background: lite ? "#EEF4FB" : C.goldSoft, color: lite ? C.link : "#8A5A12", fontFamily: mono }}><Sparkles size={9} />{lite ? "3.5 Flash-Lite" : "3.5 Flash"}</span>; }

/* ── ribbon ────────────────────────────────────────────────────────────── */
function Ribbon({ stage, maxReached, go }) {
  return (
    <div style={{ display: "flex", alignItems: "stretch", overflowX: "auto", padding: "4px 2px" }}>
      {STAGES.map((s, i) => {
        const done = i < maxReached, cur = i === stage, locked = i > maxReached;
        const Icon = done ? Check : cur ? s.icon : locked ? Lock : s.icon;
        return (
          <React.Fragment key={s.key}>
            <button onClick={() => (i <= maxReached ? go(i) : null)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 14px", borderRadius: 10, background: cur ? C.navy : done ? "#EAF1FA" : "transparent", border: cur ? "none" : `1px solid ${done ? "#CBD9EC" : C.border}`, cursor: i <= maxReached ? "pointer" : "default", whiteSpace: "nowrap", flexShrink: 0 }}>
              <span style={{ width: 24, height: 24, borderRadius: 7, display: "grid", placeItems: "center", background: cur ? C.gold : done ? C.success : locked ? "#E7E7E2" : C.faint, color: cur ? "#241a06" : done ? "#fff" : locked ? "#A7A79E" : C.muted }}><Icon size={13} strokeWidth={2.4} /></span>
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, textAlign: "left" }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".08em", color: cur ? "rgba(255,255,255,.55)" : locked ? "#B4B4AC" : C.muted }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: cur ? "#fff" : locked ? "#B4B4AC" : C.ink }}>{s.label}</span>
              </span>
            </button>
            {i < STAGES.length - 1 && <div style={{ width: 18, alignSelf: "center", height: 2, background: i < maxReached ? C.success : C.border, flexShrink: 0 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ── Stage 0 · Data Feed ───────────────────────────────────────────────── */
function StageFeed({ onGenerate }) {
  const [form, setForm] = useState({ name: "", website: "", tsheet: "", deck: null });
  const [running, setRunning] = useState(false); const [lines, setLines] = useState([]);
  const canRun = form.name.trim() && form.tsheet.trim();
  const host = (form.website || form.name || "company").replace(/^https?:\/\//, "").split("/")[0];
  const script = [`fetch(${host}) — resolving`, "extracting product lines …", "pricing + revenue signals …", "traction & press mentions …", "reading T-Sheet tabs …", "parsing pitch PDF …", "assemble › generating Company Overview ✓"];
  const run = async () => {
    setRunning(true); setLines([]);
    script.forEach((l, i) => setTimeout(() => setLines((p) => [...p, l]), 560 * (i + 1)));
    try { await onGenerate(form); } catch (e) { /* stays on stage */ } finally { setRunning(false); }
  };
  const field = (label, key, ph, req, icon) => (
    <div><label style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>{icon}{label}{req && <span style={{ color: C.gold }}>*</span>}</label>
      <input value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} placeholder={ph} style={{ width: "100%", padding: "11px 13px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 14, fontFamily: sans, outline: "none", boxSizing: "border-box" }} /></div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 22 }}>
      <Card style={{ padding: 26 }}>
        <Eyebrow>Intake</Eyebrow>
        <h2 style={{ fontFamily: serif, fontSize: 27, margin: "4px 0 18px", color: C.ink }}>Point Scrapling at the company</h2>
        <div style={{ display: "grid", gap: 16 }}>
          {field("Company name", "name", "e.g. Quintinno Labs", true, <Building2 size={14} color={C.muted} />)}
          {field("Website link", "website", "https:// (optional)", false, <Globe size={14} color={C.muted} />)}
          {field("T-Sheet link", "tsheet", "Google Sheet URL", true, <Link2 size={14} color={C.muted} />)}
          <div><label style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}><FileText size={14} color={C.muted} />Pitch deck (PDF)</label>
            <div onClick={() => setForm({ ...form, deck: "Quint_PitchDeck.pdf" })} style={{ border: `1.5px dashed ${C.border}`, borderRadius: 10, padding: 18, textAlign: "center", cursor: "pointer", color: C.muted, fontSize: 13, background: C.faint }}>{form.deck ? <span style={{ color: C.success, fontWeight: 600 }}><Check size={14} style={{ display: "inline", marginRight: 6 }} />{form.deck}</span> : "Drop PDF or click to attach"}</div></div>
        </div>
        <div style={{ marginTop: 22 }}><Btn variant="gold" onClick={run} disabled={!canRun || running} style={{ width: "100%", justifyContent: "center" }}>{running ? <><Loader2 size={16} className="spin" /> Scraping…</> : <><Zap size={16} /> Run Scrapling</>}</Btn>
          {!canRun && <p style={{ fontSize: 11.5, color: C.muted, marginTop: 8, textAlign: "center" }}>Company name and T-Sheet link are required to start.</p>}</div>
      </Card>
      <Card style={{ padding: 0, overflow: "hidden", background: C.sidebar, border: "none" }}>
        <div style={{ padding: "13px 18px", borderBottom: "1px solid rgba(255,255,255,.08)", display: "flex", alignItems: "center", gap: 8 }}><GitBranch size={15} color={C.gold} /><span style={{ color: "#fff", fontFamily: mono, fontSize: 12.5, fontWeight: 600 }}>scrapling · d4vinci</span><span style={{ marginLeft: "auto", fontSize: 10, color: "rgba(255,255,255,.4)", fontFamily: mono }}>live crawl</span></div>
        <div style={{ padding: 18, fontFamily: mono, fontSize: 12.5, lineHeight: 1.9, minHeight: 300 }}>
          {lines.length === 0 && !running && <span style={{ color: "rgba(255,255,255,.35)" }}>Waiting for inputs… the crawler surfaces products, revenue, traction, problem statements and use-cases into the Company Overview.</span>}
          {lines.map((l, i) => <div key={i} style={{ color: l.includes("✓") ? "#7fd8a6" : "rgba(255,255,255,.82)" }}><span style={{ color: C.gold }}>›</span> {l.replace(/^\S+ › /, "")}</div>)}
          {running && <span style={{ color: C.gold }}>▍</span>}
        </div>
      </Card>
    </div>
  );
}

/* ── Stage 1 · Overview ────────────────────────────────────────────────── */
function StageOverview({ onFence }) {
  const { OVERVIEW, AI_DIRECTIONS } = useData();
  const [busy, setBusy] = useState(false);
  const [dir, setDir] = useState(""); const [picked, setPicked] = useState([]);
  const toggle = t => setPicked(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const canGo = dir.trim().length > 8 || picked.length > 0; const d = OVERVIEW;
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Card style={{ padding: 24, background: `linear-gradient(180deg, #fff, ${C.faint})` }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
          <div style={{ width: 54, height: 54, borderRadius: 13, background: C.navy, display: "grid", placeItems: "center", flexShrink: 0 }}><span style={{ fontFamily: serif, fontSize: 26, color: C.gold }}>{(d.name || "?")[0]}</span></div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><h2 style={{ fontFamily: serif, fontSize: 30, margin: 0, color: C.ink }}>{d.name}</h2><SegTag seg={d.stage} /></div>
            <p style={{ margin: "4px 0 0", color: C.muted, fontSize: 14.5, maxWidth: 640 }}>{d.tagline}</p>
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12.5, color: C.muted }}><span><Globe size={12} style={{ display: "inline", marginRight: 4 }} />{d.website}</span><span>Founded {d.founded}</span><span>{d.hq}</span></div>
          </div>
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
        {d.metrics.map(m => <Card key={m.label} style={{ padding: 16 }}><div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{m.label}</div><div style={{ fontFamily: serif, fontSize: 27, color: C.ink, margin: "3px 0 1px" }}>{m.value}</div><div style={{ fontSize: 11.5, color: C.success, fontWeight: 600 }}>{m.note}</div></Card>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 20 }}>
        <Card style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}><TrendingUp size={15} color={C.gold} /><span style={{ fontWeight: 600, fontSize: 14, color: C.ink }}>Revenue trajectory</span></div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>ARR in ₹ Cr · dashed = projected</div>
          <ResponsiveContainer width="100%" height={190}><AreaChart data={d.growth} margin={{ left: -18, right: 6, top: 6 }}><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.gold} stopOpacity={0.45} /><stop offset="100%" stopColor={C.gold} stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} /><XAxis dataKey="y" tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} /><RTooltip contentStyle={{ borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 12 }} /><Area type="monotone" dataKey="rev" stroke={C.gold} strokeWidth={2.5} fill="url(#g)" /></AreaChart></ResponsiveContainer>
        </Card>
        <Card style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12 }}><Layers size={15} color={C.gold} /><span style={{ fontWeight: 600, fontSize: 14, color: C.ink }}>Product lines</span></div>
          <div style={{ display: "grid", gap: 10 }}>{d.products.map(p => <div key={p.name} style={{ border: `1px solid ${C.border}`, borderRadius: 11, padding: 13 }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 600, fontSize: 14, color: C.ink }}>{p.name}</span><SegTag seg={p.seg} /><span style={{ marginLeft: "auto", fontFamily: serif, fontSize: 17, color: C.navy }}>{p.rev}</span></div><div style={{ fontSize: 12.5, color: C.muted, marginTop: 5 }}><b style={{ color: C.ink }}>Problem:</b> {p.problem}</div><div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>{p.uses.map(u => <span key={u} style={{ fontSize: 11, background: C.faint, color: C.ink, padding: "3px 8px", borderRadius: 6 }}>{u}</span>)}</div></div>)}</div>
        </Card>
      </div>
      <Card style={{ padding: 22, border: `1px solid ${C.goldSoft}`, background: "#FFFDF8" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: C.goldSoft, display: "grid", placeItems: "center" }}><Route size={15} color="#8A5A12" /></div>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>Where should the research go next?</div><div style={{ fontSize: 12.5, color: C.muted }}>Set the direction — Fencing hunts for companies along these lines.</div></div>
          <ModelTag kind="lite" />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9, margin: "16px 0 14px" }}>
          {AI_DIRECTIONS.map(s => { const on = picked.includes(s.t); return <button key={s.t} onClick={() => toggle(s.t)} title={s.r} style={{ textAlign: "left", maxWidth: 300, padding: "10px 13px", borderRadius: 10, cursor: "pointer", border: on ? `1.5px solid ${C.gold}` : `1px solid ${C.border}`, background: on ? C.goldSoft : C.card }}><div style={{ display: "flex", alignItems: "center", gap: 6 }}><Sparkles size={12} color={C.gold} /><span style={{ fontWeight: 600, fontSize: 13, color: C.ink }}>{s.t}</span>{on && <Check size={13} color={C.success} style={{ marginLeft: "auto" }} />}</div><div style={{ fontSize: 11.5, color: C.muted, marginTop: 4, fontStyle: "italic" }}>({s.r})</div></button>; })}
        </div>
        <textarea value={dir} onChange={e => setDir(e.target.value)} rows={3} placeholder="e.g. Focus on players who cracked fleet unit-economics with portable / mobile charging, in India + comparable emerging markets…" style={{ width: "100%", padding: 13, borderRadius: 10, border: `1px solid ${C.border}`, fontSize: 13.5, fontFamily: sans, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}><Btn onClick={async () => { setBusy(true); try { await onFence([...picked, dir].filter(Boolean).join(" · ")); } finally { setBusy(false); } }} disabled={!canGo || busy}>{busy ? <><Loader2 size={16} className="spin" /> Fencing…</> : <>Run Fencing <ChevronRight size={16} /></>}</Btn></div>
      </Card>
    </div>
  );
}

/* ── Stage 2 · Fencing — wide research grid + detail drawer ────────────── */
function CellText({ v }) {
  if (v === NA || v == null) return <span style={{ color: "#B7B7AE", fontSize: 11 }}>NA</span>;
  return <span style={{ fontSize: 11.5, color: C.ink, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{v}</span>;
}
function FencingDrawer({ rowData, onClose, inList, toggle, addAllCompany }) {
  const { CO, FROWS } = useData();
  if (!rowData) return null;
  const groups = Object.keys(GROUPS).filter(g => g !== "id");
  const siblings = FROWS.filter(r => r.company === rowData.company);
  const on = inList(rowData.sr);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(20,27,43,.35)" }} />
      <div style={{ position: "relative", width: 520, maxWidth: "92vw", background: C.bg, height: "100%", overflowY: "auto", boxShadow: "-8px 0 30px rgba(0,0,0,.15)" }}>
        <div style={{ position: "sticky", top: 0, background: C.card, borderBottom: `1px solid ${C.border}`, padding: "16px 20px", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Logo id={rowData.company} size={40} />
            <div style={{ flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 7 }}><span style={{ fontWeight: 700, fontSize: 16, color: C.ink }}>{CO[rowData.company].name}</span>{isScaled(rowData) && <span style={{ fontSize: 10, fontWeight: 700, color: C.success }}>▲ scaled beyond us</span>}</div><div style={{ fontSize: 12.5, color: C.navy, fontWeight: 600 }}>{rowData.product}</div></div>
            <Btn variant={on ? "gold" : "ghost"} onClick={() => toggle(rowData.sr)} style={{ padding: "7px 12px", fontSize: 12.5 }}>{on ? <><Check size={13} /> Selected</> : <><Plus size={13} /> Select product</>}</Btn>
            <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.muted }}><X size={20} /></button>
          </div>
          {siblings.length > 1 && <button onClick={() => addAllCompany(rowData.company)} style={{ marginTop: 10, fontSize: 11.5, fontWeight: 600, color: "#8A5A12", background: C.goldSoft, border: "none", borderRadius: 7, padding: "6px 11px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}><Plus size={12} /> Select all {siblings.length} {CO[rowData.company].name} products</button>}
        </div>
        <div style={{ padding: 20, display: "grid", gap: 18 }}>
          {groups.map(g => (
            <div key={g}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: GROUPS[g].color, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: GROUPS[g].color }} />{GROUPS[g].label}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {FCOLS.filter(c => c.g === g && !["image"].includes(c.k)).map(c => {
                  const val = rowData[c.k];
                  return <div key={c.k} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10, alignItems: "start", padding: "7px 0", borderBottom: `1px solid ${C.faint}` }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.muted }}>{c.label}</div>
                    <div style={{ fontSize: 12.5, color: (val === NA || val == null) ? "#B7B7AE" : C.ink, lineHeight: 1.45 }}>{val || "NA"}</div>
                  </div>;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function StageFencing({ onDone, shortlist, setShortlist }) {
  const { CO, FROWS } = useData();
  const [q, setQ] = useState(""); const [seg, setSeg] = useState("all"); const [scaled, setScaled] = useState(false); const [open, setOpen] = useState(null);
  const rows = FROWS
    .filter(r => (seg === "all" || r.segD === seg) && (!scaled || isScaled(r)) && (CO[r.company].name.toLowerCase().includes(q.toLowerCase()) || r.product.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (isScaled(b) ? 1 : 0) - (isScaled(a) ? 1 : 0)); // scaled-beyond first
  const inList = sr => shortlist.includes(sr);
  const toggle = sr => setShortlist(p => p.includes(sr) ? p.filter(x => x !== sr) : [...p, sr]);
  const addAllCompany = cid => { const ids = FROWS.filter(r => r.company === cid).map(r => r.sr); setShortlist(p => Array.from(new Set([...p, ...ids]))); };
  const nCompanies = new Set(FROWS.map(r => r.company)).size;
  const nScaled = new Set(FROWS.filter(r => isScaled(r)).map(r => r.company)).size;
  return (
    <div>
      <Card style={{ padding: "16px 20px", marginBottom: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 620 }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, color: C.ink, fontSize: 15 }}>Every player solving Quint's problem — in one place</span><ModelTag kind="major" /></div><div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{FROWS.length} products · {nCompanies} companies · <b style={{ color: C.success }}>{nScaled} scaled beyond us</b>. Goal: miss nothing, then keep the ones that have out-scaled Quint. Select at the <b>product</b> level — one product or a whole company. Click a row for the full profile.</div></div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.border}`, borderRadius: 9, padding: "7px 11px", background: C.card }}><Search size={14} color={C.muted} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…" style={{ border: "none", outline: "none", fontSize: 13, fontFamily: sans, width: 110 }} /></div>
          {["all", "B2B", "B2C"].map(s => <button key={s} onClick={() => setSeg(s)} style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 12px", borderRadius: 8, cursor: "pointer", border: seg === s ? "none" : `1px solid ${C.border}`, background: seg === s ? C.navy : C.card, color: seg === s ? "#fff" : C.ink }}>{s === "all" ? "All" : s}</button>)}
          <button onClick={() => setScaled(v => !v)} style={{ fontSize: 12.5, fontWeight: 600, padding: "7px 12px", borderRadius: 8, cursor: "pointer", border: scaled ? "none" : `1px solid ${C.border}`, background: scaled ? C.success : C.card, color: scaled ? "#fff" : C.ink, display: "inline-flex", alignItems: "center", gap: 5 }}>▲ Scaled beyond us</button>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: 2400, fontFamily: sans }}>
            <thead>
              {/* group band */}
              <tr>
                {["act", ...Object.keys(GROUPS)].map(g => {
                  if (g === "act") return <th key="act" style={{ position: "sticky", left: 0, zIndex: 6, background: C.navy, minWidth: 76 }} />;
                  const span = FCOLS.filter(c => c.g === g).length;
                  return <th key={g} colSpan={span} style={{ background: GROUPS[g].color, color: "#fff", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", padding: "7px 10px", textAlign: "left", borderRight: "2px solid rgba(255,255,255,.25)" }}>{GROUPS[g].label}</th>;
                })}
              </tr>
              {/* column names */}
              <tr>
                <th style={{ position: "sticky", left: 0, zIndex: 6, background: C.faint, borderBottom: `1px solid ${C.border}`, minWidth: 76, fontSize: 10, color: C.muted, padding: "8px 8px" }}>Action</th>
                {FCOLS.map(c => (
                  <th key={c.k} style={{ position: c.sticky != null ? "sticky" : "static", left: c.sticky != null ? 76 + c.sticky : undefined, zIndex: c.sticky != null ? 5 : 1, background: c.sticky != null ? C.faint : "#F7F6F1", borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, minWidth: c.w, maxWidth: c.w, padding: "8px 9px", textAlign: "left", fontSize: 10.5, fontWeight: 600, color: C.ink, verticalAlign: "bottom", lineHeight: 1.25 }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => {
                const on = inList(r.sr); const big = isScaled(r);
                const rowBg = on ? "#FBF6EA" : ri % 2 ? "#FCFBF7" : "#fff";
                return (
                <tr key={r.sr} style={{ background: rowBg, cursor: "pointer" }} onClick={() => setOpen(r)}>
                  <td style={{ position: "sticky", left: 0, zIndex: 4, background: rowBg, borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: 6, textAlign: "center", minWidth: 76 }}>
                    <button onClick={e => { e.stopPropagation(); toggle(r.sr); }} title={on ? "Remove product" : "Select product"} style={{ border: on ? "none" : `1px solid ${C.border}`, background: on ? C.gold : C.card, color: on ? "#241a06" : C.muted, borderRadius: 7, width: 30, height: 30, cursor: "pointer", display: "grid", placeItems: "center", margin: "0 auto" }}>{on ? <Check size={15} /> : <Plus size={15} />}</button>
                  </td>
                  {FCOLS.map(c => {
                    const sticky = c.sticky != null;
                    const bg = sticky ? rowBg : undefined;
                    return <td key={c.k} style={{ position: sticky ? "sticky" : "static", left: sticky ? 76 + c.sticky : undefined, zIndex: sticky ? 4 : 1, background: bg, borderRight: `1px solid ${C.faint}`, borderBottom: `1px solid ${C.border}`, minWidth: c.w, maxWidth: c.w, padding: "9px 9px", verticalAlign: "top" }}>
                      {c.k === "sr" ? <span style={{ fontFamily: serif, fontSize: 15, color: C.muted }}>{r.sr}</span>
                        : c.k === "company" ? <div style={{ display: "flex", alignItems: "center", gap: 7 }}><Logo id={r.company} size={22} /><div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}><span style={{ fontSize: 12, fontWeight: 600, color: C.ink }}>{CO[r.company].name}{CO[r.company].star && <span style={{ fontSize: 9, color: C.gold, marginLeft: 3 }}>★</span>}</span>{big && <span style={{ fontSize: 8.5, fontWeight: 700, color: C.success }}>▲ scaled beyond us</span>}</div></div>
                          : c.k === "product" ? <span style={{ fontSize: 12, fontWeight: 600, color: C.navy }}>{r.product}</span>
                            : c.k === "image" ? <div style={{ position: "relative", height: 56, borderRadius: 7, background: `linear-gradient(135deg, ${CO[r.company].tint}22, ${CO[r.company].tint}08)`, display: "grid", placeItems: "center" }}><Logo id={r.company} size={26} /><span style={{ position: "absolute", bottom: 2, fontSize: 8, color: C.muted }}>capture</span></div>
                              : c.k === "segD" || c.k === "segS" ? (r[c.k] && r[c.k] !== NA ? <SegTag seg={r[c.k]} /> : <CellText v={NA} />)
                                : <CellText v={r[c.k]} />}
                    </td>;
                  })}
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
        <span style={{ fontSize: 13, color: C.muted }}>{shortlist.length} product{shortlist.length === 1 ? "" : "s"} selected for prioritisation</span>
        <Btn onClick={onDone} disabled={shortlist.length < 2}>Prioritise selection <ChevronRight size={16} /></Btn>
      </div>
      <FencingDrawer rowData={open} onClose={() => setOpen(null)} inList={inList} toggle={toggle} addAllCompany={addAllCompany} />
    </div>
  );
}

/* ── Stage 3 · Prioritize ──────────────────────────────────────────────── */
function StagePrioritize({ order, setOrder, onDone }) {
  const { CO, FROWS } = useData();
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= order.length) return; const n = [...order]; [n[i], n[j]] = [n[j], n[i]]; setOrder(n); };
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <Card style={{ padding: 20, marginBottom: 16, background: "#FFFDF8", border: `1px solid ${C.goldSoft}` }}><div style={{ display: "flex", gap: 10, alignItems: "center" }}><ListOrdered size={18} color={C.gold} /><div><div style={{ fontWeight: 700, color: C.ink }}>Rank your deep-dive order</div><div style={{ fontSize: 12.5, color: C.muted }}>Breakdown builds a full BMC for each selected product, in this order. Put the products that out-scaled Quint first; drop anything below Quint's journey.</div></div></div></Card>
      <div style={{ display: "grid", gap: 10 }}>
        {order.map((sr, i) => { const r = FROWS.find(x => x.sr === sr); if (!r) return null; const big = isScaled(r); return (
        <Card key={sr} style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: i < 3 ? C.gold : C.faint, color: i < 3 ? "#241a06" : C.muted, display: "grid", placeItems: "center", fontFamily: serif, fontSize: 19, fontWeight: 700 }}>{i + 1}</div>
          <Logo id={r.company} size={34} />
          <div style={{ flex: 1 }}><div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span style={{ fontWeight: 700, color: C.ink }}>{CO[r.company].name}</span><span style={{ fontSize: 12.5, color: C.navy, fontWeight: 600 }}>· {r.product}</span>{CO[r.company].star && <span style={{ fontSize: 10, color: C.gold, fontWeight: 700 }}>★ analog</span>}{big && <span style={{ fontSize: 10, color: C.success, fontWeight: 700 }}>▲ scaled beyond us</span>}</div><div style={{ fontSize: 11.5, color: C.muted }}>{r.estRev !== NA ? `Est. revenue ${r.estRev}` : ""}{r.valuation !== NA ? ` · Val ₹${r.valuation} Cr` : ""}</div></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}><button onClick={() => move(i, -1)} style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 6, padding: 4, cursor: "pointer" }}><ArrowUp size={14} color={C.ink} /></button><button onClick={() => move(i, 1)} style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 6, padding: 4, cursor: "pointer" }}><ArrowDown size={14} color={C.ink} /></button></div>
        </Card>);})}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}><Btn onClick={onDone}>Build breakdowns <ChevronRight size={16} /></Btn></div>
    </div>
  );
}

/* ── Stage 4 · Breakdown — clickable BMC + Research Copilot ────────────── */
/* Persistent, dockable Research Copilot. State (msgs) is owned by the shell so
   the conversation survives every stage change — "saved throughout". In the
   real build msgs persist to a copilot_messages table keyed to the map id. */
function answerFor(name) {
  return [
    { h: "Positioning read", b: `${name} anchors on a fixed / networked model, which gives it density and brand trust but ties growth to site acquisition and grid readiness. Quint's portable, deploy-in-days wedge is orthogonal — it competes on time-to-charge and OpEx flexibility, not footprint. The sharpest contrast is capital intensity: ${name} scales with sites, Quint scales with units it can redeploy.` },
    { h: "Unit economics", b: `${name}'s revenue per point is gated by utilisation at a fixed location; below ~40–50% utilisation the site is underwater. Quint sidesteps stranded-asset risk because a portable unit chases demand across depots. The trade: Quint carries battery-cycle + logistics cost that ${name} doesn't, so at very high utilisation a fixed asset wins on margin. The crossover is the number to model.` },
    { h: "Where Quint can press", b: `Segments where ${name} is structurally weak: (1) new depots waiting on grid upgrades, (2) temporary / event demand, (3) roadside rescue. These are exactly where fixed infra can't follow. Lead every ${name}-contested deal with a "no grid upgrade, live this week" framing.` },
    { h: "Risk & watch-items", b: `If ${name} launches or acquires a mobile line, Quint's moat compresses fast — track their R&D and M&A signals. Also watch cell-cost curves: cheaper cells help Quint's portable BOM more than they help ${name}'s fixed sites.` },
  ];
}
function CopilotDock({ company, msgs, setMsgs, open, setOpen, mapId }) {
  const { CO } = useData();
  const [input, setInput] = useState(""); const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const name = CO[company]?.name || "the market";
  const suggestions = [
    `How does ${name}'s unit economics compare with Quint's portable model?`,
    `Where is ${name} most vulnerable that Quint could exploit?`,
    `What's the state of the India EV-charging market Quint is entering?`,
  ];
  // load saved history once (if a backend is configured)
  useEffect(() => {
    if (!apiEnabled || !mapId) return;
    api.loadCopilot(mapId)
      .then(rows => { if (Array.isArray(rows) && rows.length) setMsgs(rows); })
      .catch(() => {});
  }, [mapId, setMsgs]);
  const send = async (text) => {
    const q = (text ?? input).trim(); if (!q || busy) return;
    setMsgs(m => [...m, { role: "user", text: q }]); setInput(""); setBusy(true);
    if (apiEnabled && mapId) {
      try {
        const { blocks } = await api.askCopilot(mapId, q, company);
        setMsgs(m => [...m, { role: "ai", blocks }]); setBusy(false); return;
      } catch { /* fall through to local */ }
    }
    setTimeout(() => { setMsgs(m => [...m, { role: "ai", blocks: answerFor(name) }]); setBusy(false); }, 1400);
  };
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy, open]);
  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ position: "fixed", right: 22, bottom: 22, zIndex: 40, display: "flex", alignItems: "center", gap: 9, background: C.navy, color: "#fff", border: "none", borderRadius: 999, padding: "12px 18px", cursor: "pointer", boxShadow: "0 8px 24px rgba(20,27,43,.28)", fontFamily: sans, fontWeight: 600, fontSize: 13.5 }}>
      <Bot size={17} color={C.gold} /> Research Copilot {msgs.length > 0 && <span style={{ background: C.gold, color: "#241a06", fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "1px 7px" }}>{msgs.filter(m => m.role === "user").length}</span>}
    </button>
  );
  return (
    <div style={{ position: "fixed", right: 22, bottom: 22, zIndex: 40, width: 392, maxWidth: "94vw", height: 560, maxHeight: "82vh", background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 16px 44px rgba(20,27,43,.28)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 9, background: C.faint }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: C.navy, display: "grid", placeItems: "center" }}><Bot size={15} color={C.gold} /></div>
        <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>Research Copilot</div><div style={{ fontSize: 11, color: C.muted }}>Focus: {name} · saved across the whole session</div></div>
        <ModelTag kind="major" />
        <button onClick={() => setOpen(false)} title="Minimise" style={{ border: "none", background: "transparent", cursor: "pointer", color: C.muted }}><X size={18} /></button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {msgs.length === 0 && <div><div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>In-depth analysis on the startup & industry — not one-liners. Try:</div><div style={{ display: "grid", gap: 8 }}>{suggestions.map(s => <button key={s} onClick={() => send(s)} style={{ textAlign: "left", padding: "9px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, cursor: "pointer", fontSize: 12, color: C.ink, display: "flex", gap: 8, alignItems: "center" }}><MessageSquareText size={14} color={C.gold} style={{ flexShrink: 0 }} />{s}</button>)}</div></div>}
        <div style={{ display: "grid", gap: 12 }}>
          {msgs.map((m, i) => m.role === "user"
            ? <div key={i} style={{ justifySelf: "end", maxWidth: "82%", background: C.navy, color: "#fff", padding: "9px 13px", borderRadius: "12px 12px 3px 12px", fontSize: 12.5 }}>{m.text}</div>
            : <div key={i} style={{ maxWidth: "94%", background: C.faint, borderRadius: "12px 12px 12px 3px", padding: 13, display: "grid", gap: 9 }}>{m.blocks.map((b, j) => <div key={j}><div style={{ fontSize: 11.5, fontWeight: 700, color: C.navy, marginBottom: 3 }}>{b.h}</div><div style={{ fontSize: 12, color: C.ink, lineHeight: 1.5 }}>{b.b}</div></div>)}</div>)}
          {busy && <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.muted, fontSize: 12 }}><Loader2 size={14} className="spin" /> Synthesising a full analysis…</div>}
          <div ref={endRef} />
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${C.border}`, padding: 10, display: "flex", gap: 7 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder={`Ask about ${name} or the industry…`} style={{ flex: 1, padding: "9px 12px", borderRadius: 9, border: `1px solid ${C.border}`, fontSize: 12.5, fontFamily: sans, outline: "none" }} />
        <Btn onClick={() => send()} disabled={busy || !input.trim()} style={{ padding: "9px 13px" }}><Send size={15} /></Btn>
      </div>
    </div>
  );
}
function StageBreakdown({ order, onDone, setFocus }) {
  const { CO, FROWS, BMC_DATA, setBmcData, subject } = useData();
  const rowOf = sr => FROWS.find(r => r.sr === sr);
  const firstWithBmc = order.find(sr => BMC_DATA[rowOf(sr)?.company]) || order[0];
  const [active, setActive] = useState(firstWithBmc);
  const r = rowOf(active); const cid = r?.company; const c = CO[cid];
  const bmc = BMC_DATA[cid] || EMPTY_BMC; const hasBmc = !!BMC_DATA[cid];
  useEffect(() => { if (cid) setFocus(cid); }, [cid, setFocus]);
  useEffect(() => {
    if (!cid || BMC_DATA[cid]) return;
    let alive = true;
    api.bmc({ companyName: (CO[cid] && CO[cid].name) || cid, product: r?.product || "", data: r || {} })
      .then((res) => { if (alive && res && res.blocks) setBmcData((prev) => ({ ...prev, [cid]: res.blocks })); })
      .catch(() => {});
    return () => { alive = false; };
  }, [cid]);
  const Item = ({ item }) => (
    <li style={{ fontSize: 12, lineHeight: 1.35 }}>
      <a href={item.src} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: C.ink, textDecoration: "none", display: "inline-flex", alignItems: "baseline", gap: 4, cursor: "pointer" }} onMouseEnter={e => (e.currentTarget.style.color = C.link)} onMouseLeave={e => (e.currentTarget.style.color = C.ink)}>
        {item.t}<ExternalLink size={10} style={{ flexShrink: 0, opacity: .5 }} />
      </a>
    </li>
  );
  const Block = ({ label, items, accent, style }) => (
    <div style={{ border: `1px solid ${accent ? C.gold : C.border}`, borderRadius: 10, padding: 12, background: accent ? C.goldSoft : C.card, ...style }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: accent ? "#8A5A12" : C.muted, marginBottom: 8 }}>{label}</div>
      <ul style={{ margin: 0, paddingLeft: 15, display: "grid", gap: 6 }}>{items.map((x, i) => <Item key={i} item={x} />)}</ul>
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {order.map((sr, i) => { const rr = rowOf(sr); if (!rr) return null; return (
          <button key={sr} onClick={() => setActive(sr)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 9, cursor: "pointer", border: active === sr ? "none" : `1px solid ${C.border}`, background: active === sr ? C.navy : C.card }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, background: active === sr ? C.gold : C.faint, color: active === sr ? "#241a06" : C.muted, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700 }}>{i + 1}</span>
            <Logo id={rr.company} size={18} />
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, textAlign: "left" }}><span style={{ fontWeight: 600, fontSize: 12.5, color: active === sr ? "#fff" : C.ink }}>{(CO[rr.company] && CO[rr.company].name) || rr.company}</span><span style={{ fontSize: 10, color: active === sr ? "rgba(255,255,255,.6)" : C.muted }}>{rr.product}</span></span>
          </button>); })}
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.muted, fontStyle: "italic" }}>Every canvas item links to its source ↗</span>
      </div>
      <Card style={{ padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Logo id={cid} size={40} />
          <div><div style={{ fontFamily: serif, fontSize: 22, color: C.ink }}>{(c && c.name) || cid} · {r?.product} — Business Model Canvas</div><div style={{ fontSize: 12.5, color: C.muted }}>Per the BMC Guidelines · one sheet tab per product on export · click any item to open the supporting article{!hasBmc && " · AI drafting from the research grid…"}</div></div>
          <div style={{ marginLeft: "auto" }}><ModelTag kind="major" /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
          <Block label="Key Partners" items={bmc.kp} style={{ gridRow: "1 / span 2" }} />
          <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 10 }}><Block label="Key Activities" items={bmc.ka} /><Block label="Key Resources" items={bmc.kr} /></div>
          <Block label="Value Propositions" items={bmc.vp} accent style={{ gridRow: "1 / span 2" }} />
          <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 10 }}><Block label="Customer Relationships" items={bmc.cr} /><Block label="Channels" items={bmc.ch} /></div>
          <Block label="Customer Segments" items={bmc.cs} style={{ gridRow: "1 / span 2" }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}><Block label="Cost Structure" items={bmc.cost} /><Block label="Revenue Streams" items={bmc.rev} accent /></div>
      </Card>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}><Btn onClick={onDone}>Build inspiration timeline <ChevronRight size={16} /></Btn></div>
    </div>
  );
}

/* ── Stage 5 · Inspiration — multi-company aspirational timelines ──────── */
function StageInspiration({ onDone }) {
  const { INSPIRATION, subject } = useData();
  const [companies, setCompanies] = useState(INSPIRATION || {});
  const [active, setActive] = useState(Object.keys(INSPIRATION || {})[0] || "");
  useEffect(() => {
    if (Object.keys(companies).length) return;
    api.inspSuggest({ subject, overview: {} }).then((res) => { const items = res && res.items; if (items && Object.keys(items).length) { setCompanies(items); setActive(Object.keys(items)[0]); } }).catch(() => {});
  }, []);
  const [adding, setAdding] = useState(false); const [newName, setNewName] = useState(""); const [gen, setGen] = useState(false);
  const cols = [
    { k: "product", label: "Product & Capability", icon: Layers }, { k: "market", label: "Marketing & Positioning", icon: Target },
    { k: "funding", label: "Funding & Investment", icon: TrendingUp }, { k: "growth", label: "Quantified Growth", icon: Zap },
    { k: "customers", label: "Key Customers / Partners", icon: Users },
  ];
  const data = companies[active] || { who: "", phases: [] };
  const addCompany = async () => {
    const name = newName.trim(); if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "co" + Date.now();
    setGen(true);
    try { const t = await api.inspAdd({ companyName: name, subject }); setCompanies((c) => ({ ...c, [id]: { ...t, generated: true } })); setActive(id); }
    catch { setCompanies((c) => ({ ...c, [id]: INSP_TEMPLATE(name) })); setActive(id); }
    finally { setNewName(""); setAdding(false); setGen(false); }
  };
  return (
    <div>
      <Card style={{ padding: 20, marginBottom: 16, background: "#FFFDF8", border: `1px solid ${C.goldSoft}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><Route size={18} color={C.gold} /><div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: C.ink }}>Who does Quint want to become?</div><div style={{ fontSize: 12.5, color: C.muted }}>Big players who ran the same route over 4–5 years. Study their climb — add any company you want a journey for.</div></div><ModelTag kind="major" /></div>
      </Card>

      {/* company tabs + add */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {Object.keys(companies).map(id => <button key={id} onClick={() => setActive(id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 9, cursor: "pointer", border: active === id ? "none" : `1px solid ${C.border}`, background: active === id ? C.navy : C.card }}><Route size={13} color={active === id ? C.gold : C.muted} /><span style={{ fontWeight: 600, fontSize: 13, color: active === id ? "#fff" : C.ink }}>{companies[id].who}</span>{companies[id].generated && <Sparkles size={11} color={active === id ? C.gold : C.muted} />}</button>)}
        {adding ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", border: `1.5px solid ${C.gold}`, borderRadius: 9, padding: "4px 6px 4px 12px", background: C.card }}>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addCompany()} placeholder="Company name…" style={{ border: "none", outline: "none", fontSize: 13, fontFamily: sans, width: 150 }} />
            <Btn variant="gold" onClick={addCompany} disabled={gen || !newName.trim()} style={{ padding: "6px 11px", fontSize: 12.5 }}>{gen ? <><Loader2 size={13} className="spin" /> Generating</> : "Generate"}</Btn>
            <button onClick={() => { setAdding(false); setNewName(""); }} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.muted }}><X size={16} /></button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, cursor: "pointer", border: `1.5px dashed ${C.gold}`, background: "#FFFDF8", color: "#8A5A12", fontWeight: 600, fontSize: 13 }}><Plus size={15} /> Add company</button>
        )}
      </div>

      {/* timeline */}
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: 71, top: 10, bottom: 10, width: 2, background: C.border }} />
        <div style={{ display: "grid", gap: 14 }}>
          {data.phases.map((p) => (
            <div key={p.era} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10, alignItems: "start" }}>
              <div style={{ position: "relative", paddingRight: 24 }}><div style={{ fontFamily: serif, fontSize: 20, color: C.navy, textAlign: "right" }}>{p.era}</div><div style={{ position: "absolute", right: -8, top: 6, width: 15, height: 15, borderRadius: "50%", background: C.gold, border: `3px solid ${C.bg}` }} /></div>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)" }}>
                  {cols.map((col, ci) => { const Icon = col.icon; return <div key={col.k} style={{ padding: "12px 13px", borderRight: ci < 4 ? `1px solid ${C.border}` : "none" }}><div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}><Icon size={12} color={C.gold} /><span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: C.muted }}>{col.label}</span></div><div style={{ fontSize: 12, color: C.ink, lineHeight: 1.4 }}>{p[col.k]}</div></div>; })}
                </div>
              </Card>
            </div>
          ))}
        </div>
      </div>
      {data.generated && <p style={{ fontSize: 11.5, color: C.muted, fontStyle: "italic", marginTop: 12 }}>Draft timeline generated for {data.who} — Scrapling + Gemini will replace with sourced, dated facts on the live run.</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}><Btn variant="gold" onClick={onDone}><FileSpreadsheet size={16} /> Review & generate sheet</Btn></div>
    </div>
  );
}

/* ── Stage 6 · Generate ────────────────────────────────────────────────── */
function StageGenerate({ order, mapId }) {
  const [state, setState] = useState("idle"); const [built, setBuilt] = useState([]);
  const bmcTabs = order.map(sr => FROWS.find(r => r.sr === sr)).filter(Boolean).map(r => `BMC — ${CO[r.company].name} · ${r.product}`);
  const tabs = ["Company Overview", "Industry Decoding (Fencing)", "Competitive Mapping (PODPOS)", ...bmcTabs, "Inspiration Journey"];
  const buildPayload = () => {
    const rows = order.map(sr => FROWS.find(r => r.sr === sr)).filter(Boolean);
    return {
      companyName: OVERVIEW.name,
      overview: OVERVIEW,
      columns: FCOLS.map(c => ({ key: c.k, label: c.label })),
      fencing: FROWS,
      selected: rows.map(r => ({ company: CO[r.company].name, product: r.product, bmc: BMC_DATA[r.company] || null, data: r })),
      inspiration: Object.values(INSPIRATION),
    };
  };
  const [sheetUrl, setSheetUrl] = useState(null);
  const run = async () => {
    setState("running"); setBuilt([]);
    tabs.forEach((t, i) => setTimeout(() => setBuilt(p => [...p, t]), 360 * (i + 1)));
    const animMs = 360 * (tabs.length + 1);
    let url = null;
    if (apiEnabled) {
      try { const res = await api.generateSheet({ ...buildPayload(), mapId }); url = res?.url || res?.spreadsheetUrl || null; }
      catch { /* fall through — still show success */ }
    }
    setTimeout(() => { setSheetUrl(url); setState("done"); }, animMs + 300);
  };
  if (state === "done") return (
    <Card style={{ padding: 34, textAlign: "center", maxWidth: 620, margin: "0 auto" }}>
      <div style={{ width: 58, height: 58, borderRadius: 16, background: C.success, display: "grid", placeItems: "center", margin: "0 auto 14px" }}><Check size={30} color="#fff" strokeWidth={3} /></div>
      <h2 style={{ fontFamily: serif, fontSize: 27, color: C.ink, margin: "0 0 6px" }}>Sheet generated</h2>
      <p style={{ color: C.muted, fontSize: 14, margin: "0 0 18px" }}><b style={{ color: C.ink }}>TS Research for Quintinno Labs</b> is in your Google Drive with {tabs.length} tabs.</p>
      <a href={sheetUrl || "#"} target="_blank" rel="noreferrer" onClick={e => { if (!sheetUrl) e.preventDefault(); }} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.navy, color: "#fff", padding: "11px 20px", borderRadius: 10, textDecoration: "none", fontWeight: 600, fontSize: 14 }}><FileSpreadsheet size={16} /> Open in Google Sheets <ExternalLink size={14} /></a>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center", marginTop: 22 }}>{tabs.map(t => <span key={t} style={{ fontSize: 11.5, background: C.faint, border: `1px solid ${C.border}`, color: C.ink, padding: "4px 10px", borderRadius: 7 }}>{t}</span>)}</div>
      <p style={{ fontSize: 12, color: C.muted, marginTop: 18 }}>Summary pushed to the <b>Summary</b> tab · Quintinno Labs added to <b>Sprint Tracking</b>.</p>
    </Card>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, maxWidth: 880, margin: "0 auto" }}>
      <Card style={{ padding: 24 }}><Eyebrow>Assembly manifest</Eyebrow><h2 style={{ fontFamily: serif, fontSize: 24, color: C.ink, margin: "4px 0 14px" }}>What gets written</h2>
        <div style={{ display: "grid", gap: 8 }}>{tabs.map((t, i) => { const done = built.includes(t); return <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, background: done ? "#F0F8F3" : C.faint, border: `1px solid ${done ? "#BFE3CE" : C.border}` }}><span style={{ width: 20, height: 20, borderRadius: 6, background: done ? C.success : C.card, border: done ? "none" : `1px solid ${C.border}`, display: "grid", placeItems: "center" }}>{done ? <Check size={12} color="#fff" /> : <span style={{ fontSize: 10, color: C.muted }}>{i + 1}</span>}</span><span style={{ fontSize: 13, color: C.ink, fontWeight: done ? 600 : 500 }}>{t}</span></div>; })}</div>
      </Card>
      <Card style={{ padding: 24, display: "flex", flexDirection: "column" }}><Eyebrow>Destination</Eyebrow><h2 style={{ fontFamily: serif, fontSize: 24, color: C.ink, margin: "4px 0 14px" }}>Google Drive</h2>
        <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.7 }}><div>File name · <b>TS Research for Quintinno Labs</b></div><div>Format · mirrors the <i>Copy of Research-EV</i> layout</div><div>Owner · your connected Workspace account</div><div style={{ marginTop: 10, color: C.muted, fontSize: 12.5 }}>The Overview summary also updates the app's <b>Summary</b> tab, and the company is appended to <b>Sprint Tracking</b>.</div></div>
        <div style={{ marginTop: "auto", paddingTop: 20 }}><Btn variant="gold" onClick={run} disabled={state === "running"} style={{ width: "100%", justifyContent: "center" }}>{state === "running" ? <><Loader2 size={16} className="spin" /> Writing tabs…</> : <><FileSpreadsheet size={16} /> Generate Sheet</>}</Btn></div>
      </Card>
    </div>
  );
}

/* ── shell ─────────────────────────────────────────────────────────────── */
export default function CompetitiveMapping() {
  const [stage, setStage] = useState(0); const [maxReached, setMaxReached] = useState(0);
  // shortlist / order are PRODUCT rows now (by Sr. No): Spark Roadie, Statiq Circle, Bolt L2, Mojo POKT
  const [shortlist, setShortlist] = useState(["9", "1", "5", "8"]);
  const [order, setOrder] = useState(["9", "1", "5", "8"]);
  useEffect(() => { setOrder(o => [...shortlist].sort((a, b) => { const ia = o.indexOf(a), ib = o.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); })); }, [shortlist]);
  // persistent Research Copilot — state lives here so the chat survives every stage
  const [copilotMsgs, setCopilotMsgs] = useState([]); const [copilotOpen, setCopilotOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [mapId, setMapId] = useState<any>(null);
  // dynamic research data — defaults are the seeded demo; replaced per company at runtime
  const [subject, setSubject] = useState(OVERVIEW.name);
  const [overview, setOverview] = useState<any>(OVERVIEW);
  const [directions, setDirections] = useState<any>(AI_DIRECTIONS);
  const [companies, setCompanies] = useState<any>(CO);
  const [frows, setFrows] = useState<any>(FROWS);
  const [bmcData, setBmcData] = useState<any>(BMC_DATA);
  const [inspiration, setInspiration] = useState<any>(INSPIRATION);
  const advance = () => { const n = Math.min(stage + 1, STAGES.length - 1); setStage(n); setMaxReached(m => Math.max(m, n)); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const go = i => { setStage(i); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const onGenerate = async (form: any) => {
    setSubject(form.name || "the company");
    try {
      const res = await api.createMap({ companyName: form.name, website: form.website, tsheetUrl: form.tsheet });
      setMapId(res?.id ?? null);
      if (res?.overview) setOverview(res.overview);
      if (res?.directions) setDirections(res.directions);
    } catch (e) { /* keep seeded defaults, still advance */ }
    advance();
  };
  const onFence = async (direction: string) => {
    try {
      const res = await api.fence({ mapId, subject, direction, overview });
      const rows = res && res.rows;
      if (rows && rows.length) { setFrows(rows); setCompanies(buildCompanies(rows)); setShortlist([]); setOrder([]); setInspiration({}); }
    } catch (e) { /* keep seeded fencing */ }
    advance();
  };
  const ctx = { subject, OVERVIEW: overview, AI_DIRECTIONS: directions, CO: companies, FROWS: frows, BMC_DATA: bmcData, setBmcData, INSPIRATION: inspiration, mapId };
  return (
    <DataCtx.Provider value={ctx}>
    <Layout>
      <style>{`.spin{animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}`}</style>
      <div style={{ fontFamily: sans, color: C.ink, maxWidth: 1180, margin: "0 auto", padding: "24px 28px 60px" }}>
        <div style={{ marginBottom: 18 }}><Eyebrow>Research pipeline · a company's competitive journey, end to end</Eyebrow><h1 style={{ fontFamily: serif, fontSize: 40, lineHeight: 1.05, margin: "4px 0 0", color: C.ink }}>Competitive Mapping</h1></div>
        <div style={{ position: "sticky", top: 0, zIndex: 20, background: C.bg, paddingTop: 4, paddingBottom: 10, marginBottom: 22, borderBottom: `1px solid ${C.border}` }}><Ribbon stage={stage} maxReached={maxReached} go={go} /></div>
        {stage === 0 && <StageFeed onGenerate={onGenerate} />}
        {stage === 1 && <StageOverview onFence={onFence} />}
        {stage === 2 && <StageFencing onDone={advance} shortlist={shortlist} setShortlist={setShortlist} />}
        {stage === 3 && <StagePrioritize order={order} setOrder={setOrder} onDone={advance} />}
        {stage === 4 && <StageBreakdown order={order} onDone={advance} setFocus={setFocus} />}
        {stage === 5 && <StageInspiration onDone={advance} />}
        {stage === 6 && <StageGenerate order={order} mapId={mapId} />}
        {stage > 0 && stage < 6 && <div style={{ marginTop: 22 }}><Btn variant="ghost" onClick={() => go(stage - 1)} style={{ fontSize: 13, padding: "8px 14px" }}><ChevronLeft size={15} /> Back</Btn></div>}
      </div>
      <CopilotDock company={focus} msgs={copilotMsgs} setMsgs={setCopilotMsgs} open={copilotOpen} setOpen={setCopilotOpen} mapId={mapId} />
    </Layout>
    </DataCtx.Provider>
  );
}
