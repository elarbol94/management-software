import { requireUser } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-1">
      <AppSidebar userMenu={<UserMenu name={user.name} email={user.email} />} />
      <main className="flex-1 overflow-x-hidden p-6">{children}</main>
    </div>
  );
}
