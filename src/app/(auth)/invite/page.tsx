import type { Metadata } from "next";
import { getInvitation } from "@/modules/settings/invitations";
import { InvitationForm } from "./invitation-form";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvitationPage({ searchParams }: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const invitation = getInvitation(token);
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <InvitationForm token={token} email={invitation?.email ?? null} />
    </main>
  );
}
