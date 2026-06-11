import { redirect } from "next/navigation";

export default async function MembersRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/project/${slug}/settings?tab=akses`);
}
