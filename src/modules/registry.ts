import {
  BookOpen,
  Calculator,
  CalendarDays,
  Files,
  KanbanSquare,
  LayoutDashboard,
  UserRoundCog,
  type LucideIcon,
} from "lucide-react";

// Adding a module: create src/modules/<name>/ with schema/queries/actions,
// add a route group under src/app/(app)/<name>/ and register it here.
export type ModuleNavItem = {
  /** Translation key under the `nav` namespace */
  key: "dashboard" | "calendar" | "accounting" | "personnel" | "documents" | "projects" | "wiki";
  href: string;
  icon: LucideIcon;
};

export const moduleNav: ModuleNavItem[] = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "calendar", href: "/calendar", icon: CalendarDays },
  { key: "accounting", href: "/accounting", icon: Calculator },
  { key: "personnel", href: "/personnel", icon: UserRoundCog },
  { key: "documents", href: "/documents", icon: Files },
  { key: "projects", href: "/projects", icon: KanbanSquare },
  { key: "wiki", href: "/wiki", icon: BookOpen },
];
