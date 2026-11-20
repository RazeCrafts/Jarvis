import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  title: string;
  note: string;
}

export function PagePlaceholder({ icon: Icon, title, note }: Props) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Icon size={28} strokeWidth={1.4} className="text-fg-muted" />
      <h1 className="text-xl font-medium tracking-tight">{title}</h1>
      <p className="max-w-sm text-sm leading-relaxed text-fg-muted">{note}</p>
    </div>
  );
}
