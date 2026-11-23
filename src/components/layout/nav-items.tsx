import { ChevronLeft, ChevronRight } from "lucide-react";
import { tr } from "@/lib/petsky/locale";

export type ShellNavItem = {
  href: string;
  label: string;
};

export const primaryNavItems: ShellNavItem[] = [
  { href: "/dashboard", label: tr("Documents") },
  { href: "/templates", label: tr("Templates") },
  { href: "/envelopes/new", label: tr("New envelope") },
  { href: "/settings", label: tr("Settings") },
];

export const ChevronLeftIcon = ChevronLeft;

export const ChevronRightIcon = ChevronRight;
