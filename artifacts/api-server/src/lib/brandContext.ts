/**
 * Thinking Spree brand context — pulled from the company's About PDF.
 * Used by the proposal builder to give AI-filled sections a consistent
 * on-brand tone instead of generic consulting boilerplate.
 *
 * Update this file when the company positioning changes.
 */

export const THINKING_SPREE_BRAND = {
  tagline: "Making Strategy realtime, consumable and actionable for startups",

  positioning:
    "Thinking Spree is a business design consultancy that helps new-age startups and " +
    "institutions create futuristic business models — financially sustainable and scalable — " +
    "and strategises existing business models to achieve 10x growth.",

  approach:
    "We are a diverse team of consultants, researchers, and design thinkers who develop " +
    "disruptive strategic frameworks using Design Thinking, Agility, and the Business Model Canvas. " +
    "We use relevant data and insights to make informed decisions and apply them in areas that matter.",

  // Six methodology pillars from the deck. Used as bullets / context.
  pillars: [
    {
      name: "New Strategy Frameworks",
      detail: "32 nuanced frameworks built on top of the Business Model Canvas, tested with 250+ ventures, informing every sprint.",
    },
    {
      name: "In-Depth Exploration",
      detail: "Multiple problems solved within 2-hour live strategy sessions between founders and TS consultants.",
    },
    {
      name: "AI-Driven Insights",
      detail: "100% data and research-backed solutions, mitigating risk and ensuring the most optimal solution.",
    },
    {
      name: "Real-Time Execution",
      detail: "Eliminating the gap between planning and execution — advanced techniques enable solution delivery from day 1.",
    },
    {
      name: "Customer Centricity",
      detail: "Every thought and strategy places the customer first — the first step toward financial sustainability.",
    },
    {
      name: "Product Led Thinking",
      detail: "Ensuring companies create and deliver products that guarantee exceptional user experiences.",
    },
  ],

  // Headline impact stats for proposal credibility.
  impact: [
    "₹1500 Cr+ in revenue growth impacted",
    "1000+ ventures supported with strategic interventions",
    "190+ micro-sectors supported (incl. bio-tech, deep-tech, energy)",
    "2x MRR average growth within 3 months of intervention",
  ],

  // Typical challenges the consultancy solves — useful as positioning anchors.
  capabilities: [
    "Systems Building for Scale",
    "Revenue Scale to the next 10x",
    "New Geographical Expansion",
    "Sales System Design",
    "Unit Economics of Business",
    "Product Led Growth",
    "Customer Journey Design",
    "Reducing Customer Acquisition Cost",
  ],

  // Offerings (services).
  offerings: [
    {
      name: "T-Sprints (for startups)",
      detail: "Retainer-based sprint consulting for startups of all scales — focused collaborative strategies for business growth that reduce the chance of failure.",
    },
    {
      name: "Insights",
      detail: "Advanced market research that gathers in-depth knowledge of customers and the industry. Plugs into Thinking Sprints as a basis for strategic decisions.",
    },
    {
      name: "Growth Consulting",
      detail: "Partner with corporates, institutions, NGOs and governments to design innovative strategic solutions transforming stagnation into ultra-scale growth.",
    },
  ],

  // Senior team — used only when proposal context calls for credibility. Roles
  // & headline credentials; we don't auto-include every team member.
  team: [
    {
      name: "Vani Agarwal",
      role: "Founding Partner",
      bio: "15+ years in Finance and Strategy for global VCs and investment banks. Supported 600+ startups across FinTech, Robotics, SaaS, AI, Logistics. Managed ₹3000 Cr AUM at Axis Bank. ISB Hyderabad.",
    },
    {
      name: "Jyoti Singh",
      role: "Partner",
      bio: "14+ years across Impact, Health Tech, Agri Tech, D2C, F&B, Ed-Tech. Mentored 300+ startups across pre-seed to Series B with 2x MRR growth in a quarter. ISB Mohali.",
    },
    {
      name: "Pritesh Yeole",
      role: "Senior Consultant",
      bio: "9+ years in consumer, business and market research. Advised 250+ founders across NIDHI Prayas, ISB D2C and I-Heal Accelerator. Masters, Northumbria University.",
    },
  ],

  contactEmail: "vani@thinkingspree.com",
  website: "www.thinkingspree.com",
} as const;

/**
 * Compact one-paragraph brand summary, used for proposal Gemini prompts.
 * Don't include the full team list — that's too long for a prompt prefix.
 */
export function brandSummaryForPrompt(): string {
  const b = THINKING_SPREE_BRAND;
  return [
    `ABOUT THE CONSULTING FIRM (Thinking Spree):`,
    `Tagline: "${b.tagline}"`,
    `${b.positioning}`,
    `${b.approach}`,
    ``,
    `Methodology pillars (use these as the source of credibility, not generic consulting tropes):`,
    ...b.pillars.map(p => `- ${p.name}: ${p.detail}`),
    ``,
    `Track record:`,
    ...b.impact.map(i => `- ${i}`),
    ``,
    `Typical challenges Thinking Spree solves:`,
    ...b.capabilities.map(c => `- ${c}`),
  ].join("\n");
}
