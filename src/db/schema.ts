// Central schema file: re-exports every module's tables so Drizzle and
// drizzle-kit see the whole database. Adding a module = add a re-export here.
export * from "./core-schema";
export * from "@/modules/accounting/schema";
export * from "@/modules/calendar/schema";
export * from "@/modules/funding/schema";
export * from "@/modules/projects/schema";
export * from "@/modules/personnel/schema";
export * from "@/modules/wiki/schema";
export * from "@/modules/wiki/pdf-schema";
