import {
  BookOpen,
  Calculator,
  KanbanSquare,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";

// Adding a module: create src/modules/<name>/ with schema/queries/actions,
// add a route group under src/app/(app)/<name>/ and register it here.
export type ModuleNavItem = {
  /** Translation key under the `nav` namespace */
  key: "dashboard" | "accounting" | "projects" | "wiki";
  href: string;
  icon: LucideIcon;
};

export const moduleNav: ModuleNavItem[] = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "accounting", href: "/accounting", icon: Calculator },
  { key: "projects", href: "/projects", icon: KanbanSquare },
  { key: "wiki", href: "/wiki", icon: BookOpen },
];
