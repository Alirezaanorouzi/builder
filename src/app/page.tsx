import { Chat } from "@/components/Chat";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }
  const developerPhone = process.env.PHONE_NUMBER_DEVELOPER?.trim() ?? "";
  return <Chat developerPhone={developerPhone} />;
}
