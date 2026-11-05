import { redirect } from "next/navigation";

export default function SignUpPage() {
  redirect("/sign-in?mode=sign-up");
}
