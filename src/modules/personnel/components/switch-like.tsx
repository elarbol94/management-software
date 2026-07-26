"use client";

export function SwitchLike({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#dce5e1] px-3 py-2.5 text-sm text-[#344a43]">
      <span>{label}</span>
      <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-[#173c32]" : "bg-[#c8d2ce]"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white transition ${checked ? "left-[1.125rem]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
