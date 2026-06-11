import Link from "next/link";

export type SettingsTabKey = "akses" | "areas" | "proyek";

const TABS: Array<{ key: SettingsTabKey; label: string }> = [
  { key: "akses",  label: "Akses & Anggota" },
  { key: "areas",  label: "Areas" },
  { key: "proyek", label: "Proyek" },
];

export function SettingsTabs({
  activeTab,
  slug,
}: {
  activeTab: SettingsTabKey;
  slug: string;
}) {
  return (
    <div className="seg" role="tablist" aria-label="Tab pengaturan">
      {TABS.map((t) => {
        const on = activeTab === t.key;
        return (
          <Link
            key={t.key}
            href={`/project/${slug}/settings?tab=${t.key}`}
            role="tab"
            aria-selected={on}
            className={`seg-btn${on ? " seg-active" : ""}`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
