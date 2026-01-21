"use server";

import { signIn } from "@/auth";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "/dashboard");

  await signIn("credentials", {
    email,
    password,
    redirectTo: callbackUrl,
  });
}
