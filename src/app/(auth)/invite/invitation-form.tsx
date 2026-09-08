"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { acceptPlatformInvitation } from "@/modules/settings/user-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function InvitationForm({ token, email }: { token: string; email: string | null }) {
  const t = useTranslations("invitation");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [invalid, setInvalid] = useState(!email);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    if (password !== confirmation) {
      setError(t("passwordMismatch"));
      return;
    }
    setPending(true);
    try {
      const result = await acceptPlatformInvitation({ token, nickname, password, confirmPassword: confirmation });
      if (result.error) {
        if (result.error === "invalidInvitation") setInvalid(true);
        else setError(t(result.error));
        return;
      }
      setPassword("");
      setConfirmation("");
      setComplete(true);
      // Remove the consumed secret from this browser history entry.
      window.history.replaceState(null, "", "/invite");
    } catch {
      setError(t("error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t(complete ? "completeTitle" : invalid ? "invalidTitle" : "title")}</CardTitle>
        <CardDescription>{t(complete ? "completeDescription" : invalid ? "invalidInvitation" : "description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {complete || invalid ? (
          <Button nativeButton={false} render={<Link href="/login" />} className="w-full">{t("signIn")}</Button>
        ) : (
          <form onSubmit={onSubmit}>
            <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="invitation-email">{t("email")}</Label>
                <Input id="invitation-email" type="email" value={email ?? ""} readOnly />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="invitation-nickname">{t("nickname")}</Label>
                <Input id="invitation-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)}
                  required minLength={3} maxLength={200} pattern="[A-Za-z0-9_.@+\-]+"
                  autoComplete="username" autoCapitalize="none" spellCheck={false}
                  aria-describedby="nickname-hint" />
                <p id="nickname-hint" className="text-xs text-muted-foreground">{t("nicknameHint")}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="invitation-password">{t("password")}</Label>
                <Input id="invitation-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  required minLength={8} maxLength={128} autoComplete="new-password" aria-describedby="password-hint" />
                <p id="password-hint" className="text-xs text-muted-foreground">{t("passwordHint")}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="invitation-confirmation">{t("confirmPassword")}</Label>
                <Input id="invitation-confirmation" type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
                  required minLength={8} maxLength={128} autoComplete="new-password" />
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={pending}>{t(pending ? "creating" : "createAccount")}</Button>
            </fieldset>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
