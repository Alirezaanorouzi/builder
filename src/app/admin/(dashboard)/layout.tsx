import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/sign-in");
  }
  return <>{children}</>;
}
