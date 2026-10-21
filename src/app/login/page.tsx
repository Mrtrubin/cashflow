"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/client";

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;
const slots = Array.from({ length: CODE_LENGTH }, (_, index) => index);

export default function LoginPage() {
  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function requestCode() {
    setBusy(true);
    setError("");
    setNotice("");
    const { error: sendError } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });
    setBusy(false);
    if (sendError) {
      setError(sendError.message ?? "验证码发送失败，请稍后再试");
      return;
    }
    setCodeSent(true);
    setCooldown(RESEND_SECONDS);
    setNotice("验证码已发送，请查收邮件（可能在垃圾邮件中）。");
  }

  async function verifyCode() {
    setBusy(true);
    setError("");
    setNotice("");
    const { error: verifyError } = await authClient.signIn.emailOtp({
      email,
      otp: code,
    });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message ?? "验证码不正确或已过期");
    }
  }

  function resetToEmailStep() {
    setCodeSent(false);
    setCode("");
    setError("");
    setNotice("");
  }

  async function signOut() {
    await authClient.signOut();
    resetToEmailStep();
  }

  function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    requestCode();
  }

  function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    verifyCode();
  }

  if (isPending) {
    return (
      <main className="flex flex-1 items-center justify-center text-muted-foreground">
        加载中…
      </main>
    );
  }

  if (session?.user) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-6 py-12">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">已登录</h1>
          <p className="text-sm text-muted-foreground">{session.user.email}</p>
        </header>
        <Button variant="outline" onClick={signOut}>
          退出登录
        </Button>
        <Link
          href="/"
          className="flex min-h-11 items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground"
        >
          回到账本
        </Link>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">登录 Cashflow</h1>
        <p className="text-sm text-muted-foreground">
          登录后可在多台设备间同步账单；不登录也可以在本机使用。
        </p>
      </header>

      {codeSent ? (
        <form className="flex flex-col gap-6" onSubmit={handleCodeSubmit}>
          <div className="flex flex-col gap-3">
            <Label htmlFor="otp">验证码</Label>
            <InputOTP
              id="otp"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={setCode}
              inputMode="numeric"
              autoComplete="one-time-code"
            >
              <InputOTPGroup>
                {slots.map((index) => (
                  <InputOTPSlot
                    key={index}
                    index={index}
                    className="size-11 text-lg"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <p className="text-sm text-muted-foreground">已发送至 {email}</p>
          </div>

          <div className="flex flex-col gap-3">
            <Button
              type="submit"
              disabled={busy || code.length !== CODE_LENGTH}
            >
              登录
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || cooldown > 0}
              onClick={requestCode}
            >
              {cooldown > 0 ? `${cooldown} 秒后可重新发送` : "重新发送验证码"}
            </Button>
            <Button type="button" variant="ghost" onClick={resetToEmailStep}>
              更换邮箱
            </Button>
          </div>
        </form>
      ) : (
        <form className="flex flex-col gap-6" onSubmit={handleEmailSubmit}>
          <div className="flex flex-col gap-3">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={busy || !email}>
            发送验证码
          </Button>
        </form>
      )}

      {error ? (
        <p aria-live="assertive" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </main>
  );
}
