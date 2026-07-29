import type { TaskStatus } from "./types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export type DeadlineTiming = {
  deadlineDate: string;
  deadlineAt: string | null;
  status?: TaskStatus;
};

export function todayLocal(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addLocalDays(date: string, amount: number) {
  if (!DATE_PATTERN.test(date)) return date;
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day);
  value.setDate(value.getDate() + amount);
  return todayLocal(value);
}

export function localDateValue(date: string) {
  if (!DATE_PATTERN.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(year, month - 1, day);
  return Number.isNaN(value.getTime()) || todayLocal(value) !== date
    ? null
    : value;
}

export function localTimeFromIso(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function localDeadlineToUtc(deadlineDate: string, time: string) {
  if (!DATE_PATTERN.test(deadlineDate) || !TIME_PATTERN.test(time)) return null;
  const date = new Date(`${deadlineDate}T${time}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isDeadlineOverdue(
  deadline: DeadlineTiming,
  now = new Date(),
) {
  if (deadline.status === "done") return false;
  if (deadline.deadlineAt) {
    const timestamp = new Date(deadline.deadlineAt).getTime();
    return !Number.isNaN(timestamp) && timestamp < now.getTime();
  }
  return deadline.deadlineDate < todayLocal(now);
}

export function deadlineDayState(
  deadline: DeadlineTiming,
  now = new Date(),
): "overdue" | "today" | "tomorrow" | "future" | "done" {
  if (deadline.status === "done") return "done";
  if (isDeadlineOverdue(deadline, now)) return "overdue";
  const today = todayLocal(now);
  if (deadline.deadlineDate === today) return "today";
  if (deadline.deadlineDate === addLocalDays(today, 1)) return "tomorrow";
  return "future";
}

export function compareDeadlineTiming(
  left: Pick<DeadlineTiming, "deadlineDate" | "deadlineAt">,
  right: Pick<DeadlineTiming, "deadlineDate" | "deadlineAt">,
) {
  const dateOrder = left.deadlineDate.localeCompare(right.deadlineDate);
  if (dateOrder !== 0) return dateOrder;
  if (!left.deadlineAt && right.deadlineAt) return -1;
  if (left.deadlineAt && !right.deadlineAt) return 1;
  return (left.deadlineAt ?? "").localeCompare(right.deadlineAt ?? "");
}
