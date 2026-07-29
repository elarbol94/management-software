"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function YearSelect({
  years,
  year,
  label,
}: {
  years: number[];
  year: number;
  label: string;
}) {
  const router = useRouter();
  return (
    <Select
      value={String(year)}
      onValueChange={(value) => router.push(`/accounting/report?year=${value}`)}
    >
      <SelectTrigger className="w-28" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {years.map((y) => (
          <SelectItem key={y} value={String(y)}>
            {y}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
