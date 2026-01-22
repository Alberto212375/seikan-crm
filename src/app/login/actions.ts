"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "/dashboard");

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: callbackUrl,
    });
  } catch (e) {
    // ✅ Empêche le 500 : on repasse sur /login avec un code d'erreur
    if (e instanceof AuthError) {
      // "CredentialsSignin" => mauvais identifiants OU user absent
      if (e.type === "CredentialsSignin") {
        redirect(`/login?from=${encodeURIComponent(callbackUrl)}&error=credentials`);
      }
      redirect(`/login?from=${encodeURIComponent(callbackUrl)}&error=config`);
    }

    throw e;
  }
}
