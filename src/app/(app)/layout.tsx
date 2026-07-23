import { requireUser } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <AppSidebar userName={user.name} userEmail={user.email} />
      <main className="min-w-0 flex-1 overflow-x-hidden p-6">{children}</main>
    </div>
  );
}
