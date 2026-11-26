import Link from "next/link";

const ITEMS = [
  { key: "library", label: "Library", href: "/" },
  { key: "generate", label: "Generate", href: "/generate" },
] as const;

/** Switch between the library and the generation tool. */
export function AppNav({ active }: { active: (typeof ITEMS)[number]["key"] }) {
  return (
    <nav
      aria-label="Sections"
      className="inline-flex items-center gap-0.5 rounded-full border border-black/12 bg-white p-0.5"
    >
      {ITEMS.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 font-mono text-[11px] tracking-wide transition-colors ${isActive ? "bg-black text-white" : "text-black/55 hover:text-black"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
