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
  canManage = true,
}: {
  activeTab: SettingsTabKey;
  slug: string;
  // Non-admin staff only see the Areas tab (they can add/edit areas but not
  // manage access or project info).
  canManage?: boolean;
}) {
  const tabs = canManage ? TABS : TABS.filter((t) => t.key === "areas");
  return (
    <div className="seg" role="tablist" aria-label="Tab pengaturan">
      {tabs.map((t) => {
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
