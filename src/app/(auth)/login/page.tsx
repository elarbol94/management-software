import { redirect } from "next/navigation";
import { getSession, hasUsers } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/");

  const setupMode = !hasUsers();

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-4">
      <LoginForm mode={setupMode ? "setup" : "login"} />
    </main>
  );
}
