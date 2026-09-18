import type { InsightsCategory } from "@/lib/filters/types";

export const CATEGORY_COLORS: Record<string, string> = {
  skill: "#0F4C81",
  technology: "#00695C",
  certification: "#9A3412",
  attribute: "#6B21A8",
  location: "#BE123C",
};

export const CATEGORY_LABELS: Record<InsightsCategory, string> = {
  all: "All",
  skill: "Skills",
  technology: "Technologies",
  certification: "Certifications",
  attribute: "Attributes",
  location: "Locations",
};
